# What `Share` would cost — the count SPEC.md III.4.7 asks for before III.4.4 is
# built.
#
#     ./bin/crystal run bench/share_count.cr -- samples/iyi src/compiler/iyi
#
# `Share` is decided structurally (III.4.4): a type is shareable if no field is
# mutable and every field's type is shareable. Made countable:
#
#   * A field is **mutable** if it is assigned anywhere other than the
#     constructor, or if an accessor macro generates a setter for it.
#   * A field assigned only during construction is **not** mutable. This is the
#     class III.4.7 named as the one to fear — "immutable in practice but holds
#     a mutable field for one initialisation" — and it is sound to let it pass:
#     a value is not reachable from another task until it exists, so nothing can
#     observe the write.
#   * Failure is contagious through field types, so the interesting number is
#     the transitive one, not the direct one.
#
# Limits, stated because they bound the result: this reads syntax, not types.
# Field types are matched on the last segment of their path, generics on their
# base name, so a name that appears twice in different namespaces is conflated.
# Types whose fields are all of unknown provenance are reported separately
# rather than guessed at.
require "compiler/iyi/syntax"

# Mutable in the stdlib — a shared one of these is the data race the rule exists
# to stop.
MUTABLE_BUILTIN = %w[
  Array Hash Set Deque Slice StaticArray Pointer IO StringPool
  Channel Mutex Fiber Process File Dir Socket Random
]

# The subset of the above that is a collection. Counted separately because
# "you cannot share an Array" is a different problem from "you cannot share a
# Socket", and only the first one has a stdlib answer available.
COLLECTIONS = %w[Array Hash Set Deque Slice StaticArray]

# Immutable, or a value type with nothing to share.
IMMUTABLE_BUILTIN = %w[
  Int8 Int16 Int32 Int64 Int128 UInt8 UInt16 UInt32 UInt64 UInt128
  Float32 Float64 Bool Char String Symbol Nil Number Void
  Range Time Regex Enum Struct Object Value Comparable Proc BigInt
]

class TypeInfo
  getter name : String
  getter file : String
  property? is_module = false
  # ivar => why it is mutable
  getter mutations = {} of String => String
  getter accessors = {} of String => String
  # ivar => declared type names, best effort
  getter field_types = {} of String => Array(String)
  getter class_vars = Set(String).new

  def initialize(@name, @file)
  end

  def directly_mutable?
    !mutations.empty? || !accessors.empty?
  end

  # The actionable bucket: fails only because a field has a generated setter,
  # so it would pass if that field moved into the constructor.
  def accessor_only?
    mutations.empty? && !accessors.empty?
  end
end

class Collector < Iyi::Visitor
  getter types = {} of String => TypeInfo

  def initialize(@file : String)
    @scope = [] of String
    @def_name = nil.as(String?)
    @in_class_method = false
  end

  private def current
    return nil if @scope.empty?
    @types[@scope.join("::")]?
  end

  private def enter(name, is_module, &)
    @scope << name
    key = @scope.join("::")
    info = (@types[key] ||= TypeInfo.new(key, @file))
    info.is_module = is_module
    yield
    @scope.pop
  end

  def visit(node : Iyi::ClassDef)
    enter(node.name.to_s, false) { node.body.accept self }
    false
  end

  def visit(node : Iyi::ModuleDef)
    enter(node.name.to_s, true) { node.body.accept self }
    false
  end

  def visit(node : Iyi::Def)
    outer_name, outer_class = @def_name, @in_class_method
    @def_name = node.name
    @in_class_method = !node.receiver.nil?

    # `def initialize(@x : T)` declares a field and assigns it during
    # construction — a declaration, not a mutation.
    if info = current
      node.args.each do |arg|
        next unless (restriction = arg.restriction)
        info.field_types[arg.name] ||= [] of String
        info.field_types[arg.name].concat type_names(restriction)
      end
    end

    node.body.accept self
    @def_name, @in_class_method = outer_name, outer_class
    false
  end

  def visit(node : Iyi::TypeDeclaration)
    var = node.var
    if (info = current) && var.is_a?(Iyi::InstanceVar)
      info.field_types[var.name.lchop('@')] ||= [] of String
      info.field_types[var.name.lchop('@')].concat type_names(node.declared_type)
    end
    true
  end

  def visit(node : Iyi::Assign)
    record_write node.target
    true
  end

  def visit(node : Iyi::OpAssign)
    record_write node.target
    true
  end

  def visit(node : Iyi::MultiAssign)
    node.targets.each { |t| record_write t }
    true
  end

  private def record_write(target)
    info = current
    return unless info

    case target
    when Iyi::InstanceVar
      name = target.name.lchop('@')
      # Construction is not mutation: the value is not reachable from another
      # task until it exists.
      return if @def_name == "initialize" && !@in_class_method
      info.mutations[name] = @def_name || "top level"
    when Iyi::ClassVar
      info.class_vars << target.name.lchop('@').lchop('@')
    end
  end

  def visit(node : Iyi::Call)
    if node.obj.nil? && (info = current)
      case node.name
      when "property", "property?", "property!", "setter",
           "class_property", "class_property?", "class_setter"
        node.args.each do |arg|
          field = accessor_field(arg)
          info.accessors[field] = node.name if field
          if (restriction = accessor_type(arg))
            info.field_types[field] ||= [] of String if field
            info.field_types[field].concat(type_names(restriction)) if field
          end
        end
      when "getter", "getter?", "getter!", "class_getter"
        # Read-only. Records the field's type, nothing else.
        node.args.each do |arg|
          field = accessor_field(arg)
          next unless field
          if (restriction = accessor_type(arg))
            info.field_types[field] ||= [] of String
            info.field_types[field].concat type_names(restriction)
          end
        end
      end
    end
    true
  end

  private def accessor_field(arg)
    case arg
    when Iyi::TypeDeclaration then arg.var.to_s.lchop('@')
    when Iyi::Assign          then arg.target.to_s.lchop('@')
    when Iyi::SymbolLiteral   then arg.value
    when Iyi::Var, Iyi::Call, Iyi::StringLiteral
      arg.to_s.lchop('@')
    end
  end

  private def accessor_type(arg)
    arg.is_a?(Iyi::TypeDeclaration) ? arg.declared_type : nil
  end

  # Best effort: the base name of a path or generic, every member of a union.
  private def type_names(node) : Array(String)
    case node
    when Iyi::Path
      [node.names.last]
    when Iyi::Generic
      names = type_names(node.name)
      node.type_vars.each { |v| names.concat type_names(v) }
      names
    when Iyi::Union
      node.types.flat_map { |t| type_names(t) }
    when Iyi::Metaclass, Iyi::Self, Iyi::Underscore
      [] of String
    else
      [] of String
    end
  end

  def visit(node : Iyi::ASTNode)
    true
  end
