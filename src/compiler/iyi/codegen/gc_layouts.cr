require "./codegen"

# iyi: GC_DESIGN.md Stage 5 embeds the program's pointer maps into the binary
# itself, as the prelude's mark loop reads them. Stage 1 carried them in
# `.iyimod`'s `Layouts` section; that section travels between builds, but the
# collector that runs inside one program needs its own table in that
# program's own image, because two programs number their types differently and
# a `.iyimod` is not present at run time.
#
# The prelude holds an external global, `__iyi_gc_layouts`, and takes its
# address rather than its value. This file gives the symbol its one real
# definition. Emitting it unconditionally when `-Dgc_iyi` is set — rather
# than when the prelude references it — is deliberate: nothing would change
# on this platform today, but an artifact build that never asks for the
# marker must still link a program that does, and the symbol existing on
# demand is a promise a future build might quietly break.

# The prelude's allocator selection has its twin here: `iyi_gc_arena?` is
# the compiler's answer to "does this build's prelude allocate through the
# owned collector's arena", and it must equal the macro condition at the
# top of `src/iyi/prelude.iyi`'s allocator seam. It gates two emissions —
# the type id stored into the object header at every class allocation, and
# the layout table below — and the two sides disagreeing is not a
# degradation in one direction: a compiler that writes ids into a header
# the prelude did not allocate is memory corruption. Change both or
# neither.
class Iyi::Program
  def iyi_gc_arena? : Bool
    # Own-prelude builds only: a `--crystal` program allocates through
    # Boehm, its types include the standard library's own lowerings, and
    # both halves of this gate would be wrong there — the layout walk
    # crashes on shapes the arena never allocates, and the id store would
    # scribble into Boehm's heap. CI taught this line by turning every
    # crystal-mode build red the first time the predicate forgot it.
    return false unless iyi_prelude?
    return false if has_flag?("gc_boehm") || has_flag?("gc_none")
    (has_flag?("linux") && (has_flag?("x86_64") || has_flag?("aarch64"))) ||
      has_flag?("darwin")
  end
end

class Iyi::CodeGenVisitor
  GC_LAYOUTS_NAME = "__iyi_gc_layouts"

  # The table's word layout, named here once so the prelude can be read
  # beside it rather than beside a number:
  #
  #     word 0                      entry count
  #     five words per entry, sorted by type id:
  #       +0  type_id               the header's `type_id`
  #       +1  alloc_size            as laid out, not rounded
  #       +2  scan_cap              unrounded instance size
  #       +3  scan_count            pointer fields, from `scan_offsets`
  #       +4  scan_index            into the offset words after the entries
  #     then every entry's offsets, one word each, concatenated
  GC_LAYOUT_WORDS_PER_ENTRY = 5

  def iyi_define_gc_layouts : Nil
    entries = collect_gc_layout_entries

    # The marker reads the layout table for every object it touches, and a
    # missing entry means a conservative word-scan, never a crash. Sorting by
    # type id lets that lookup be a binary search in the prelude, and lets
    # this method keep the same determinism `collect_iyi_layouts` keeps for
    # the `.iyimod` section: the same program yields the same table.
    entries.sort_by! { |_, layout| layout.type_id }

    # The prelude's `IyiMark` reads the table by walking a base pointer
    # forward; it does not index by type id. So the type id in every entry
    # doubles as a sentinel for the binary search: if the table's count does
    # not agree with its sorted type ids, the search still terminates
    # without reading past the end.
    words = [] of UInt64
    words << entries.size.to_u64
    offset_words = [] of UInt64
    entries.each do |type, layout|
      words << layout.type_id.to_u64
      words << layout.alloc_size.to_u64
      words << layout.scan_cap.to_u64
      words << layout.scan_offsets.size.to_u64
      words << offset_words.size.to_u64
      layout.scan_offsets.each do |offset|
        offset_words << offset.to_u64
      end
    end
    words.concat offset_words

    # `@main_llvm_context` rather than the typer's: the typer has no context
    # accessor, and codegen already keeps the main module's context in that
    # ivar for exactly this reason (a global built in `@llvm_context` and
    # linked into `@main_mod` is two distinct types to LLVM even when the
    # dumped IR is identical, which the note beside `main_llvm_context_size_t`
    # records the hard way).
    initializer = @main_llvm_context.int64.const_array(words.map { |word| int64(word.to_i64) })
    table = @main_mod.globals.add(initializer.type, "#{GC_LAYOUTS_NAME}:table")
    table.linkage = LLVM::Linkage::Internal if @single_module
    table.global_constant = true
    table.initializer = initializer

    # The symbol the prelude declares. If the prelude already touched it,
    # `declare_lib_var` left it declared but without an initializer; give
    # it one now, or make the declaration whole if it did not.
    symbol = @main_mod.globals[GC_LAYOUTS_NAME]? ||
             @main_mod.globals.add(@main_llvm_context.void_pointer, GC_LAYOUTS_NAME)
    symbol.initializer = table
    unless @single_module
      symbol.linkage = LLVM::Linkage::External
    end
  end

  # The same filter `collect_iyi_layouts` applies to a module's own types,
  # widened to the whole program's type table: only a type laid out as an
  # object gets an entry, and a generic that was never instantiated does not
  # get one. A layout with a zero `type_id` would collide with the sentinel
  # for "no layout", and that id is `Nil`'s, which is never allocated — so
  # skip it rather than emit a conflicting entry.
  private def collect_gc_layout_entries : Array({Type, IyiMod::TypeLayout})
    entries = [] of {Type, IyiMod::TypeLayout}

    @program.llvm_id.each_type do |type|
      next unless type.is_a?(NonGenericClassType) || type.is_a?(GenericClassInstanceType)
      next if type.is_a?(GenericType)

      layout = @program.gc_type_layout(type)
      next if layout.type_id == 0

      entries << {type, layout}
    end

    entries
  end
end
