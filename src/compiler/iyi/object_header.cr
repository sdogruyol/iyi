# iyi: the object header of the owned collector. GC_DESIGN.md, Stage 1 task 2.
#
# Every heap object will be laid out `[header][user_data]`, the header sitting
# immediately ahead of the pointer the program holds. Nothing is allocated
# that way yet; putting the header on live objects is Stage 2. What Stage 1
# commits to is the layout and the mark word's concurrency contract, because
# both are load bearing from here on: the layouts `.iyimod` carries are keyed
# by the `type_id` stored here, and Stage 7's parallel marking stands or
# falls on colour changes being atomic.
#
# The header is sixteen bytes:
#
#     offset 0   type_id    u32   index into the program's layout table
#     offset 4   padding          aligns the word that follows
#     offset 8   mark_word  u64   atomic: colour, flags, reserved payload
#
# ## The mark word
#
# One atomic u64 holding three things at once, so recolouring an object never
# takes a lock:
#
#     bits  0..1   colour: 00 white, 01 gray, 10 black
#     bits  2..5   flags; has_finalizer and is_pinned are the intended two
#     bits  6..63  reserved, so a forwarding pointer fits if collection ever
#                  moves objects
#
# A colour transition is a compare-and-swap over the whole word with the
# expected colour folded into the expected word, never a plain write. Two
# workers that find the same white object race on one CAS and exactly one
# wins; the loser must not scan the object, so each transition reports
# whether it won. Every retry rebuilds the desired word from the value the
# lost CAS handed back, which is what lets a flag set concurrently with a
# colour change survive it, and the reverse.
#
# The tri-colour invariant, stated where the transitions are: a black object
# holds no pointer to a white one. `shade_gray` is how the invariant becomes
# true (a white child is shaded before its parent goes black); Stage 6's
# write barrier is how it stays true while mutators run. Mutators never
# write the mark word themselves (GC_DESIGN.md, Stage 1 task 3).
#
# ## Why this lives in the compiler tree
#
# The prelude is iyi's own library and nothing allocates in this shape yet,
# so unused code in it would be worse than none. The compiler is what will
# emit objects in this layout and embed the layout table into every binary,
# so the definition lives beside the code that will.
#
# One usage contract, because the header is a value type wrapping an atomic:
# the operations act on the receiver's own storage. Call them on addressable
# storage (an ivar, a local, or `ptr.value` on a pointer to a header), never
# on a copy a getter handed back.
module Iyi::Collector
  # The marking colours, valued so a fresh all-zero word reads as white: an
  # allocator stores nothing but the type id to make a new object white.
  enum Color : UInt8
    White = 0
    Gray  = 1
    Black = 2
  end

  struct ObjectHeader
    # The bit layout of the mark word, named exactly once. A shift or mask
    # written a second time anywhere else is how a collector acquires a bug
    # that only appears under load.
    COLOR_MASK    = 0b11_u64
    HAS_FINALIZER = 1_u64 << 2
    IS_PINNED     = 1_u64 << 3

    # Everything from this bit up is the reserved payload: 58 bits today, a
    # forwarding pointer's home if moving collection is ever added.
    PAYLOAD_SHIFT = 6
    PAYLOAD_MAX   = UInt64::MAX >> PAYLOAD_SHIFT

    # The bits a payload write must not touch: colour and flags together.
    NON_PAYLOAD_MASK = (1_u64 << PAYLOAD_SHIFT) - 1

    @type_id : UInt32
    @mark_word : Atomic(UInt64)

    def initialize(@type_id : UInt32)
      # White, no flags, no payload: the all-zero word.
      @mark_word = Atomic(UInt64).new(0_u64)
    end

    getter type_id : UInt32

    # The colour, read out of the word without disturbing flags or payload.
    def color : Color
      Color.from_value((@mark_word.get & COLOR_MASK).to_u8)
    end

    # CAS white to gray. True when this call did the shading; false when the
    # object was already gray or black, in which case the caller must not
    # scan it: the worker that won the race owns the scan, and scanning the
    # object twice is the bug the race answer exists to prevent.
    def shade_gray : Bool
      transition(Color::White, Color::Gray)
    end

    # CAS gray to black, once every pointer field has been scanned. True when
    # this call blackened the object.
    def shade_black : Bool
      transition(Color::Gray, Color::Black)
    end

    def has_finalizer? : Bool
      flag?(HAS_FINALIZER)
    end

    def pinned? : Bool
      flag?(IS_PINNED)
    end

    def mark_has_finalizer : Nil
      set_flag(HAS_FINALIZER)
    end

    def pin : Nil
      set_flag(IS_PINNED)
    end

    # The reserved high bits, with colour and flags shifted away.
    def payload : UInt64
      @mark_word.get >> PAYLOAD_SHIFT
    end

    # Replaces the reserved payload, leaving colour and flags untouched.
    # Nothing writes a payload yet; the round trip is a tested property
    # rather than an assumption, which is what keeps the forwarding pointer
    # possible. Overflow is refused rather than truncated, because a
    # truncated forwarding pointer is a corrupted heap.
    def payload=(value : UInt64) : Nil
      if value > PAYLOAD_MAX
        raise ArgumentError.new("payload #{value} does not fit in #{64 - PAYLOAD_SHIFT} bits")
      end
      word = @mark_word.get
      loop do
        desired = (word & NON_PAYLOAD_MASK) | (value << PAYLOAD_SHIFT)
        word, won = @mark_word.compare_and_set(word, desired)
        return if won
      end
    end

    # The colour check is inside the loop and the expected word is refreshed
    # by every lost CAS, so a flag or payload set concurrently with the
    # transition is carried into the next attempt instead of being written
    # over. Sequentially consistent, like every `Atomic` default; weaker
    # orderings are a Stage 7 measurement, not a Stage 1 decision.
    private def transition(from : Color, to : Color) : Bool
      word = @mark_word.get
      loop do
        return false unless (word & COLOR_MASK) == from.value.to_u64
        desired = (word & ~COLOR_MASK) | to.value.to_u64
        word, won = @mark_word.compare_and_set(word, desired)
        return true if won
      end
    end

    private def flag?(bit : UInt64) : Bool
      (@mark_word.get & bit) != 0
    end

    private def set_flag(bit : UInt64) : Nil
      word = @mark_word.get
      loop do
        return if (word & bit) == bit
        word, won = @mark_word.compare_and_set(word, word | bit)
        return if won
      end
    end
  end
end
