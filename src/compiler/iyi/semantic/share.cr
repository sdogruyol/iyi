# iyi: SPEC.md III.4.4's `Share` — the marker that says a value may be
# reached from two threads. Decided structurally, per type, the way
# `bench/share_count.cr` counted it before it was built: a type is
# shareable if none of its fields is mutable and every field's type is
# shareable, where a field is mutable if any method other than `initialize`
# assigns it or a setter `field=` is defined for it; or it is trusted
# (`@[Share]`), shareable whenever its type arguments are, for the short
# list that owns what it holds. Everything is a type-level fact: no
# ownership, no borrowing, no flow — R-3's closed types are what make it
# computable once per declaration.
#
# The mutation half reads bodies, so it can only be answered for a type
# declared in this compilation. A type read from an artifact carries the
# answer instead — its producer wrote `@[Share]` into the declaration it
# exported when it found the type shareable — and is never recomputed here:
# what a consumer sees of it is fields and method headers, and a header
# cannot say whether the body assigns.
#
# What it gates today: the block `IyiThread.start` captures (III.4.11), in
# `CleanupTransformer`. A channel's element type is next, with the channel
# that crosses threads.
module Iyi::Share
  # Shareable, or a sentence saying why not: the first field that fails and
  # the reason, one level at a time.
  def self.reason(type : Type) : String?
    reason(type, Set(Type).new)
  end

  def self.shareable?(type : Type) : Bool
    reason(type).nil?
  end

  private def self.reason(type : Type, visiting : Set(Type)) : String?
    # A recursive type reached again while its own check is open is not
    # the fault; whatever fails, fails elsewhere.
    return nil if visiting.includes?(type)
    visiting.add(type)
    begin
      check(type, visiting)
    ensure
      visiting.delete(type)
    end
  end

  private def self.check(type : Type, visiting : Set(Type)) : String?
    case type
    when NilType, BoolType, CharType, IntegerType, FloatType, SymbolType, VoidType, NoReturnType
      nil
    when EnumType
      nil
    when TypeParameter, TypeSplat
      # A generic's own parameter, as its producer sees the field: the
      # consumer's instantiation is where the argument is checked.
      nil
    when AliasType
      reason(type.aliased_type, visiting)
    when TypeDefType
      reason(type.typedef, visiting)
    when MetaclassType, GenericClassInstanceMetaclassType, VirtualMetaclassType
      nil
    when PointerInstanceType
      "#{type} is raw memory, which no marker can vouch for"
    when StaticArrayInstanceType
      "#{type} is a fixed buffer whose elements are written in place"
    when ProcInstanceType
      "#{type} is a closure, and what it captured is not written in its type"
    when TupleInstanceType
      type.tuple_types.each do |member|
        if why = reason(member, visiting)
          return "#{type} holds #{member}: #{why}"
        end
      end
      nil
    when NamedTupleInstanceType
      type.entries.each do |entry|
        if why = reason(entry.type, visiting)
          return "#{type} holds #{entry.name} : #{entry.type}: #{why}"
        end
      end
      nil
    when UnionType
      type.union_types.each do |member|
        if why = reason(member, visiting)
          return "#{type} may be #{member}: #{why}"
        end
      end
      nil
    when VirtualType
      # A value typed as the base may be any subclass; every one must hold.
      if why = reason(type.base_type, visiting)
        return why
      end
      type.base_type.all_subclasses.each do |subclass|
        if why = reason(subclass, visiting)
          return "#{type} may be #{subclass}: #{why}"
        end
      end
      nil
    when GenericClassInstanceType
      if trusted?(type)
        trusted_arguments(type, visiting)
      elsif type.generic_type.iyi_from_artifact?
        "#{type} came from an artifact whose producer did not find it shareable"
      else
        structural(type, type.generic_type, visiting)
      end
    when GenericModuleInstanceType, NonGenericModuleType, GenericModuleType
      # A module as a value's type is its including types, which the virtual
      # form above enumerates; a bare module here is a type with no fields.
      nil
    when NonGenericClassType
      if type.iyi_share_trusted?
        nil
      elsif type.iyi_from_artifact?
        "#{type} came from an artifact whose producer did not find it shareable"
      else
        structural(type, type, visiting)
      end
    when GenericClassType
      # The uninstantiated generic, as a producer asks about it: shareable
      # when its own fields are, with its parameters standing for whatever
      # a consumer instantiates it with — the consumer checks those.
      if type.iyi_share_trusted?
        nil
      else
        structural(type, type, visiting)
      end
    else
      "#{type} (#{type.class}) has no shareability rule"
    end
  end

  private def self.trusted?(type : GenericClassInstanceType) : Bool
    type.generic_type.iyi_share_trusted?
  end

  # `@[Share]` on the generic: shareable whenever its arguments are.
  private def self.trusted_arguments(type : GenericClassInstanceType, visiting : Set(Type)) : String?
    type.type_vars.each do |name, var|
      next unless var.is_a?(Var)
      argument = var.type?
      next unless argument
      if why = reason(argument, visiting)
        return "#{type}'s #{name} is #{argument}: #{why}"
      end
    end
    nil
  end

  # The structural half: every field immutable after `initialize`, every
  # field's type shareable. `declaration` is where the defs live — the
  # generic type for an instance — and `type` is where the fields' resolved
  # types live.
  private def self.structural(type : Type, declaration : Type, visiting : Set(Type)) : String?
    mutated = mutated_fields(declaration)
    if type.responds_to?(:all_instance_vars)
      type.all_instance_vars.each do |name, var|
        if how = mutated[name]?
          return "#{type}'s field #{name} is #{how}"
        end
        var_type = var.type?
        next unless var_type
        if why = reason(var_type, visiting)
          return "#{type}'s field #{name} : #{var_type} is not shareable: #{why}"
        end
      end
    end
    nil
  end

  # Field name -> how it is mutable: "assigned in `clear`" or "given a setter
  # `count=`". Read off the declaration's own defs and its ancestors', once
  # per declaration.
  @@mutations = {} of Type => Hash(String, String)

  private def self.mutated_fields(declaration : Type) : Hash(String, String)
    @@mutations[declaration] ||= scan_mutations(declaration)
  end

  private def self.scan_mutations(declaration : Type) : Hash(String, String)
    found = {} of String => String
    each_declaration_and_ancestor(declaration) do |owner|
      next unless owner.responds_to?(:defs)
      defs = owner.defs
      next unless defs
      defs.each do |name, list|
        list.each do |entry|
          a_def = entry.def
          if name.ends_with?('=') && name != "==" && name != "!=" && name != "[]=" && name != "<=" && name != ">="
            field = "@#{name.rchop}"
            found[field] ||= "given a setter `#{name}`"
          end
          next if name == "initialize"
          scanner = MutationScanner.new(name)
          a_def.body.accept(scanner)
          scanner.fields.each do |field|
            found[field] ||= "assigned in `#{name}`"
          end
        end
      end
    end
    found
  end

  private def self.each_declaration_and_ancestor(declaration : Type, &block : Type -> Nil) : Nil
    yield declaration
    if declaration.is_a?(ClassType)
      parent = declaration.superclass
      while parent
        yield parent
        parent = parent.is_a?(ClassType) ? parent.superclass : nil
      end
    end
  end

  # Every instance variable a body assigns, by any spelling.
  class MutationScanner < Visitor
    getter fields = Set(String).new

    def initialize(@def_name : String)
    end

    def visit(node : Assign) : Bool
      note(node.target)
      true
    end

    def visit(node : OpAssign) : Bool
      note(node.target)
      true
    end

    def visit(node : MultiAssign) : Bool
      node.targets.each { |target| note(target) }
      true
    end

    def visit(node : ASTNode) : Bool
      true
    end

    private def note(target : ASTNode) : Nil
      @fields << target.name if target.is_a?(InstanceVar)
    end
  end
end
