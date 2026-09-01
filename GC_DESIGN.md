# iyi Garbage Collector Design

**Status:** Stages 1, 2, 3, 5 and 6 built, so the collector works end to end
behind `-Dgc_iyi`: allocate, mark, sweep, and the memory is handed out again.
Stage 4 is mostly vacuous, Stages 7 to 9 wait on a scheduler, and Stage 10 is
design.

Stage 6: the sweep. One walk over every carved chunk, a white object's chunk
goes back on its class's free list, a black one survives and is repainted white
for the next cycle. Large objects walk their own list with `next` read before
the node is released. The proof is reuse rather than a counter: 300 objects
nothing references, collect, 300 more allocations, and 299 of them come back
from addresses the sweep reclaimed. A rooted object keeps every byte, comes out
white, and its chunk is not handed out again.

Finalizers and weak references are not built, and not for lack of time.
Nothing in this language defines a finalizer, there is no `def finalize`
anywhere in `src/iyi` or `samples/iyi`, so a finalizer queue would be a
mechanism no program could put an entry in. Weak references are registration
based and the standard library's `WeakRef` is on the `--crystal` side, so there
is no table here to walk and null out. Both wait on the language having the
feature. Statistics are the honest subset, counted as the walk goes: chunks
swept, chunks kept, bytes freed, collections run.

Stage 5: the mark phase. Roots go gray through Stage 3's walker, a queue in its
own mapping drains, each object's payload is scanned to the bound its size
header carries, and what is still white when the queue empties is unreachable.
The object header is real now: with `P` the pointer a program holds, `P-24` is
the size, `P-16` the `type_id`, `P-8` the mark word, and `P` the user data.

Marking is **precise for typed objects and conservative for the rest**.
Codegen stores the `type_id` into the header at the allocation site
(`allocate_aggregate`), the mark loop binary-searches the embedded layout
table (`__iyi_gc_layouts`) and scans exactly the offsets the `TypeLayout`
names, so an integer field holding an address retains nothing through a
typed object. A zero id — a `Pointer(T).malloc` buffer, a closure
environment — and an id the table does not carry both word-scan
conservatively, which is what Boehm does in production and errs in the
safe direction: a false positive retains a dead object, only a false
negative frees a live one. `bench/mark_exercise.sh` proves the precision
differentially and proves the check fails when the lookup is disabled.

Stage 6 sweeps what this stage decided, and the collector runs *itself*: an
allocation-pressure trigger in the allocator's one funnel runs a collection
when the bytes allocated since the last one cross the budget, and the budget
after each collection is twice what survived it, floored at a MiB — churn
against a small live set collects often, against a big one rarely, and a
program under a MiB never pays. `bench/collect_trigger.sh` proves it with
nobody calling `collect`: the heap stays bounded, a rooted survivor and a
parked fiber's only reference both live through triggered collections, and
the checks fail when the trigger or the budget growth is removed. The
trigger's steady state is also what turned the freed-chunk check into the
mark word's FREE flag: the free-list walk this design called "fine until a
profile asks" made every sweep quadratic the day one did, 106 seconds of
exercise against 0.1 after the flag.

Stage 1: the artifact carries a pointer map per type it owns (`.iyimod` format
v43, `Layouts` section 64), and the object header and its CAS-safe mark word
exist and are tested as a unit. Stage 1's own tasks 3 and 4, work distribution
and write barriers, are design here and deferred to Stage 6 by their own text;
they were not built.

Stage 2: a size-class arena allocator, `-Dgc_iyi`, on Linux x86_64 and aarch64
and on darwin. Size classes to 16 KiB, 16 MiB arenas, free lists, large objects
by their own mapping and released with `munmap`, and the two properties Stage 3
needs: a pointer resolves to its arena and class, and the arena list walks. It
costs no symbol and no library beyond `munmap`, so the dependency floor holds.