end

def classify(types, collections_shareable = false)
  # Fixpoint: a type fails if it is directly mutable or holds a field whose type
  # fails. Matched on the last path segment, which is the limit noted at the top.
  by_short = {} of String => Array(TypeInfo)
  types.each_value do |info|
    (by_short[info.name.split("::").last] ||= [] of TypeInfo) << info
  end

  failing = Set(String).new
  types.each_value { |i| failing << i.name if i.directly_mutable? }

  loop do
    grew = false
    types.each_value do |info|
      next if failing.includes?(info.name)
      info.field_types.each_value do |names|
        names.each do |n|
          bad =
            if MUTABLE_BUILTIN.includes?(n)
              !collections_shareable || !COLLECTIONS.includes?(n)
            elsif (candidates = by_short[n]?)
              candidates.any? { |c| failing.includes?(c.name) }
            else
              false
            end
          if bad
            failing << info.name
            grew = true
            break
          end
        end
        break if failing.includes?(info.name)
      end
    end
    break unless grew
  end

  failing
end

roots = ARGV.empty? ? ["samples/iyi", "src/compiler/iyi"] : ARGV

roots.each do |root|
  files = Dir.glob(File.join(root, "**", "*.{cr,iyi}")).sort
  all = {} of String => TypeInfo

  files.each do |file|
    begin
      nodes = Iyi::Parser.parse(File.read(file))
    rescue
      next # a file this parser will not take is not evidence about Share
    end
    collector = Collector.new(file)
    nodes.accept collector
    collector.types.each do |k, v|
      all[k] = v unless all.has_key?(k)
    end
  end

  # Modules have no fields to share; count only types that can hold state.
  concrete = all.values.reject(&.is_module?)
  failing = classify(all)
  failing_if_collections_ok = classify(all, collections_shareable: true)

  direct = concrete.count &.directly_mutable?
  transitive = concrete.count { |i| failing.includes?(i.name) }
  accessor_only = concrete.count &.accessor_only?
  with_class_vars = concrete.count { |i| !i.class_vars.empty? }
  # The counterfactual that matters: who is failing *only* because a collection
  # is mutable, and would pass if the stdlib had a shareable immutable one.
  collection_only = concrete.count do |i|
    failing.includes?(i.name) && !failing_if_collections_ok.includes?(i.name)
  end

  puts
  puts "#{root} — #{files.size} files, #{concrete.size} types that can hold state"
  puts "-" * 68
  printf("  %-46s %5d  %5.1f%%\n", "fail Share, directly mutable", direct, pct(direct, concrete.size))
  printf("  %-46s %5d  %5.1f%%\n", "fail Share once field types propagate", transitive, pct(transitive, concrete.size))
  printf("  %-46s %5d  %5.1f%%\n", "  fail only because a collection is mutable", collection_only, pct(collection_only, concrete.size))
  printf("  %-46s %5d  %5.1f%%\n", "  fail only because of a generated setter", accessor_only, pct(accessor_only, concrete.size))
  printf("  %-46s %5d  %5.1f%%\n", "pass Share", concrete.size - transitive, pct(concrete.size - transitive, concrete.size))
  ok2 = concrete.size - concrete.count { |i| failing_if_collections_ok.includes?(i.name) }
  printf("  %-46s %5d  %5.1f%%\n", "pass Share given a shareable immutable collection", ok2, pct(ok2, concrete.size))
  printf("  %-46s %5d  %5.1f%%\n", "hold class variables (III.4.5)", with_class_vars, pct(with_class_vars, concrete.size))

  worst = concrete.select(&.directly_mutable?).sort_by { |i| -(i.mutations.size + i.accessors.size) }
  puts
  puts "  most-mutated types, as a sanity check on the definition:"
  worst.first(5).each do |i|
    why = i.mutations.empty? ? "setters" : "assigned in #{i.mutations.values.uniq.first(3).join(", ")}"
    puts "    #{i.name} (#{i.mutations.size + i.accessors.size} fields, #{why})"
  end
end

def pct(n, total)
  total.zero? ? 0.0 : n * 100.0 / total
end