What it does not do yet: collection is opt-in behind `-Dgc_iyi`, and moving
the default is a measurement and a decision, not a side effect. Windows and
wasm32 keep their existing allocators — the first's memory diagnosis now has
a fixed suspect (the prelude memset's stride) and CI's watch is what retires
it, the second has no mmap and its watermark arena is a separate design.
Threads, and with them Stages 4, 7, 8 and 9, wait where the section below
says they wait.

## What the staging above got wrong, and what the rebase onto 0.6.0 corrected

This plan was written assuming iyi has threads and fibers, and when the first
three stages were built it had neither. That half inverted while the work was
in flight: 0.4.0 shipped structured concurrency — a cooperative scheduler,
`spawn`/`group`, `Channel`, 256 KiB mmap'd fiber stacks in
`src/iyi/concurrency.iyi`. Threads are still absent, and III.9's reason
stands.

What that does to the stages, restated against the tree as it is:

* **Stage 3's fiber enumeration is closed.** The scheduler keeps an
  all-fibers registry — its wait queues could not serve the walk, since a
  channel-parked fiber lives in the channel's own nodes — and
  `each_fiber_root` scans every suspended fiber from its saved stack
  pointer to its stack top; the running stack's own scan caps at the
  current fiber's top rather than the thread base, because the gap
  between the two mappings is unmapped. `bench/root_exercise.sh` holds
  it both ways: an address held only on a suspended fiber's stack is
  found, and a prelude with the fiber walk removed exits 1 at that
  check's own name.
* **Stage 4's thread suspension** still has nothing to suspend: fibers yield
  cooperatively at suspension points and never inside the marker, so a
  single-threaded collection needs no stopping. Register capture, the part
  that was real with one thread, moved into Stage 3 where it is tested.
* **Stages 7 and 8**, parallel marking and concurrent sweeping, are the
  reason the owner chose to own a collector, and they still wait on threads,
  not on fibers. The mark word is already CAS-safe and the header already
  reserves its bits, so the wait costs a redesign of nothing.
* **Stage 9** is conditional on measuring Stage 7, so it inherits the same wait.

This is worth stating plainly rather than leaving the plan to read as ten
achievable steps: the collector can reach a working single-fiber
mark-and-sweep today, a fiber-aware one after Stage 3's registry walk, and
the parallelism the decision was made for arrives after threads do.

So the point of no return, Stage 5, is still ahead.

**Owner's Decision:** Own the garbage collector. Concurrency, parallelism, and performance control are the reasons. gcry is prior art: measurements, design hints, and a record of what has already been tried and cost what. iyi writes the heap, the STW mechanism, root discovery, and finalizers from scratch.

---

## The Cost of Ownership

iyi is now responsible for what gcry has working: a memory allocator with size classes, stop-the-world synchronization across threads and fibers, root discovery including the suspended-register cases that took gcry until v0.19 to close, finalizer execution, and weak reference handling. This is not an implementation of an algorithm; it is infrastructure. **Point of no return: Stage 5 (Marking).** Once the compiler emits pointer maps and marks live objects, bdw-gc can no longer be the fallback. The compiler's parallel codegen depends on collection; a broken collector breaks the compiler.

What iyi gains: exact control over concurrent marking (parallel work distribution, work stealing), tight coupling between codegen and collector (pointer maps, object headers, write barriers), and a performance baseline measured against real workloads rather than inherited from Boehm.

---

## The Two Precision Requirements (SPEC.md II.5)

1. **Heap-layout precision (REQUIRED):** Which words inside an object are pointers. R-4 stencils one compiled body per GC shape, so pointer maps travel with shapes. The compiler has this table exactly; no discovery needed.

2. **Stack-root precision (DEFERRED):** Which stack slots hold pointers. Requires stack maps from codegen and a frame walker at runtime. gcry measured this at approximately 2x cost with no RSS win (FINDINGS from github.com/sdogruyol/gcry/blob/master/docs/STACK_MAPS.md: "**stack-map precision is correctness-stable and NOT an RSS win**"). That result is worth inheriting rather than repeating. Do not implement; measure first if workloads differ.

---

## Staged Implementation Plan

Each stage is independently verifiable; the tree is never left broken between them.

### Stage 1: Pointer Map Emission & Parallel Marking Infrastructure

**What is TRUE at the end:** Every type has a `TypeLayout` in `.iyimod`, keyed by `type_id`. Object headers include a mark word designed for parallel concurrent marking (tri-color bits, CAS-safe). The architecture accommodates parallel work distribution.

**Tasks:**

1. **Pointer Map Emission:**
   - Extend `.iyimod` with a `Layouts` section: `type_id` → `TypeLayout` entries.
   - `TypeLayout` struct: `type_id: Int32`, `alloc_size: UInt32`, `scan_cap: UInt32` (unrounded instance size, caps conservative fallback), `scan_offsets: Array(UInt16)` (pointer field byte offsets, mark and recurse), `noscan_offsets: Array(UInt16)` (pointer-containing fields that are not themselves traced, e.g., weak references, integer tables like `Array` buffer).
   - Codegen pass: after all types are lowered, walk the type table and emit a `TypeLayout` for each monomorphic instance (within-module) or per GC shape (cross-module).
   - Compiler embeds layouts into every binary; no runtime discovery.

2. **Object Header Design (Parallel Marking):**
   - Object layout: `[header][user_data]`.
   - Header includes:
     - `type_id: u32` (index into layout table).
     - `mark_word: u64` (atomic, CAS-safe, holds three pieces of information):
       - Bits 0-1: color bits (00=white, 01=gray, 10=black). Tri-color invariant: a black object has no pointers to white objects.
       - Bits 2-5: reserved for future flags (e.g., has_finalizer, is_pinned).
       - Bits 6-63: can be repurposed for forwarding pointer if moving collection is added later.
   - Mark word allows atomic CAS to change color (e.g., `cas(&mark_word, white, gray)` in marking, `cas(&mark_word, gray, black)` in scan completion).

3. **Concurrent Marking Work Distribution (Design):**
   - Global work queue: thread-safe, lock-free (or fine-grained locks for now; optimize later).
   - Each marking worker thread: pop a gray object from the queue, scan its pointer fields, enqueue any white targets it finds as gray.
   - Load balancing: work stealing (if one worker's queue is empty, steal from another's). Deferred to Stage 6; for now, a shared queue is sufficient.
   - Mark word state transitions: only the marking phase changes colors; mutators do not touch the mark word (write barriers observe the mark word but do not change it).

4. **Write Barrier Design (for concurrent marking):**
   - When a mutator writes a pointer to a heap object: if source is black and target is white, change target to gray (add to marking queue).
   - Implementation: codegen inserts a check before every heap-to-heap pointer write (Stage 2 inserts the instrumentation, Stage 6 does the marking from it).
   - No barrier needed for writes from stack (stack is re-scanned each collection).

**Verification:** `iyi build` produces `.iyimod` with `Layouts` section; object headers are the right size; mark word bit manipulations are CAS-safe.

---

### Stage 2: Allocator: mmap-backed Size Classes

**What is TRUE at the end:** Memory allocation uses size-class arenas; arena growth is via mmap; allocation and free are O(1) on average; heap is addressable and traversable.

**Tasks:**

1. **Size Classes:**
   - Define size classes: 16, 32, 64, 128, 256, 512, 1024, ... bytes, up to ~1 MB.
   - Each size class has a free list and an arena (one or more mmap regions).
   - Allocation: find size class for the requested size (round up), pop from free list. If empty, mmap a new arena and populate its free list.
   - Free (after mark): add chunk back to its size class's free list.

2. **Arena Structure:**
   - One arena = one contiguous mmap region (e.g., 16 MB or 32 MB per arena).
   - Arena header: size, number of free chunks, free list.
   - Chunks within the arena are sized uniformly (all chunks in a size-16 arena are 16 bytes).
   - Arena is addressable: given a pointer, the allocator can find its containing arena and size class.

3. **Large Objects (> ~1 MB):**
   - Allocated via direct mmap, one object per mmap region.
   - Freed directly via munmap.
   - Tracked separately (large-object list).

4. **Platform Integration:**

   **Linux (x86_64, aarch64):**
   - `mmap(PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0)`.
   - `munmap(addr, size)` to free.
   - Page size: 4 KiB (portable; do not assume).

   **macOS (x86_64, arm64):**
   - `mmap(PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0)`.
   - `munmap(addr, size)` to free.
   - Mach VM is available but mmap is sufficient.

   **Windows (x86_64, arm64):**
   - `VirtualAlloc(NULL, size, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE)`.
   - `VirtualFree(addr, size, MEM_RELEASE)`.
   - Granularity: 64 KiB allocation granule, 4 KiB page granule.

   **wasm32 (wasi):**
   - No mmap. Use `memory.grow(delta_pages)` (iyi has this primitive per decision #4).
   - Manage heap manually within linear memory: watermark allocator for now (allocate from the end of used memory; no freeing until next collection).
   - Deferred complexity: fragmentation management via free lists in wasm32 heap.

5. **Allocator State:**
   - Global allocator lock (fine-grained or per-arena later).
   - Arena list: traversable for GC root scanning and heap statistics.
   - Free lists: per size class, per arena or global (measure before choosing).

**Verification:** Allocate and free objects of various sizes; verify no corruption; inspect arena structure; measure allocation speed (should be O(1) or close).

---

### Stage 3: Root Discovery (Conservative, Precise in Scope)

**What is TRUE at the end:** STW is not implemented yet, but the mechanisms to find roots are in place: stack bounds are recorded, global segment ranges are known, Fibers are enumerable, and the logic to identify heap pointers exists.

**Tasks:**

1. **Stack Bounds (per Thread/Fiber):**
   - At thread creation: record `stack_base` (highest address) and estimate initial `stack_top` (lowest address used so far).
   - At fiber creation: record fiber's stack boundaries from the fiber's structure.
   - Conservative stack scanning: every word from `stack_top` to `stack_base` is a potential pointer. If it points into an allocated chunk, mark the target.

2. **Register Scanning (Deferred to Stage 4 with STW):**
   - At STW, read registers from suspended threads.
   - Treat register contents as roots.

3. **Global Segment Scanning:**
   - Identify static memory ranges:
     - **Linux:** `__data_start` to `__bss_end` (from link script or symbols).
     - **macOS:** `__DATA` and `__DATA_CONST` segments (from Mach headers).
     - **Windows:** `.data` and `.bss` sections (from PE header).
     - **wasm32:** Static memory region (compile-time known; no runtime discovery).
   - Conservative scan: every word in the segment is a potential pointer.

4. **Fiber Enumeration:**
   - Maintain a registry of live Fibers (Fiber struct includes a linked-list node or an array index).
   - At GC time, enumerate all Fibers.
   - For each Fiber, scan its stack conservatively.

5. **Pointer Validation:**
   - Given a word-sized value, determine if it is a valid heap pointer:
     - Is it within any arena's address range? (use arena list).
     - Is it within an allocated chunk's bounds? (use chunk headers or a bitmap).
   - If yes, it is a pointer; mark the target object.
   - False positives are safe (conservative scanning); false negatives (missing a live pointer) are bugs.

**Verification:** Write a test that allocates objects and embeds pointers in global memory, stack, and registers; verify that manual root discovery finds them.

---

### Stage 4: Stop-the-World Synchronization

**What is TRUE at the end:** All threads and fibers can be paused simultaneously; their registers and stacks are accessible; the program is paused long enough for a collection phase.

**Tasks:**

1. **Threading Model (iyi/Crystal):**
   - iyi inherits Crystal's Fiber-based concurrency. Fibers are lightweight; many can run on one thread.
   - Threads exist (System threads that run Fibers). At STW, all threads must pause.
   - Main thread initiates collection (a GC trigger: either an allocation request or an explicit call to `GC.collect()`).

2. **Platform-Specific STW:**

   **Linux:**
   - Use `SIGSTOP` (better) or `SIGUSR1` (compatible) to pause threads.
   - `raise(SIGSTOP)` on other threads; they pause.
   - Parent thread waits for all to pause (via `/proc/<pid>/stat` checking thread state, or a barrier).
   - Run collection.
   - `SIGCONT` to resume all threads.
   - Alternative: `ptrace(PTRACE_ATTACH)` on each thread, but `SIGSTOP` is lighter.

   **macOS:**
   - Use Mach `thread_suspend()` to pause threads.
   - Enumerate threads via Mach kernel; call `thread_suspend()` on each.
   - Run collection.
   - `thread_resume()` to resume all.

   **Windows:**
   - Use `SuspendThread(thread_handle)` on each thread.
   - Get thread context via `GetThreadContext()` to access registers.
   - Run collection.
   - `ResumeThread(thread_handle)` to resume.

   **wasm32:**
   - Single-threaded; no STW needed. Collection happens at a cooperative yield point (e.g., at the end of a Fiber's `yield`).

3. **Safe Points:**
   - A thread can only be paused safely if it is not inside an atomic operation or a signal handler.
   - For now (Stage 4), assume all threads are at safe points (i.e., in user code, not in libc).
   - Deferred: add explicit safe-point checks for long-running operations (e.g., polling inside a library).

4. **Register & Stack Access:**
   - At STW, read the suspended thread's registers and stack:
     - **Linux:** Read from `/proc/<pid>/task/<tid>/regs` (via `ptrace`).
     - **macOS:** Extract from Mach `thread_state`.
     - **Windows:** `GetThreadContext()`.
   - Use registers and stacks as additional roots (Stage 3 prepared for this).

**Verification:** Pause a running program with multiple threads; verify they are paused; resume them; verify they continue correctly (no crashes).

---

### Stage 5: Marking Phase (Tri-Color, Single-Threaded STW)

**What is TRUE at the end:** Live objects are correctly marked. Unreachable objects remain white. The mark representation (tri-color) supports the parallel marking of Stage 6.

**This is the point of no return.** Once the compiler emits pointer maps and the GC marks heap objects, bdw-gc is no longer a fallback. The compiler's parallel codegen depends on garbage collection.

**Tasks:**

1. **Tri-Color Marking:**
   - White: unreachable (to be swept).
   - Gray: reachable but not yet scanned.
   - Black: scanned, live.
   - Invariant: no black object has a pointer to a white object.

2. **Root Marking:**
   - At STW, shade all root pointers gray:
     - Stack: scan conservatively (Stage 3).
     - Registers: scan (Stage 4).
     - Globals: scan conservatively (Stage 3).
     - Fibers: enumerate and shade from their roots.
   - Add all gray objects to a work queue.

3. **Mark Loop (Single-Threaded for now):**
   - While the work queue is not empty:
     - Pop a gray object.
     - Read its `TypeLayout` from the layout table (keyed by `type_id`).
     - If `TypeLayout` is found and matches the object's size, use `scan_offsets` to find pointer fields. Otherwise, conservatively word-scan.
     - For each pointer found: if the target is white, shade it gray and enqueue.
     - After scanning, shade the object black.

4. **Mark Word Atomicity:**
   - Color transitions use CAS on the `mark_word` to be thread-safe (even though marking is single-threaded here; this prepares for Stage 6).
   - E.g., `cas(&obj.mark_word, white, gray)` to shade gray; `cas(&obj.mark_word, gray, black)` to shade black.

5. **False Positives:**
   - Conservative scanning may find pointers that are not actually pointers (integers that happen to alias valid heap addresses).
   - This is safe: marking a white object as gray and then black does not hurt; it is a false negative (failing to mark a reachable object) that is a bug.

**Verification:** Mark the heap manually (with the above algorithm); compare the marked set against Boehm's mark set for the same roots on small programs; confirm match or identify differences.

---

### Stage 6: Sweep Phase & Finalizers

**What is TRUE at the end:** Unreachable objects are freed; heap space is reclaimed; finalizers run.

**Tasks:**

1. **Sweep Iteration:**
   - Iterate over all allocated objects (via arena list and chunk headers).
   - For each white object: add its chunk back to the size class's free list. Re-shade it white for the next collection.
   - For each black object: shade it white (reset for next cycle).

2. **Finalizer Execution:**
   - Before freeing a white object, check if its type has a registered finalizer.
   - Run the finalizer in a safe context (not in an arbitrary Fiber; use a dedicated finalizer queue or thread).
   - Then free the object.
   - Finalizers must not allocate or spawn tasks (enforce in design docs; runtime check deferred).

3. **Weak References:**
   - A weak reference is a pointer that does not prevent marking.
   - At the end of the mark phase, before sweep, walk weak-reference tables and null out pointers to white objects.
   - A weak reference returning `nil` after a collection is expected behavior; no finalizer or error.

4. **Heap Statistics:**
   - Track: bytes allocated, bytes freed, pause time, number of collections, objects finalized.
   - Expose via `GC.stats()` for observability.
   - Emit to metrics if the program links a metrics library (deferred).

**Verification:** Allocate objects with finalizers; collect garbage; verify finalizers run in the right order and at the right time; check RSS before and after collection.

---

### Stage 7: Parallel Marking (Concurrent STW, Multi-Worker)

**What is TRUE at the end:** Multiple threads participate in marking concurrently. Work is distributed and stolen fairly. The object header's mark word supports concurrent color transitions via CAS.

**This is where concurrency and parallelism are realized.** The owner said they want them; this stage delivers them.

**Tasks:**

1. **Work Distribution:**
   - Marking is no longer single-threaded. Multiple worker threads mark concurrently.
   - Shared work queue: thread-safe, append-only until marking is done.
   - Each worker: pop gray objects from the queue, scan them, enqueue pointer targets.
   - Synchronization: work queue uses locks or atomic CAS. Optimize after correctness.

2. **Work Stealing:**
   - If a worker's local queue is empty, it steals from other workers' queues.
   - Reduces global lock contention.
   - Deferred to Stage 7b (measure first).

3. **Mark Completion:**
   - When all workers' queues are empty and no worker is scanning, marking is complete.
   - Coordinate via a barrier or a completion counter (atomic decrement until zero).

4. **Write Barriers (Active, from Stage 1 Design):**
   - Mutators continue to run during marking (concurrent marking); they emit write barriers.
   - Write barrier: before a heap-to-heap pointer write, check if source is black and target is white. If yes, shade target gray.
   - Implementation: codegen (instrumented in Stage 1) calls a barrier function or inlines the check.
   - Barrier function is cheap: an atomic CAS on the mark word; most writes do not cross the black-white boundary.

5. **Pause Phases:**
   - Brief initial pause (STW): shade roots gray; start marking threads.
   - Concurrent marking: mark runs while mutators run and emit barriers.
   - Brief final pause (STW): rescan roots and stack (changed while marking ran); mark any new gray objects; mark all workers as black.
   - Sweep: not STW; can happen concurrently with mutators (deferred; measure first).

**Verification:** Spawn multiple tasks; allocate heavily; verify mark completes correctly; check for missed or over-marked objects; measure pause time and throughput.

---

### Stage 8: Concurrent Sweeping & Finalization

**What is TRUE at the end:** Sweep does not require STW. Finalizers run asynchronously in a dedicated thread. Memory is reclaimed while the program runs.

**Tasks:**

1. **Non-STW Sweep:**
   - After mark phase (all workers idle), start a dedicated sweep thread.
   - Sweep iterates over arenas and chunks; does not hold a lock (or minimal locking).
   - Mutators can allocate from un-swept arenas (using a different free list or bitmap).
   - Deferred to Stage 8; for now, sweep is brief and happens in the final STW pause.

2. **Finalizer Thread:**
   - Finalizers run in a dedicated thread (not in the marking threads, not in mutator threads).
   - Finalizer queue: populated during sweep.
   - Finalizer thread: dequeue and run, one at a time.
   - If a finalizer allocates, it can trigger the next collection immediately; ensure no deadlock.

**Verification:** Collect garbage; verify finalizers run asynchronously; measure time between sweep start and mutator resume.

---

### Stage 9: Incremental Marking (Measured, Optional)

**What is TRUE at the end:** Pause time is predictable and small (e.g., < 10 ms). Marking happens in incremental bursts instead of one long STW.

**Only if:**
- Measurements show concurrent marking from Stage 7 is insufficient (pause still > 100 ms on large heaps).
- Predictability is a requirement (e.g., interactive apps with strict latency budgets).

**Approach:**
- Divide marking into multiple STW bursts, each < 10 ms.
- Between bursts, mutators run (with write barriers active).
- On the next burst, resume from where the previous burst left off.
- Requires careful synchronization (work queue, barrier).

**Decision:** Measure first (Stage 7). Do not implement unless needed.

---

### Stage 10: All Four Platforms (Windows & wasm32)

**What is TRUE at the end:** GC works on all four targets: Linux, macOS, Windows, and wasm32. Pointer maps account for platform-specific sizes and alignments.

**Tasks:**

1. **Windows Integration:**
   - STW: use `SuspendThread()` and `GetThreadContext()` (Stage 4 already designed for this).
   - Allocator: `VirtualAlloc()` / `VirtualFree()` (Stage 2).
   - Root discovery: global segments from PE header; stack ranges; fiber stacks.
   - Test on Windows x86_64 and arm64.

2. **wasm32 Integration:**
   - Allocator: linear memory watermark (Stage 2 design included it).
   - Implicit STW: at Fiber yield points (no explicit pause needed).
   - Root discovery: stack (within wasm linear memory), globals (within linear memory).
   - Pointer maps: account for wasm32 ABI (sizes/alignments differ from host).
   - Test on wasm32-wasi.

3. **Platform-Specific Pointer Maps:**
   - If sizes differ by platform, emit platform-specific `TypeLayout` entries or key by `(type_id, target_arch)`.
   - Compile-time: codegen knows the target; emit the right size.

**Verification:** Build and run samples on all four platforms; verify collection works; measure RSS and pause time.

---

## The Asymmetry: Pointer Maps as iyi's Advantage

gcry's layout.cr reverse-engineers type layouts from outside the compiler:
- Walks `Reference` subclasses with a macro.
- Maintains a blacklist of unsafe prefixes (`Crystal::`, `LibC::`) whose layout cannot be trusted.
- Hardcodes field offsets for Crystal's `Hash` internals.
- Falls back to conservative word-scanning when unsure.

From github.com/sdogruyol/gcry/blob/master/src/gcry/layout.cr:
```
# Compile-time prefix blacklist. Types whose ivar layout Crystal guarantees
# to keep stable across versions (built-in stdlib) get precise offsets via
# the macro walk below; types in these prefixes ("Cry", "Crystal::",
# "LibC::") change shape across versions or carry platform-specific
# conditional fields that the macro cannot see. Skip them: they keep
# conservative scanning, which is safe.
UNSAFE_PREFIXES = {"Cry", "Crystal::", "LibC::"}
```

**iyi emits the same table exactly**, for every type, with no macro walk, no blacklist, no hardcoded offsets, and no fallback to conservative scanning (except when a type is genuinely unknown at runtime, which is an error or a dynamic load). The compiler has the layouts; it computes them while building the type; it emits them directly into `.iyimod`. This is the fundamental asymmetry that justifies ownership.

---

## Concurrency Coupling to III.4 (Structured Concurrency)

III.4 defines structured concurrency: tasks are spawned inside a `group`, and the group's block cannot exit until all tasks finish. The GC must respect this boundary.

**Stage 7 Integration:**
- Each spawned task is a Fiber. The task group is a collection of Fibers.
- During STW, only Fibers in the active task set are paused. Fibers from completed groups are not live (they are not roots).
- The GC can enumerate active task groups and pause their Fibers selectively.
- No task can escape an STW pause (enforce in the task scheduler; a task cannot block or run during marking).

**Write Barriers & Cancellation:**
- A task can be cancelled by its group. Cancellation is a control-flow event (not an exception, not a signal).
- Write barriers do not need to know about cancellation; barriers run before the write happens.
- If a task is cancelled, it unwinds (or stops gracefully); any objects it allocated are reclaimed by the next collection.

---

## What gcry Measured (Prior Art)

From github.com/sdogruyol/gcry/blob/master/README.md and docs/:

**Throughput:** "gcry runs at ~87% of Boehm's throughput with ~0.80x the RSS (Linux)." On Kemal (a web framework):
- Kemal `/json` throughput: ~87% of Boehm.
- Post-GC RSS: ~0.80x Boehm.
- Kemal `/` throughput: ~82% of Boehm.

**What moved RSS:**
> "Finalizer correctness and a retain policy closed the fat-app gap while precise stacks did not."

From docs/STACK_MAPS.md and measurement data: Stack-map precision cost approximately 2x overhead with no RSS win on the tested workloads.

**Root-Discovery Bugs:**
- gcry took until v0.19 to close suspended-register cases (reading the suspended thread's register state correctly).
- Fiber stack scrubbing (writing specific patterns to detect whether a stack slot was ever used) was measured as throughput-neutral (~0.1% on Kemal).
- Static root blacklisting (ignoring certain global segments to reduce false positives) did not hurt RSS but caught some edge cases.

**Implication for iyi:** The same bugs (suspended-register cases, fiber stack bounds) will appear in iyi's collector. Inherit the solutions; do not rediscover them. Use similar stress and fuzz testing to catch them early.

---

## Correctness: Stress, Fuzz, Soak, Invariants

### Stress Testing

- Allocate, write, read, deallocate in a tight loop.
- Vary object sizes, reference graph shapes, collection frequency.
- Run for hours; measure peak memory, pause time, output correctness.
- Environment: `GC_STRESS=1` (trigger collection every N allocations, e.g., 100). Finds bugs that appear only when collection is frequent.

### Fuzzing

- Generate random object types and allocations.
- Allocate, build reference graphs, collect.
- Verify live objects are reachable from roots, dead objects are freed.
- Tool: libFuzzer or similar. iyi's samples are good fuzz inputs.

### Soak Testing

- Web server (Kemal) under synthetic load for 24+ hours.
- Monitor RSS, pause time, response latency.
- Trigger manual collections to verify pause/resume.

### Heap Invariant Checker

- Build flag: `GC_DEBUG_INVARIANTS=1`.
- Checks at collection boundaries:
  - Every object has a valid `type_id`.
  - Every scan offset is within `[0, scan_cap)`.
  - Every marked object is reachable from a root.
  - Free list is consistent.
- Crash on violation; dump heap state.

---

## The Verification Gate

**File:** `bench/dependency_floor.sh` (extended).

**Enforces:**
1. An iyi program compiled with `-Dgc_none` (default, no collection) links only libc (Linux), libSystem (macOS), kernel32 (Windows), wasi (wasm32).
2. An iyi program compiled with `-Dgc_gcry_internal` (iyi's own collector, once Stage 2 is done) links only platform libc plus atomic/concurrency symbols (pthreads on some platforms, Mach primitives on macOS).
3. New symbols must be justified by SPEC.md or Appendix B.
4. Regression detected: CI fails if a commit adds a symbol.

**Behavior:**
- Green: program links only expected symbols.
- Red: new symbol found. Author updates the expected list with SPEC.md justification.

**Example:**
```bash
iyi build samples/hello.iyi -o hello
nm -u hello | awk '{print $1}' | sort > /tmp/actual.txt

# Expected (Stage 4+):
# Linux: write, exit, memset, malloc, realloc
#        + mmap, munmap, signal (STW)
#        + pthread_atfork (fork reinit)
# macOS: + above but from libSystem
# Windows: VirtualAlloc, VirtualFree, SuspendThread, GetThreadContext, ... (kernel32)
# wasm32: wasi_fd_write, wasi_proc_exit (+ libc malloc/realloc for wasm32)

# Compare
diff /tmp/expected.txt /tmp/actual.txt > /dev/null || {
  echo "ERROR: New symbols found"
  comm -13 /tmp/expected.txt /tmp/actual.txt
  exit 1
}
```

---

## Summary: The Stages in Order

1. **Stage 1:** Pointer maps in `.iyimod`, object header design for tri-color marking, write barrier infrastructure.
2. **Stage 2:** mmap-backed allocator, size classes, arenas, platform integration.
3. **Stage 3:** Root discovery mechanisms (stack bounds, globals, fibers), pointer validation.
4. **Stage 4:** STW synchronization (platform-specific signals/Mach/Windows APIs).
   - **Point of no return:** Compiler depends on collection; bdw-gc fallback is gone.
5. **Stage 5:** Tri-color marking (single-threaded STW).
6. **Stage 6:** Sweep, finalizers, weak references.
7. **Stage 7:** Parallel marking (concurrent STW, multiple workers, work stealing, write barriers active).
8. **Stage 8:** Concurrent sweep, finalizer thread (optional; measure if necessary).
9. **Stage 9:** Incremental marking (optional; measure if necessary).
10. **Stage 10:** Windows and wasm32 support.

---

## The One Decision That Most Changes Its Size

**Parallel marking as a built-in design principle (Stage 1), not an add-on (Stage 7).**

The object header's mark word, the tri-color invariant, the write barrier infrastructure, and the work queue are all designed in Stage 1 to support concurrent marking. If parallel marking were an afterthought (added in Stage 7 by redesigning the mark representation), the cost would be a rewrite of Stages 1 to 6. By designing for parallelism from the start, Stage 7 is an implementation detail (adding worker threads), not a redesign. This is the difference between owning a collector and reimplementing gcry's single-threaded shape.
