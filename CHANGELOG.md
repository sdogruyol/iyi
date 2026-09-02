# Changelog

## Unreleased

### Added

- **The tarball went on the diet its own Learned entry prescribed.** The
  Linux release package used to carry libLLVM and everything libLLVM asks
  for — libedit, libxml2, libicu (icudata above all), libncursesw, libzstd,
  179 MB of `lib/` — because the compiler linked the distribution's shared
  monolith. It now links a minimal static LLVM built per Crystal's own
  recipe, recorded in 0.6.0's Learned entry and collected here:
  `BUILD_SHARED_LIBS=OFF`, `MinSizeRel`, only the five targets the
  compiler reaches (X86, AArch64, ARM, AVR, WebAssembly), and zlib, zstd,
  libxml2, ffi, z3 and libedit all `OFF`, so the closure never comes into
  existence rather than being bundled well. `lib/` is libgc and libstdc++
  at 3.4 MB, the tarball fell from 86 MB to 70 MB, and the installed
  footprint halved (227 MB to 107 MB). The clean-room proof is unchanged
  and passed on the first build: unpack somewhere else, run, and the
  package names nothing outside itself but the loader and libc.

  Two guards moved with it. `bundle-runtime-libs.sh` now reads which
  direction the binary chose: a shared-LLVM compiler must ship libLLVM —
  the original guard — and a static one must ship none, because a
  libLLVM in `lib/` would mean the link quietly went shared after all.
  And CI builds the static LLVM in its own container rather than
  downloading one built elsewhere, cached on the recipe key: a static
  archive must be linked by the glibc it was compiled against, and an
  archive from a newer machine is a link error or a silent
  binary-for-newer-glibc. The roughly-an-hour build is paid once per
  LLVM bump, not per push. darwin's tarball kept brew's shared LLVM for
  one commit, stated rather than implied, and the entry below is its diet.

- **darwin's tarball went on the same diet, and the recipe became one
  file.** 0.8.0's darwin package carried brew's shared libLLVM in `lib/`
  and, by the bundler's fixed point, everything it names outside
  `/usr/lib` and `/System` — because the compiler linked
  `/opt/homebrew/opt/llvm`. The darwin job now builds the same static
  minimal LLVM the Linux job builds, links against it, and ships `lib/`
  with libgc alone; `bundle-runtime-libs.sh`'s direction guard applies
  unchanged, and `otool -L` on the packaged binary must name nothing
  outside the package but `/usr/lib` and `/System`, which was already
  darwin's only self-containment proof and is now the one that matters.

  The recipe moved out of the workflow into `scripts/build-static-llvm.sh`
  on the way, because two cmake lines in two jobs are two recipes the day
  one is edited. It asserts what it built — `llvm-config --shared-mode`
  must say `static`, and no `libLLVM.so`/`.dylib` may exist under the
  prefix — and CI keys both caches on the file's own hash plus the
  runner's platform: editing the recipe is what invalidates the cache,
  no version token has to be remembered, and a darwin archive can never
  be restored into the Linux container (cache keys are repository-wide,
  and the previous key named no platform). The Linux cache rebuilds once
  for the key change. brew's `llvm` left the darwin install line: nothing
  in the job asks for it any more, and the bootstrap Crystal brings what
  it needs for itself. The recipe was run to completion on Linux before
  this entry was written — 13 minutes on 20 cores, `--shared-mode`
  `static`, the five targets, `-lrt -ldl -lm` as its whole system list —
  and the tarball built against it packages libgc and libstdc++ and
  nothing else, exactly as CI's own build did.

  darwin was then run the same way, on an M2 Pro (10 cores, Xcode's
  clang 21, macOS 26.5). The recipe took 9m36s, answered `static`, and
  its whole system list is `-lm`; `make -B iyi-tarball` against it said
  "static LLVM: no libLLVM to carry, and none carried", bundled
  `libgc.1.dylib` alone, and closed. Against 0.8.0's darwin package:
  the tarball fell from 72 MB to 50 MB and the unpacked footprint from
  217 MB to 154 MB; `lib/` went from 173 MB (libLLVM.dylib at 164 MB,
  libz3, libzstd, libgc) to 208 KB. It fell by less than Linux's because
  `bin/` grew from 30 MB to 139 MB — `iyi` and `iyi-daemon` each carry
  LLVM inside now, 72 MB apiece. `otool -L` on the packaged `iyi` names
  `/usr/lib/libSystem.B.dylib`, `/usr/lib/libc++.1.dylib` and
  `@rpath/libgc.1.dylib`; the bundler's fixed point converged in one
  turn; unpacked under `/tmp` the package ran `hello.iyi`, the kqueue
  exercise, `--crystal` and the daemon, and `iyi version` reported a
  release build. The four gates held against the compiler it built, and
  the floor's measured list for the compiler is `libc++ libgc libSystem`
  — libLLVM left it. One thing the run found that CI cannot: a shell
  exporting brew llvm's suggested `LDFLAGS=-L/opt/homebrew/opt/llvm/lib`
  rides into `--link-flags` ahead of `llvm-config --ldflags`, the linker
  takes brew's LLVM 22 archives for the static 20.1.2 ones, and the link
  dies on zstd and zlib symbols. Unset it.

- **What a kernel thread costs the floor, measured before the design
  that needs one.** Every open row in the tree waits on threads —
  GC_DESIGN.md's Stages 4, 7, 8 and 9, and `Share`, which III.4.7 counted
  and then refused to build without a caller — and III.9's objection was
  exact: a scheduler that reached for pthreads would put libc back on the
  link line. `bench/thread_floor.iyi` reaches for the kernel instead and
  the objection dissolves on Linux: `clone` with the thread flags onto a
  stack of the program's own mapping, the child's whole life inside the
  asm, `futex` on the tid word the kernel clears at exit for the join,
  and the binary keeps the five C-template names and nothing else —
  asserted by `bench/thread_floor.sh`, plain and release, with the
  aarch64 arm run under emulation in CI beside III.4's. The same probe is
  a stop-the-world entire: `rt_sigaction` with the kernel's four-word
  struct and a two-instruction `rt_sigreturn` restorer where x86_64
  needs one, `tgkill` to every thread, a handler that counts itself in,
  parks on a futex and counts itself out on one wake. Release build, 20
  cores, 200 rounds, threads spinning the whole time: stopping 1 thread
  is 2.1 µs best, 4 are 5.0 µs, 16 are 22 µs, and 64 — past the core
  count — are 84 µs best and 139 µs mean, because a handler that parks
  gives its core up and the next signalled thread runs on it at once.
  Resume is where the oversubscription lands: 0.6 µs for 1 thread, 2.9
  µs for 4, 11 µs best but 0.4 ms mean for 16, and 6.4 ms best for 64,
  because every woken thread goes back to spinning and the last one to
  count itself out waits for a timeslice. So marking workers never
  exceed the core count and the mutator side is bounded the same way,
  or a pause is milliseconds by construction. That reading replaced a
  first one that put the milliseconds on the stop and called the resume
  one wake at 0.3 µs: the release build's `xchg` store had clobbered
  the register the three counters were zeroed from, so nobody parked
  and the resume woke no one (the Fixed entry below has the
  instruction; the plain build of the same probe gave the shape above
  all along). The probe also priced two absences by running without
  them: no thread pointer at all, so the compiler emits nothing
  thread-relative for a body that neither allocates nor raises, and the
  real first cost of threads is that the scheduler, the poller and the
  arena are one thread's class variables; and no atomic in the prelude,
  so the probe's `lock xadd` and `ldaxr`/`stlxr` are what the mark
  word's CAS will be. GC_DESIGN.md carries the reading. darwin's thread
  is libSystem's by III.9's rule and is measured in the entry below.

- **Per-thread state has its mechanism, and it is the language's own
  `@[ThreadLocal]`, on the floor.** The thread floor's first run had no
  thread pointer at all and located the real first cost of threads: the
  scheduler, the poller and the arena are one thread's class variables.
  The second run answers it. A `@[ThreadLocal]` class variable is now
  emitted local-exec outright — one `%fs:`-relative or
  `tpidr_el0`-relative load at a link-time offset, inside the
  `noinline` accessor the compiler keeps for every thread-local (so a
  fiber that changes threads never reads a cached address) — because a
  program iyi links is always an executable, never a shared object. The
  general-dynamic default was relaxed to the same instructions by the
  linker but left `__tls_get_addr@GLIBC_2.3` undefined in the dynamic
  symbol table: a name on the link line the dependency floor counts,
  for a call that was never made. It is gone; a program with a
  thread-local variable keeps the five C-template names and nothing
  else, and the aarch64 object carries `TLSLE` relocations and a `mrs
  TPIDR_EL0`. `bench/thread_floor.iyi` then lays out a block per raw
  thread the way a static libc's startup does — PT_TLS found by walking
  the program headers from `__ehdr_start`, the initialised image copied,
  the pointer placed by the ABI's variant and handed to `clone` with
  `CLONE_SETTLS` — and every thread saw the image's initialiser in its
  own copy and its own tid in its own slot for the whole run, with the
  main thread's slot untouched. The driver's new failure proof drops the
  one flag bit, so every thread shares the main thread's block, and the
  program names the clash. The runtime's cutover to threads is therefore
  a spelling, not a mechanism: the scheduler's state becomes
  `@[ThreadLocal]` per scheduler thread and the allocator's fast path
  per-thread, with the shared structures behind the atomics the probe
  already wrote. GC_DESIGN.md carries the reading. The LLVM binding
  gained `LLVM::ThreadLocalMode` and `Value#thread_local_mode=` for it;
  `spec/compiler/codegen/thread_local_spec.cr` and `class_var_spec.cr`
  pass, and the wasm32 cross-compile of a sample and of `--crystal`'s
  stdlib sample still compile to their objects.

- **The park is a pipe, because a signal handler may call `read` and
  may not call `os_unfair_lock_lock`.** The per-thread lock the darwin
  probe chose by its numbers is not on Apple's list of async-signal-safe
  calls; it works, with no promise, which is not a footing for a
  stop-the-world. Two parks POSIX does promise were measured against it,
  same machine, release, 200 rounds: `sigsuspend` on a mask that admits
  SIGUSR2, released by a second `pthread_kill` per thread — Boehm's stop
  everywhere, one name in place of the lock's two, a resume that pays
  the kill loop twice (8 threads: 711 µs mean against 135) — and a pipe
  per thread, the handler blocked in `read`, released by one `write` per
  thread, which is the lock's numbers below the core count: stop 2.0 /
  20 / 50 µs best and resume 0.8 µs / 27 µs / 122 µs mean for 1, 4, 8
  threads, against the lock's 2.1 / 25 / 56 and 0.3 / 34 / 136. The
  pipe is the probe's park now, for `pipe` and `read` where the lock
  cost `os_unfair_lock_lock` and `_unlock`; the lock and `sigsuspend`
  stay as `-Dtf_park_lock` and `-Dtf_park_sigsuspend`, each held to its
  own exact list and printed in its own table up to the core count.
  Past it the pipe's stop mean is several times the lock's (16 threads:
  3.6 ms against 0.5) for a reason not read yet, outside the regime the
  design lives in and recorded as such. Go's park was weighed and not
  built: its handler blocks nowhere and rewrites the context so the
  thread parks itself in ordinary code, which on aarch64 needs a
  register no code ever holds live to jump back through after every
  other is restored — Go's compiler reserves R27 for it; LLVM reserves
  nothing for iyi, and darwin's reserved x18 is zeroed by the kernel on
  exception return. That is a codegen decision (reserve a register, at
  one fewer for every function) and GC_DESIGN.md records it as Stage
  4's open option against the pipe.

- **The stop handler reads the held thread's registers, and measures
  its own depth.** The probe's handler used to count itself in and park;
  the part between, which is the collector's, is in it now: the
  interrupted thread's sp and pc read out of the `ucontext` — the
  kernel's on Linux (160/168 on x86_64; 432/440 on aarch64, past the
  128-byte sigmask), libSystem's on darwin (the mcontext pointer at 48,
  sp at 264, pc at 272) — with the assertion that the sp is on that
  thread's own stack, the Linux mapping's bounds or a first-frame local
  on darwin, because a context that is not the thread's would scan the
  wrong stack and root nothing. The driver's third failure proof moves
  one offset by a word, so the handler reads pc as sp, and every handler
  says so. Proven on all three arms, the Linux two on real kernels in
  containers on Apple silicon (arm64 natively, x86_64 under Rosetta).
  The handler also records how far below the interrupted sp it ran —
  the kernel's frame, the trampoline and its own — and the number is
  Stage 4's next design input: 5.7 KB on x86_64 Linux, 4.7 KB on
  aarch64 Linux, 1.2 KB on darwin. A signal lands on whatever stack the
  thread is on, and a scheduler thread is on a fiber's 256 KiB mapping
  most of the time, so Stage 4 keeps that much spare above every fiber
  stack's guard page or gives each scheduler thread a `sigaltstack`;
  GC_DESIGN.md carries the reading.

- **darwin's thread is measured, and its floor is the pthreads price by
  name.** III.9's rule on darwin is the reverse of Linux's — raw
  syscalls are not a stable ABI, libSystem is the platform — so
  `bench/thread_floor.iyi` grew a `{% elsif flag?(:darwin) %}` arm that
  runs the same table, atomics, run and assertions through libSystem,
  and `bench/thread_floor.sh` now holds the darwin binary to an exact
  symbol list and only libSystem on `otool -L`, with the same two
  failure proofs, in the darwin CI job beside the dependency floor.
  What a thread costs there, each name a dependency taken on and
  recorded here: `pthread_create`, `pthread_join`, `pthread_kill`;
  `pthread_threadid_np`, the 64-bit id asked once by the thread and
  once by its parent of the handle, so the two views are compared the
  way `gettid` and the tid word are on Linux; `sigaction`, libSystem's
  sixteen-byte struct with `SA_SIGINFO` in the flags half of the
  second word, and libSystem's own trampoline for the return, so there
  is no sigreturn to write; `os_unfair_lock_lock` and
  `os_unfair_lock_unlock`, the park; and `__tlv_bootstrap`, a
  `@[ThreadLocal]`. Eight names over the runtime's twelve, none of
  them in `bench/dependency_floor.sh`'s list, because no sample
  spawns a thread and the list is a record of what samples cost. The
  park was chosen by measurement, because darwin has no futex and the
  `__ulock_wait` under libSystem's locks is private: a mutex and
  condition (four names) resumed 4 threads in 39 µs mean and 8 in 89
  µs; one shared `os_unfair_lock` (two names) resumed them in 177 and
  415 µs, because the kernel hands the lock waiter to waiter, a
  wakeup a link; one `os_unfair_lock` per thread on its own line,
  released by N unlocks back to back, is two names and 28 and 107 µs,
  and is what the probe keeps — the handler finds its lock through a
  thread-local, as Stage 4's will find its thread. `sched_yield` in
  the main thread's wait was measured and refused: a ninth name that
  cost the one-thread stop its own 4 µs reschedule (6.1 µs mean
  against 2.2) and bought nothing below the core count; above it the
  yield halved the stop mean at 64 threads (1.1 ms against 2.2) and
  left the resume at the same tens of milliseconds. A thread-local on
  darwin arrives differently from Linux and it is the eighth name:
  Mach-O has no local-exec, so a `@[ThreadLocal]` read is
  `adrp`/`add` to a 24-byte descriptor in `__thread_vars`, a load of
  its thunk and a `blr` — the thunk being `__tlv_bootstrap` from
  libSystem, which dyld rebinds to its own `tlv_get_addr` at load
  (`dyld_info -fixups` shows the bind) — and dyld lays every thread's
  block out itself from `__thread_data` on first touch, so `Tls.make`
  has no darwin arm and the isolation assertion is the whole proof:
  every thread read the image's 7 in its own copy and its own tid in
  its own slot, plain and release. The darwin failure proof deletes
  the annotation, since there is no flag bit to drop, and the program
  names the clash on the first thread joined. The numbers, release,
  M2 Pro (10 cores), 200 rounds, spinning threads, on the 24 MHz
  counter (CLOCK_MONOTONIC_RAW; see the clock entry under Fixed):
  stop 1 thread 2.0 µs best / 2.2 mean; 4 threads 23 / 35 µs; 8
  threads 54 / 100 µs; 16 threads 90 µs best, 0.95 ms mean, 15 ms
  worst; 64 threads 0.5 ms best, 2.2 ms mean. Resume 0.2 µs for 1, 10
  / 45 µs for 4, 18 / 155 µs for 8, then 4 ms best and 20 ms mean for
  16 and 110 ms mean for 64. The stop is the `pthread_kill` loop: each
  kill after the first costs 6–7 µs in the call itself (the loop alone
  is 24, 83 and 612 µs for 4, 8 and 16) where Linux's `tgkill` is
  about one. Past the core count the resume is XNU's 10 ms quantum,
  the way it is Linux's timeslice, so the core-count bound on
  marking workers and on M holds on darwin with more force. Two
  things found on the way: `bzero` was in every darwin `--release`
  binary, `hello` included — the aarch64 back end's lowering of a
  memset it will not inline, and the compiler zeroes every
  `Pointer.malloc` with one; a plain binary with a large constant one
  named it too — and no gate had seen it because
  `bench/dependency_floor.sh` builds plain; it is the prelude's own
  now, under Fixed. The price of the spelling is measured too: ten million
  read-modify-writes of a `@[ThreadLocal]` against a plain class
  variable, release build, each in its own `@[NoInline]` frame, cost
  3.2 ns to 2.0 on darwin and 4.7 to 3.0 on aarch64 Linux in a
  container — two accessor calls, one for the load and one for the
  store: the IR of both targets shows the compiler wrapping every
  thread-local's address in a `noinline` function so a fiber that
  changes threads never reads a cached address, and on darwin the
  thunk call sits inside it, dyld's fast path being a `tpidrro_el0`
  read and a table lookup — so the price is the accessor, not the
  platform, and the cutover's thread-local scheduler state is a call
  everywhere but not a cost; the driver prints the line beside the
  pauses. The other darwin
  stop was measured and refused: Mach's `thread_suspend` on the port
  `pthread_mach_thread_np` answers, which returns held, and
  `thread_get_state` for the registers — Boehm's darwin mechanism, no
  handler, no park, four names for the signal arm's four. Kept under
  `-Dtf_mach` with its own exact list and its own table in the driver.
  It loses at every count: stop 3.8 µs to 2.0 for one thread, 52 µs
  to 35 mean for 4, 5.4 ms to 0.95 for 16, 31 ms to 2.2 for 64, and a
  3 ms mean resume for 8 threads against 155 µs — each suspend returns
  only once its target has been through a core and stopped, one after
  another, where N kills are queued at once and the handlers stop in
  parallel. So Stage 4's darwin stop is the signal and a per-thread
  park — the lock, until the entry below asked whether a handler may
  call it. And the probe's "best" sentinel was 0,
  which a microsecond clock can measure; it is the first round now.
  GC_DESIGN.md carries the reading.

- **The prelude has an atomic, and the thread floor is its first caller
  and its gate.** `Atomic(T)` (`src/iyi/atomic.iyi`, SPEC.md III.4.10) is
  a struct holding one word, `T` one of the four integers `primitives.iyi`
  gives arithmetic to, and six verbs with Crystal's names and answers:
  `get`, `set`, `add`, `sub`, `swap`, `compare_and_set` — the
  read-modify-writes answer what the word held before, the exchange
  answers that and whether it happened. The instructions are the
  compiler's, four `@[Primitive]`s in `primitives.iyi` (`atomicrmw`,
  `cmpxchg`, an ordered load, an ordered store) on a holder of their own,
  because a call on a generic instance's class passes the class as a
  first argument and the atomic primitives take their operands from the
  front — the same reason Crystal's sit on `Atomic::Ops`. One ordering,
  sequentially consistent, and no parameter to weaken it: Go's rule, and
  a decision rather than an omission, argued in the section — an
  ordering parameter is the part of an atomic API people get wrong and
  nothing can check, and on x86_64, where the floor was measured, a
  sequentially consistent `add` and a relaxed one are the same `lock
  xadd`. The aarch64 difference (`ldaddal` against `ldadd`) is not yet a
  number, and the measurement that names it is what adds a weaker verb.
  `fence` is not built, and a pointer `T` is refused by name; each
  arrives with its caller.

  The thread floor's three `fun`s of inline asm — the ones whose `xchg`
  clobbered a register in the release build — are gone, and its counters
  are `Atomic(UInt64)` over the same words: `lock xadd`, `xchg`, `mov`
  and `lock cmpxchg` on x86_64, `ldaxr`/`stlxr`, `ldar` and `stlr` on
  aarch64, read off the release binary and the cross-built object. The
  floor holds by the gate's existing assertion — five C-template names
  and nothing else, plain and release — which is now also the proof that
  an atomic costs no `__atomic_*` name. The gate grew a seventh step,
  the atomic's own failure proof: every thread adds to one shared word
  on every turn of its loop beside a word of its own, the two totals
  must agree at the end, and under `-Dtf_plain_add`, a load and a store
  in the atomic's place, they do not — 4 threads, 23,689 adds, 12,477
  landed, exit 1 naming the 11,212 lost. With the contended add in every
  thread's loop the pauses kept their shape (release, 20 cores, 200
  rounds: stop 1.7 / 4.0 / 19 / 78 µs best for 1, 4, 16, 64 threads,
  resume 5.8 ms best at 64). On wasm32, which has one thread, LLVM
  lowers the same instructions to plain loads and stores, so the type is
  on every target and gated on none.

- **The scheduler's state is per thread now, behind one thread-local
  pointer, and the collector still finds it.** The thread floor's
  second finding was that the runtime's first cost of threads is the
  scheduler, the poller and the arena being one thread's class
  variables, and GC_DESIGN.md wrote the cutover down as a spelling:
  every field becomes `@[ThreadLocal]`. That spelling was measured
  before it was written and it lost — a `noinline` accessor per field
  per entry (the floor's touch line: three times a class variable's),
  and the run queue's head in a TLS block the root walk never scans.
  The scheduler is cut over the other way: `IyiSchedulerState`
  (`src/iyi/concurrency.iyi`) holds the running fiber, the run queue,
  the sleep and io lists, the poller and its buffer, and one
  `@[ThreadLocal]` pointer names the thread's own — Go's `g`. An entry
  pays one accessor and then plain loads, and every state ever made is
  linked on a class variable in the image's data, so the walk that
  scans the globals reaches it and the thread-local is a cache of a
  pointer the globals already hold. `bench/collect_trigger.sh` holds
  that as its own check: the state's address and its main fiber's are
  taken XOR'd with a key in a frame of their own, 64 MiB of churn runs
  64 collections, and the chunk must not carry the sweep's free flag
  — the proof unlinks the list and the flag is set after 8. The price:
  `bench/defer_cost.sh` reads about 8 ns per defer where it read about
  5, a `defer` being two `IyiScheduler.current` calls, and the release
  binary of the concurrency exercise has one `%fs:`-relative load (one
  `mrs TPIDR_EL0` on aarch64) where it had none, with no name added on
  Linux. darwin pays a name, `_tlv_bootstrap` — Mach-O has no
  local-exec, every thread-local descriptor names dyld's thunk, and
  every darwin program reaches the scheduler — recorded in the five
  gates that hold darwin's floor in this commit, by that script's own
  rule. The allocator's fast path was the half not cut over; the entry
  below is its cutover.

- **The allocator is a cache per thread and a centre under one lock,
  and the fast path touches no shared word.** `IyiHeap` was the
  directory page — a free-list head and a fill arena per class — as one
  thread's class variables, the other half of the thread floor's first
  cost. The split is Go's. The cache is one page a `@[ThreadLocal]`
  address names, laid out as the directory was and linked on
  `@@caches` when it is made, so the scavenge can strip every thread's
  lists and a stopped thread's cache is reachable by the thread that
  stops it; the centre is the class lists the sweep fills, the arena
  list and the large list, behind a spin lock that is one
  `Atomic(UInt64).compare_and_set` on a word of the centre's page.
  Allocation pops the cache or carves the cache's own arena, no lock;
  a cache that runs dry takes the centre's whole list for the class
  under the lock, one pointer swap (a bounded batch is the fairness a
  two-thread profile may ask for, and is not guessed); `map_arena` and
  `take_large` push under the lock; the sweep links an arena's white
  chunks as it walks and splices them to the centre under one take of
  it, and the scavenge strips the centre and every cache before the
  unmap. `free` goes to the caller's own cache: sent to the centre it
  cost a grow-by-doubling loop two lock cycles a step, 61 ns an
  alloc+free pair against 27, and the chunk a thread frees is the
  chunk it allocates next. The numbers, from `bench/arena_exercise.sh`,
  which measures release builds now beside plain ones because a person
  ships release: 4 ns to 6 ns an allocation in release — the one
  `%fs:` load — and 23 ns to 27 in a plain build, the one call; and
  `bench/collect_trigger.sh`'s pause total fell from 86 ms to 70 ms
  over 87 collections, the batched splice being cheaper than a `free`
  per chunk. Every collector gate holds, and `bench/sweep_exercise.sh`'s
  "frees nothing" proof now removes the splice rather than the `free`
  it no longer calls. What the split decides for Stage 4 is written in
  GC_DESIGN.md: a thread stopped while it holds the heap lock deadlocks
  the sweep, so the stop must defer past a held lock — Go's "no
  preemption inside mallocgc". The trigger's `allocated_since` is
  still one class variable every `take` adds to; it becomes a
  per-cache count when the thread that would race it exists.

- **The runtime has a kernel thread, and the collector stops it: Stage 4,
  built.** `IyiThread.start { }` (`src/iyi/thread.iyi`, SPEC.md III.4.11)
  is the thread floor's mechanism moved into the prelude — raw `clone`
  onto a guarded mapping with a TLS block laid out from PT_TLS on Linux,
  `pthread_create` on darwin, the futex on the tid word or `pthread_join`
  to join — and it costs the Linux floor no name. A thread gets a
  scheduler state and a heap cache on first touch, spawns fibers and
  allocates without a lock, and is not a task: nothing owns or cancels
  it, no channel crosses it, `Atomic(T)` does, and `Share` — whose
  reason for waiting was that no second thread existed — is the next
  piece owed. A collection takes the runtime's one lock, signals every
  other thread, and the handler copies the interrupted registers from
  the ucontext onto the thread's line and parks (futex; a pipe per
  thread on darwin); the collector scans each stopped thread's spill
  and its stack from the recorded sp to the top of the mapping holding
  it, the thread's own or a fiber's. A thread inside `IyiHeap.take` or
  spinning for the lock is asked rather than parked and parks itself
  where it holds nothing, which is Go's "no preemption inside mallocgc"
  reached from the deadlock it prevents; `SA_RESTART` restarts what a
  stop interrupts. A thread's last act returns its cache to the centre.

  Three things the first eight threads found, and their fixes. The
  trigger's count is the centre's atomic now, folded per cache every 64
  KiB, and the decision to collect is made again under the lock so the
  second of two threads crossing the budget together does not sweep the
  heap the first just swept. A refill that took the centre's whole list
  let one thread hoard every freed chunk while seven carved, and the
  heap and every sweep grew with it: the centre keeps a class's chunks
  as the sweep's own per-arena batches and a refill takes one. And a
  budget floored at a MiB met eight allocating threads as 4,000
  collections a second, each a stop of eight and a sweep of eleven
  arenas, 300 µs where one thread's was 15 — the budget is floored at
  half of what the sweep walked, which bounds a collection's cost per
  byte allocated whatever the threads carved; the single-thread gates
  keep their arithmetic exactly, and eight threads went from 634 ns an
  allocation to 239. Two entry points that were `fun`s put 12 KB of
  thread runtime into every binary, `hello` included, because a `fun`
  is emitted whether or not it is called; they are closure-free procs
  whose first word is the function, and `hello` is back to its size.

  `bench/thread_exercise.sh` is the gate, in the samples job, the
  darwin job and the aarch64 cross-run: eight threads allocating from
  their own caches while collections run from whichever crosses the
  budget, a live list in each thread's frames alone surviving them by
  checksum and by the sweep's free flag — after one explicit collection
  with every worker spinning on its list, and after twenty bursts of
  churn — fibers on threads with a parked one holding an object's only
  reference, 32 threads past the core count, the floor's five names,
  and the failure proof: the thread-root walk removed from a copy of
  the prelude, and the spinning threads' lists are swept out from under
  them, exit 1 by name. Forty runs at eight threads, plain and release,
  none hung and none failed. The price, release, 20 cores: 76 ns an
  allocation with one thread, 162 with four, 268 with eight — wall time
  per allocation per thread with every pause included, and the pause is
  every thread standing still for a sweep one thread runs, which is what
  Stages 7 and 8 exist to change. The stop half is the floor's number:
  22 µs for seven threads, 7% of a pause. The signal frame runs on
  whatever stack the thread is on, a fiber's included; the probe's 5.7
  KB is what a fiber must have spare above its guard, and a `sigaltstack`
  per thread is the answer built when a program's fiber is ever that
  deep. Every existing gate holds over the threaded runtime.

- **`Share` is built, and a thread's block may capture only what it
  marks.** SPEC.md III.4.4's marker, refused three times as a mechanism
  with no caller, has one: the block `IyiThread.start` runs on another
  thread. `Iyi::Share` (`src/compiler/iyi/semantic/share.cr`) decides a
  type structurally on the compiler's own AST, the way
  `bench/share_count.cr` counted it — a field is mutable if any method
  other than `initialize` assigns it, by `=`, `+=` or a multiple
  assignment, or a setter `field=` exists; every field's type must be
  shareable in turn; integers, floats, `Bool`, `Char`, `Nil`, `Symbol`
  and enums are, `Pointer` is raw memory and is not, nor are
  `StaticArray` and a `Proc`, and a tuple, union or base-typed class is
  when every member or subclass is. `@[Share]` on a declaration is the
  trust half — shareable whenever the type arguments are, whatever the
  fields do — and `Atomic(T)` and `samples/iyi/std/list.iyi`'s `List(T)`
  carry it, the list the spec said should stay short. The marker
  travels: a producer writes `@[Share]` into the artifact declaration
  of every type it found shareable, in the annotations slot the
  declaration already had, and a consumer reads that and never
  recomputes, because the bodies that said no field is assigned are not
  in the artifact — an imported type without the marker is refused with
  the artifact as the reason. The gate is in the cleanup pass beside
  the one that refuses a closure to a C function: every variable the
  block captures, and `self` when the block reaches an instance
  variable, is asked, and the refusal names the variable, its type and
  the field that failed one level at a time —
  `captures \`items : Array(Int32)\`, which is not Share: Array(Int32)'s
  field @size is assigned in \`unsafe_set_size\``. Eight shapes in
  `spec/compiler/semantic/iyi_spec.cr`, the artifact round trip in
  `spec/compiler/iyimod_spec.cr`, and `bench/thread_exercise.sh`'s new
  last step: a program capturing an `Array` that must not compile, and
  does not, by name. A channel's `T : Share` waits for the channel that
  crosses threads.

- **The sweep is lazy: a collection marks and returns, and the allocator
  sweeps what it needs.** The pause was the mark plus a walk of every
  carved chunk, and on `bench/gc_race.py`'s binary trees the walk was most
  of a 12.8 ms pause. A collection now marks, stamps a new epoch and
  returns; every arena behind the epoch is sweep debt, and
  `IyiHeap.refill` pays it one arena at a time when a class's chunks run
  out — the sweep's cost lands on the allocations that need its memory,
  in proportion to them, never in the pause. Sound because every chunk
  wears the parity of the epoch it was handed out in (mark-word bit 4):
  a white chunk of the current parity was allocated after the mark and
  is alive by construction, one of the last parity was unmarked and is
  dead, and a survivor is restamped when the sweep repaints it. The
  budget comes from the mark itself, which adds each object's size as it
  blackens it — twice what is live, Go's GOGC=100, floored at 4 MiB —
  and the budget floored at the sweep's walk is gone, with the feedback
  it had: on binary trees it took the heap to 160 MiB for 3 MiB live.
  Arenas are 16 MiB-aligned now, and a byte per slot of the address
  space says which slots are arenas, so `base_of` is an AND, a shift and
  a load where it walked the arena list per pointer the marker met. The
  scavenge is the pause's: the mark counts what it blackened per arena,
  and an arena with nothing alive goes back with every thread stopped —
  a sweeper on one thread cannot strip a running thread's cache. The
  numbers, `bench/gc_race.py`, release, 20 cores: binary trees 12.8 ms
  longest pause to 2.7 ms, 182 MiB peak to 46; live churn 28 ms to 8.8;
  churn 0.15 ms to 0.04 and 9 ms paused in all to 0.3 — and binary
  trees' wall time rose from 0.163 s to 0.266, because 54 marks of the
  live tree replaced 11, each on one core while nineteen idle, which is
  the next entry's job. Three things the first threaded run found: a
  thread that read the epoch before parking in `map_arena`'s lock spin
  linked an arena that looked like debt and was not counted as any, the
  next pause swept it in place of a real one, the real one kept the last
  mark's black, the mark never re-counted those objects, and the scavenge
  handed a mapping of live objects to the kernel — the epoch is read
  under the lock and the pause sweeps every arena behind the epoch, not a
  counted number; the deferred park at `take`'s exit was inlined and the
  chunk `take` was returning sat in a scratch register nothing scanned,
  so `park_if_requested` and `stop_here` are `@[NoInline]`; and the carve
  stamps a chunk's parity before it publishes the cursor, with an ordered
  store, so a sweeper on another thread cannot read a fresh chunk as last
  epoch's dead. `bench/collect_trigger.sh` holds the sweep to being lazy
  — the allocator must sweep at least an arena per collection, and the
  proof that removes its sweep is named — and every collector gate holds.

- **The mark is parallel: helpers on kernel threads, a stack per worker,
  a pool of batches between them — Stage 7.** `IyiThread.start_helper`
  gives the collector kernel threads the stop never names — no line, no
  cache, nothing allocated from the heap — and the marker keeps its state
  on one page per worker named by one `@[ThreadLocal]`, read once when a
  drain begins, because every thread-local read is a `noinline` call and
  fifteen of them per object doubled the mark before the page. Gray goes
  to the worker's own stack; a stack past 512 spills its top as a batch
  to the pool, and — the finding — a stack of any depth donates its
  bottom half when the pool is empty and a worker is idle, at most every
  256 pushes: a depth-first mark of a tree keeps a stack as deep as the
  tree and no deeper, its oldest entries are its widest subtrees, and a
  marker that only spilled a full stack never shared a tree at all
  (fifteen helpers idle through binary trees), while one that donated on
  every push chopped a million nodes into eight-entry batches through
  one lock and took twice as long as alone. Shading is a compare-and-swap
  on the colour bits when helpers run and a plain store when the mark is
  alone — a fence per object was a third of a mark — and blackening is
  always a plain store, since only the worker that grayed an object holds
  it. Helpers are sized by the work, one per MiB the last mark found
  live, up to the core count less one capped at fifteen, and parked on a
  futex between marks (a spin with a yield on darwin, which has none);
  a mark under a MiB runs alone. Termination is a count of workers
  holding work beside an empty pool, and a helper that read the
  generation after it turned would have slept through the mark and hung
  the collector waiting for its answer, so a helper counts itself ready
  at its first park and the collector waits for every helper it started
  before it turns the generation. `bench/parallel_mark.sh`: a million
  typed nodes, 40 MiB, five marks alone and five with helpers, 12.7 ms
  to 6.0 on 20 cores with the helpers blackening 95% of the nodes, and
  the proof that a marker which never donates is refused by name. On
  `bench/gc_race.py`: binary trees' longest pause 2.7 ms to 2.3, total
  paused 94 ms to 51, wall 0.266 s to 0.219. A linked list — live churn —
  gains nothing, as no parallel marker can: a chain is one worker's walk.

- **The mark runs beside the program, on a write barrier the compiler
  emits — Stage 9.** A collection is two stops now and neither is the
  mark: the first, on the triggering thread, grays the roots, raises a
  byte (`__iyi_marking`), wakes the helpers and resumes the world — 15 to
  35 µs; the helpers drain beside the program; the second, on helper 0
  once every helper found the pool empty, flushes every thread's barrier
  stack, rescans the roots, drains what that found, and turns the epoch.
  Codegen wraps every store that can put a heap pointer into heap memory
  — the `assign` funnel every typed store comes through, a C struct's
  field, a closure's captured variables, parent and `self` — in a test
  of the byte and, while it is up, a call after the store with the
  destination's words, each heap pointer among them grayed onto the
  storing thread's own stack (Dijkstra's insertion barrier, by re-reading
  the destination, so one shape serves a word and a struct). Stores into
  stack slots, walked through the GEPs and casts to their `alloca`, are
  not wrapped: the stack is rescanned at the second stop. Objects born
  under the mark are born gray; a `realloc`'s copy is shaded whole; and
  the bracket around a store is the allocator's own depth counter, so a
  thread is never parked between a pointer store and its shade. The
  second stop looks before it drains: a white root, or a pool past
  sixteen batches, and it resumes the program, marks beside it once
  more, and stops again, up to eight times — a pointer loaded from a
  white object into a register was a 200 000-node chain walked inside
  the stop, 2 ms, before the retreat — and what the last stop finds it
  drains alone, because waking fifteen helpers inside a stop cost up to
  1.5 ms for a thousand entries. The first collection of a program goes
  beside it too, helpers spawned before the stop; stopped, it was the
  longest pause in every table. The last epoch's sweep debt is paid by
  the triggering thread before its stop, under the lock the allocator's
  own sweep takes — 500 µs of sweeping was the first stop's largest part
  against 20 µs of roots, and paying it beside the program is Stage 8.
  What was allocated under the mark is counted marked but not survived:
  the budget is twice the rest, and those bytes open the next budget.
  `bench/concurrent_mark.sh`: twenty-four rounds each move a payload out
  of an unmarked 200 000-node chain into a holder the marker blackened
  first, under a mark the round started itself, and read it back after
  — its header without the sweep's free flag, its bytes the pattern
  written — and the failure proof removes the barrier's shade and the
  first payload is freed by name. Release, 20 cores: the chain marked
  stopped is 1.9 ms; beside the program the longest first stop 0.6 ms,
  the longest second 0.2 ms. `bench/gc_race.py` against Go: binary
  trees' longest pause 0.10 ms to Go's 0.19 (was 2.3 with the parallel
  marker), live churn 0.47 to 0.10, churn 0.03 to 0.48; total paused
  2.6 ms to 2.1, 1.1 to 0.3, 0.3 to 3.6. Resident memory is Go's column
  still (62 MB to 18 on binary trees), the price of no assists; that and
  Stage 8 are next. `IyiMark.settle` waits out a collection in flight,
  for a program that reads the count after churn: the count is of
  finished collections, and a mark beside the program is not one yet.

### Fixed

- **The layout table refused a `StaticArray`, and any program holding
  one in an `uninitialized` local failed to build.** `gc_type_layout`
  asked an LLVM array for its struct elements; a static array has no
  fields, every word of it is an element, and it gets no entry now — the
  marker word-scans an object it has no entry for to its size, which is
  exactly the elements. Found writing a debug print with a stack buffer.

- **The darwin floor lists were behind the parallel marker by two
  names, and the identity floor found the race script calling the
  upstream compiler by its name.** `pthread_create` and `sysctlbyname`
  joined every darwin program with Stage 7 — the collector starts its
  helpers as kernel threads sized by `hw.ncpu` — and `pipe` and
  `sigaction` join with Stage 9, whose second stop registers the main
  thread and installs the stop's handler, and a line's park on darwin is
  a pipe; the seven darwin lists carry the four, the thread floor's
  runtime list rather than its probe's, and `bench/dependency_floor.sh`
  says why. `bench/gc_race.py`'s docstring
  said the Boehm arm was what Crystal ships; it is what the upstream
  compiler ships.

- **A helper's stop stopped nobody in a program that never started a
  thread, and the sweep ran beside it.** The main thread has no line
  until the first `IyiThread.start`; the trigger registers it before its
  first concurrent collection, before the lock, because registering takes
  it. Found by `bench/collect_trigger.sh`'s no-lazy-sweep proof, a
  segfault in the scavenge one run in four.

- **The first concurrent collection hung one run in twenty: the pool's
  page was made by whichever thread reached it first.** With the helpers
  started before the stop, a helper and the collector reached it at
  once, each mapped a page, and the helpers counted ready on one the
  collector never read. The collector makes it before the first helper
  exists.

- **A mark worker's stack cost 2 MB resident for 4 KB used.** The 32
  MiB mapping, touched at one end, was given a transparent huge page at
  its first touch — 34 MB across sixteen workers, on a program with a
  4 MiB budget. The worker stacks and the helper threads' stacks refuse
  huge pages by `madvise(MADV_NOHUGEPAGE)`, a syscall on Linux and no
  name on the floor: churn's resident memory 49 MB to 19.

- **The thread floor's x86_64 store clobbered its own value, and the
  release build handed `clone` a stack of 0.** `__tf_store` was the
  `xchg` idiom for a sequentially consistent store with its value
  register declared an input; `xchg` writes that register back with what
  the memory held. The plain build reloaded every value from the stack
  and never noticed; the release build kept the thread's stack base live
  in the register across the store of it into the table, got 0 back, and
  the child's first instruction faulted at 0x3fff0 — a segfault with no
  line, in the samples job, on the commit that added the held-context
  read. Found by building the release for x86_64-linux-gnu and running
  it under Rosetta in a container with a SIGSEGV handler that prints
  rip, rsp and the faulting address out of the same ucontext offsets the
  probe measures. The store is `mov` and `mfence` now. `__tf_add`'s
  `lock xadd` was already right: its register is tied to the output.
  It was not the first reuse, only the first that faulted: the release
  probe had zeroed its three counters through one register from the
  start, `xchg %rcx,(%rax)` three times with no reload between, so the
  second and third stores wrote the first counter's old value — the
  thread count — into `resumed` and `resume`, no handler ever parked,
  and the first Linux reading's "resume is one wake at 0.3 µs" was a
  wake of nobody. The reading above was taken again with the fixed
  store, and the plain build of the old probe, which reloads, had been
  giving the corrected shape all along.

- **A darwin binary clears its own memory: `bzero` is the prelude's.**
  Every darwin `--release` binary — `hello` included — and any plain one
  with a large constant `Pointer.malloc` asked libSystem for `bzero`,
  because codegen zeroes every allocation with an `llvm.memset` and the
  aarch64 back end spells a zeroing memset it will not inline `bzero`,
  not `memset`; the prelude intercepted `memset` by defining it and had
  never heard of the other name, and no gate read a release binary on
  darwin until the thread floor did. The measure is Go's: a runtime
  competing with it links libSystem for the kernel's door and for
  nothing it can write itself, and a clear loop is the first thing it
  can. The prelude now defines `bzero` beside `memset` in the collector's
  branch (the `-Dgc_none` branch takes libSystem's allocator by choice
  and keeps its `memset` and `bzero` with it). The body is inline-asm
  stores, a word then bytes, on both darwin architectures, and not a
  loop or a call to `memset`: the loop-idiom pass spares only functions
  named `memset` and `memcpy`, and the first version, written as
  `memset`'s loop, came back from the optimiser as a tail call to
  itself on its own byte tail and hung the root exercise. A release
  `hello` on darwin is back to the runtime's twelve names; the thread
  floor's release list is its plain list; the root gate's list lost the
  name it had carried for a day.

- **darwin's clock is the 24 MHz counter now, not a microsecond
  rounding of it.** The prelude read `clock_gettime_nsec_np(6)`,
  CLOCK_MONOTONIC, for the sleep queue, the collector's pause stamps and
  the arena exercise's stopwatch, and on arm64 that clock answers in
  whole microseconds: the thread floor's 2 µs stop came back as 2000 or
  3000, its sub-microsecond resume as 0, and every `IyiMark.pause_*_ns`
  a darwin program reports was rounded the same way. CLOCK_MONOTONIC_RAW
  (4) is the counter itself, 42 ns a tick, the same libSystem name and
  no new one; it stops in sleep and counts from boot exactly as 6 does,
  and lacks only the slew a duration never wanted. All three readers use
  it, and the thread floor's own darwin clock, written to get around the
  rounding, is gone.

- **The thread floor's aarch64 Linux arm never ran to the end in CI, and
  now does.** `clone`'s argument order differs by architecture: x86_64
  takes (flags, stack, parent_tid, child_tid, tls), aarch64 takes (flags,
  stack, parent_tid, tls, child_tid), and `__tf_clone`'s aarch64 asm
  loaded them in x86_64's order. Every raw thread's pointer was therefore
  its table line and the kernel wrote its tid into the TLS block's
  control word, and the first check — the tid the thread read against
  the tid word the kernel wrote — failed with a 0 on every thread. The
  cross-run job, the one place that arm runs, was red on all three
  thread-floor commits, and the entries above that say "aarch64 under
  emulation in CI" described the job that was meant to prove it, not a
  pass. Two registers swapped; proven this time on a real arm64 Linux
  kernel (a debian container on Apple silicon, no emulation): two and
  eight threads, every property, the clone-flag failure proof naming
  the clash, and the same `every property held` line the job greps
  for.

- **The collector's five gates and the defer cost now run in the darwin
  job, and running them found what nobody had.** The owned collector
  has been darwin's default allocator since the flip, and the darwin
  job ran samples, III.4, III.1.4 and the floor — not
  `bench/{arena,root,mark,sweep}_exercise.sh` or `collect_trigger.sh`,
  which the samples job runs on Linux. Run on a Mac, four of the six
  failed. Three were allowlists that predated the machine they were
  read on: the arena, root and mark gates' darwin lists still carried
  `malloc`, `memset` and `realloc` from before the flip — entries that
  would have let a fall-back to libSystem's allocator pass — and had
  never learned the names the poller (`kqueue`, `kevent`, `__error`,
  `clock_gettime_nsec_np`) and root discovery (`pthread_self`,
  `pthread_get_stackaddr_np`, the two `_dyld_get_image_*`) put on every
  darwin program's line; each list is now the exact set the gate's
  binary asks for, with a reason beside every name (`bzero` was among
  the root gate's for a day, until the prelude owned it). The fourth was real:
  `collect_trigger.iyi`'s release build on darwin panicked at
  "scavenge: 6 arenas at the peak and none went back to the kernel",
  because the spike's root sat in a global written and never read, the
  optimiser dropped the store, the chain was collected before `peak`
  was measured, and the scavenge check compared a heap that had
  already shrunk with itself — the same defect the sweep gate's 2 MiB
  root had and fixed, on a step written after that fix. Linux was not
  spared the elision — the release IR for x86_64-linux-gnu carries no
  trace of the global at all, on either target it is gone — and its
  gate passed only because something on that machine still named a
  node when the collect ran, which is the kind of pass a conservative
  scan hands out and a gate must not rely on. The exercise reads both
  of its roots back now, which is what makes them roots on either.
  `sweep_exercise.sh` and `defer_cost.sh` passed as they were. All six
  are steps in the darwin job beside the thread floor.

- **`make -B iyi-tarball` packaged an unoptimised compiler past the guard
  that exists to refuse one.** `release := 1` is the goal's own variable
  and does not travel into the `$(MAKE) install_iyi` the recipe runs; `-B`
  does travel, through `MAKEFLAGS`, so the sub-make rebuilt `iyi` again
  *after* `check_iyi_is_release` had passed, without `--release`, and
  installed that. Nothing about the tarball looked wrong: `bin/iyi
  version` inside it said "not built in release mode". Found by running
  the tarball that way once while proving the recipe above. The sub-make
  is now handed `release=1` explicitly; the same `-B` run builds release
  twice and packages release, and the plain `make iyi-tarball` against a
  stale unoptimised binary still refuses by name.

### Learned

- **The next 18 MB of tarball is the compiler's own backtrace, and it
  stays.** After the diet the Linux package is 215 MB unpacked and
  `bin/` is 197 MB of it: `iyi` and `iyi-daemon` at 103 MB each, the
  same sources built with and without `-Dwithout_mt`. `size -A` on one
  says 38 MB of that is DWARF — `.debug_info` 10.8 MB, `.debug_line`
  6.9 MB, `.debug_ranges` 3.6 MB and their strings — all of it Crystal's
  default line tables for the compiler, since MinSizeRel LLVM emits none.
  Stripped, the package would be 143 MB and the tarball 52.5 MB against
  70. Measured, and refused: a three-line program built `--no-debug`,
  `strip`ped, or `strip --strip-debug`ged prints its unhandled exception
  as `from ./bt in '??'` on every frame, because the runtime takes
  function *names* from DWARF too, not from the symbol table. A downloaded
  compiler whose crash report is three rows of `??` is the wrong 18 MB to
  save. The Linux runtime reads DWARF from the executable alone
  (`Exception::CallStack.load_debug_info_impl`), where darwin already
  looks for a sibling `.dSYM`; a `bin/iyi.debug` companion the Linux
  runtime could learn to open would make the saving free, and is the
  shape this should take if it is ever taken. The other 103 MB — the
  daemon being a second copy of the compiler with LLVM inside — is a
  runtime question (`fork` against multithreaded codegen), not a
  packaging one.

## 0.8.0 — 2026-09-01

**The collector is the default.** 0.7.0 built it; this release seats it: a
plain `iyi build` on Linux x86_64, Linux aarch64 and darwin allocates from
the owned arena, collects under its own allocation-pressure trigger, hands
empty mappings back to the kernel, and times every pause on the kernel's
own clock — with the dependency floor exactly where it was, and on darwin
lower: `malloc`, `realloc` and `memset` left the symbol list, `mmap` and
`munmap` joined it, and on Linux the object still leaves nothing undefined
at all. The measurement came before the decision (`bench/gc_default.py`):
the collector wins or ties every time column against both predecessors and
holds RSS at the live set where a heap that never frees holds it at the
garbage.

The doors out are chosen now, not shipped: `-Dgc_none` is the bump pointer
— the old default, the last nanosecond, unbounded memory — and
`-Dgc_boehm` is libgc, arriving only when asked for. Along the way the
header learned to say *atomic* (an `Array(Int32)` buffer is never
word-scanned again), the sweep learned to return whole arenas, the pauses
got `last`/`max`/`total` in nanoseconds, and every property has a gate
that fails by name when the mechanism is removed.

`.iyimod` format is unchanged at v43, and identity is the released version
as ever: a 0.7.0 artifact is rejected by a 0.8.0 build and rebuilt, never
migrated.

### Added

- **The heap breathes out, and the pauses have numbers.** Two things a
  collector must do before "collector" stops needing qualifiers. A sweep
  that finds an arena with no live chunk now hands the whole 16 MiB
  mapping back to the kernel — the class's free list stripped of that
  mapping's chunks first, the arena unlinked from the heap's own walk,
  then the `munmap`, in that order because the order is the safety
  argument. One warm arena per class stays as the cushion that spares a
  spike-then-idle program the mmap on its next allocation. Before this a
  heap only ever reached a high-water mark: chunks came back, mappings
  never did.

  And every collection times itself — a raw `clock_gettime` syscall on
  Linux writing into a page of the collector's own, because a collector
  must not allocate a timespec from the heap it is collecting, and
  libSystem's `clock_gettime_nsec_np` on darwin — with `last`, `max` and
  `total` nanoseconds riding the statistics. `bench/collect_trigger.sh`
  grew the step that holds both: a 64 MiB chain forced ten arenas into
  existence, dropping its root gave four back to the kernel with the
  count asserted and named when the scavenge is disabled, and the pause
  line prints from the real run — sub-millisecond steady-state
  collections, tens of milliseconds at the spike's conservative peak —
  reported rather than asserted, because a pause budget would be a
  number the gate made up before anything reads it.

- **The owned collector is the default allocator.** A plain `iyi build` on
  Linux x86_64, Linux aarch64 and darwin now allocates from the arena,
  collects under the allocation-pressure trigger, and hands memory back —
  with the dependency floor exactly where it was: on Linux the arena is
  raw syscalls and the object still leaves nothing undefined, on darwin
  it is libSystem's `mmap`/`munmap`, named in the floor's list with the
  flip as the reason. The measurement came first
  (`bench/gc_default.py`): the collector wins or ties every time column
  against both predecessors and holds RSS at the live set where a heap
  that never frees holds it at the garbage.

  The doors out: `-Dgc_none` selects the bump pointer — allocate, never
  free, the old default, still the right tool for a short-lived program
  that wants the last nanosecond — and `-Dgc_boehm` selects libgc, both
  held by `bench/dependency_floor.sh`: libgc arrives only when asked for,
  and the opt-out stays as library-free as the default it used to be.
  `-Dgc_iyi` still names the collector and is now the default spelled out
  loud. The selection lives in two places that must agree — the prelude's
  allocator seam and `Program#iyi_gc_arena?` in the compiler, which gates
  the type-id store and the layout table — and each names the other,
  because a compiler writing ids into a header the prelude did not
  allocate is memory corruption, not a degradation.

  Every collector gate now drives the *default* build and a `-Dgc_none`
  arm where the bump pointer is the thing under test; the concurrency and
  panics gates run collector-backed default builds, which makes them the
  first integration proof that a program can schedule, panic and collect
  in the same process without noticing. Appendix B #23's known leak —
  "a default that ships a known leak" — is retired the way its own last
  sentence promised: the never-collecting mode is chosen now, not
  shipped.

- **The header says atomic, and the default-flip question has its
  numbers.** `bench/gc_default.py` is the measurement the collector's
  record demanded before any default moves: the same programs, iyi's own
  prelude, three allocators, time and peak RSS. The first reading found a
  real defect — the live-set row ran ten times slower under `-Dgc_iyi`
  than under the bump pointer, because the header had no way to say
  *atomic*: a 32 MiB `Array(Int32)` buffer, allocated through
  `__crystal_malloc_atomic64` on the promise it holds no pointers, was
  word-scanned at every triggered collection, twenty milliseconds of
  `base_of` on integers. `ATOMIC_FLAG` is mark-word bit 3, set exactly
  where `clear` is false — the not-clearing path and the no-pointers
  promise are the same path — carried across `realloc` with the data the
  promise is about, and honoured by the marker the way Boehm honours
  `GC_malloc_atomic`: blackened, never opened. The row fell from 0.187 s
  to 0.017 s, level with the bump pointer.

  The table after the fix, best of five, worst peak RSS: the owned
  collector wins or ties every time column — churn at 0.048 s against
  the bump pointer's 0.125 s and Boehm's 0.091 s — and holds RSS at the
  live set (15–34 MiB) where the bump pointer holds it at the garbage
  (551–767 MiB). The flip stays a decision for a release of its own;
  what the table changes is that the evidence now argues for it.
  `mark_exercise`'s graph nodes moved to pointer-element buffers on the
  way, because a graph built in atomic nodes is invisible past its roots
  under either collector — the exercise was leaning on the scan the
  promise forbids.

## 0.7.0 — 2026-09-01

**The language owns a collector, and it runs itself.** Behind `-Dgc_iyi`,
the whole machine: a size-class arena allocator that costs no symbol and
no library, roots from the stack, the spilled registers, the globals and
every suspended fiber's stack, marking that is precise where the header
names a type and conservative everywhere else, a sweep that hands memory
back, and an allocation-pressure trigger — one collection per live-set of
garbage, floored at a MiB, with nobody calling `collect`. Every stage is
gated, every gate proves it can fail, and all of them run in CI.

What it is not, said here rather than found: opt-in — the default build
still allocates and never frees, and moving that default is 0.8.0's
measurement, not this release's side effect. Collections run on the
allocating fiber at allocation points only; arenas stay mapped for their
free lists; finalizers and weak references wait on the language having
the features; threads, and with them parallel marking, wait on threads.

And a fix every released compiler needed: the prelude's own `memset`
strode eight elements where it meant eight bytes, so every runtime-sized
clear left seven of eight bytes dirty and wrote one word in eight far
past its count. Invisible on the bump allocator's zero tail, consistent
with everything the Windows watch ever recorded, fixed on all three
targets that carried it.

`.iyimod` format is v43 — the `Layouts` section carries each type's
pointer map — so a 0.6.0 artifact is rejected by a 0.7.0 build and
rebuilt, never migrated.

### Added

- **The collector runs itself: allocation pressure triggers a collection.**
  Until now every collection was a call the exercises made, which is a verb,
  not a collector. `IyiHeap.take` — the one funnel every `-Dgc_iyi`
  allocation passes through — now reports each request's size, and when the
  bytes allocated since the last collection cross the budget, one runs,
  before the carve, so the object about to be born cannot be swept while it
  has no root. The budget after a collection is twice what survived it,
  floored at a MiB: a program whose live set is L pays one collection per L
  bytes of garbage — the amortised O(1) every tracing collector prices at —
  and a program that never crosses a MiB never pays at all.
  `IyiMark.auto = false` is the door the phase exercises use, the same
  switch Boehm spells `GC_disable`, because a test choreographing colours
  cannot have a string interpolation's allocation collecting mid-check.

  The trigger's steady state found the sweep's quadratic. The freed-chunk
  check was a walk of the class's free list — the design's own comment
  called the O(1) form "not a thing to build before a profile asks" — and
  the first run of the trigger exercise took 106 seconds, one long free
  list walked once per chunk per sweep. The check is now one load: `free`
  sets a FREE flag in the chunk's own mark word (bit 2, the flags the
  header reserved), `take` clears it with the mark word it already zeroes,
  and the same exercise runs in 0.1 seconds.

  `bench/collect_trigger.sh` is the gate, and nobody in it calls
  `collect`: a quarter MiB of churn triggers nothing, 64 MiB triggers
  collections and the heap stays at three arenas with a rooted survivor's
  bytes intact, the same churn against a 4 MiB live set collects an eighth
  as often, and a parked fiber's only reference lives through the pressure
  — the fiber-stack walk carrying weight under a trigger it cannot see
  coming. Two failure proofs: the pressure report removed leaks by name,
  and a budget pinned to the floor fails the growth check. A speed step
  keeps the quadratic from returning. And the collector's gates are in CI
  now — found unwired while adding this one: all five merged green on the
  machine that built them and none was named in the workflow, which is the
  exact defect the workflow exists to prevent.

- **The marker reads the map: precise where the header names a type,
  conservative everywhere else.** The two halves the record said were
  next, built together because each is what makes the other reachable.
  Codegen stores an object's `type_id` into the GC header at the
  allocation site — `allocate_aggregate`, right after the malloc
  returns, exactly where the prelude's header comment said it belonged —
  and the mark loop looks the id up in the layout table the compiler
  already embeds, by binary search, and scans exactly the pointer
  offsets the `TypeLayout` names. An integer field holding something
  address-shaped retains nothing through a typed object now. An id of
  zero — a `Pointer(T).malloc` buffer, a closure environment — keeps the
  conservative word-scan, and a missing table entry falls back the same
  way, never a crash. The symbol grew its promised unconditional
  definition (an empty table rather than an absent one), and its
  declaration moved to `Void*` after the release build refused a
  pointer initializer on an `i64` global — the single-module arm caught
  what the multi-module arm forgave. `bench/mark_exercise.sh` holds it
  from both sides: sixty-four typed nodes' pointer-field children all
  black, their integer-held decoys white by a majority no stale root
  word can fake, and a prelude with the lookup disabled exits 1 naming
  the retention.

- **A suspended fiber's stack is a root now — Stage 3's fourth task,
  closed.** The recorded gap from the collector's rebase: 0.4.0's
  scheduler parks fibers whose 256 KiB stacks the root walk never
  reached, so an object reachable only from one would have been freed
  live. The scheduler now keeps an all-fibers registry — its wait queues
  could not serve the walk, since a channel-parked fiber lives in the
  channel's own nodes and a joiner hangs off the fiber it waits on — and
  `each_fiber_root` scans every suspended fiber from its saved stack
  pointer to its stack top, runnable fibers included, done ones skipped
  by state. The running stack's own scan caps at the current fiber's top
  rather than the thread base, because from a spawned fiber the range up
  to the thread base crosses an unmapped gap and faults.
  `bench/root_exercise.sh` holds both directions: an address held only
  on a suspended fiber's stack is found by the walk, and a prelude with
  the fiber walk removed exits 1 at that check's own name.

- **The collector sweeps, so the memory comes back.** GC_DESIGN.md Stage 6, and
  with it the collector works end to end behind `-Dgc_iyi`: allocate, mark,
  sweep, and the chunk is handed out again. One walk over every carved chunk. A
  white object is unreachable, so its chunk goes back on its class's free list;
  a black one survives and is repainted white for the next cycle, which is why
  sweep needs no second pass. Large objects walk their own list, with `next`
  read before the node is released, because releasing it unmaps the memory the
  link lives in. A chunk already on a free list is skipped rather than freed
  twice, since that would hand one chunk to two callers.

  The check that matters cannot be faked by a counter: 300 objects nothing
  references, collect, 300 more allocations, and **299 of them come back from
  addresses the sweep reclaimed**. A rooted object keeps all 64 of its bytes
  through a collection, comes out white, and its chunk is not handed out again
  across 400 further allocations. Twenty cycles of 200 allocations leave five
  arenas mapped rather than a growing heap.

  `bench/sweep_exercise.sh` proves both directions, as permanent steps: a sweep
  that reclaims nothing exits 1 at "nothing was reclaimed, so no address came
  back", and a sweep that frees regardless of colour exits 1 on the live
  survivor. A collector's test that cannot see both is not testing a collector.

  Finalizers and weak references are not built, and not for lack of time.
  Nothing in this language defines a finalizer: there is no `def finalize`
  anywhere in `src/iyi` or `samples/iyi`, so a finalizer queue would be a
  mechanism no program could put an entry in, which is the shape III.4.8
  refused for a concurrency marker. Weak references are registration based and
  the standard library's `WeakRef` is on the `--crystal` side, so there is no
  table here to walk and null out. Both wait on the language having the
  feature. Statistics are the honest subset, counted as the walk goes rather
  than sampled: chunks swept, chunks kept, bytes freed, collections run.

- **The collector marks, behind `-Dgc_iyi`.** GC_DESIGN.md Stage 5. Roots go
  gray through Stage 3's walker, a queue in its own mapping drains, each
  object's payload is scanned to the bound its size header carries, and what is
  still white when the queue empties is unreachable. The object header is real:
  with `P` the pointer a program holds, `P-24` is the size that `realloc`'s
  contract reads, `P-16` the `type_id`, `P-8` the mark word, and `P` the user
  data. Colour is bits 0 and 1, so a fresh chunk is white without anyone
  writing anything, and every write preserves the flag and reserved bits the
  header promises to a forwarding pointer later.

  The layout table is emitted into the binary and the mark loop does not read
  it, which is deliberate. Nothing writes an object's `type_id` yet: `malloc`
  is handed a size and cannot know the type, so that store belongs at the
  allocation site in codegen and is the next step. Reading a table keyed by an
  id that is always zero would be a lookup no test could reach. So marking is
  conservative, which is what Boehm does in production and which errs in the
  safe direction: a false positive retains a dead object, only a false negative
  frees a live one.

  `bench/mark_exercise.sh` proves it rather than reporting it: 400 live objects
  all black with garbage beside them, a three-node cycle and a self-loop that
  terminate, an interior root that marks the object it points into, and a
  20,000-object chain fully marked, which is the queue growing and the proof
  the walk is not the call stack. Both failure proofs are permanent steps:
  removing the black shading exits 1 with an object left gray, and removing the
  pointer walk exits 1 with the chain's tail left white.

  Three bugs were found by running it. The colour mask, because neither `~` nor
  `>>` is defined on `UInt64` here and the literal 2^64-4 produced colour 3,
  which is not a colour. The idempotence check, which was wrong rather than the
  code: after one pass everything live is black and only white objects are
  enqueued, so a second pass finding nothing is the invariant working. And the
  harness itself, which wrote 20,000 entries into an 8,192-slot mapping and
  crashed; a test that corrupts memory while testing a collector is worse than
  no test, so its ledger bounds itself and raises.

  Nothing sweeps yet. This stage decides what is garbage and Stage 6 reclaims
  it, so `-Dgc_boehm` is still the only way to get memory back.

- **A heap that can hand memory back, behind `-Dgc_iyi`.** GC_DESIGN.md Stage 2:
  size classes to 16 KiB over 16 MiB mmap arenas, per-class free lists, and
  large objects in a mapping of their own released with `munmap`. Two properties
  exist because Stage 3 needs them and not because they are tidy: an arbitrary
  pointer resolves to its arena and size class, answering zero for a pointer
  that belongs to no arena, and the arena list walks.

  The correctness point is clearing, and it is not in the design. Today
  `__crystal_malloc64`'s documented "allocate and clear" is free, because
  `MAP_ANONYMOUS` zero-fills and no byte is ever handed out twice. A free list
  hands memory back out, so a reused chunk is dirty and has to be cleared, or a
  program reads memory it was never given. That is the same defect that makes an
  iyi binary on Windows print `ache\` where `HELLO, IYI!` belongs. The atomic
  entry point still does not clear, matching `GC_malloc_atomic`.

  `bench/arena_exercise.sh` proves it rather than asserting it: 256 blocks
  across 8 size classes keep their patterns, 100 chunks freed out of order and
  reallocated keep every byte, a freed chunk of `0xAA` comes back zeroed, a
  freed large object's mapping is gone (the read faults), and all 13 samples
  print identical output under both allocators. The clearing check was proven
  able to fail: with the clear disabled it exits 1 with `reused chunk dirty at
  byte 0: got 170`.

  Measured, not hidden: 7 ns per allocation for the bump pointer, 20 ns for the
  arena, 15 ns per alloc-and-free pair. A size-class allocator costs more than a
  bump pointer on the fast path, and that is the price of a heap that can hand
  memory back.

  Opt-in on purpose. The default on every target is unchanged, and switching it
  is a separate decision backed by measurement rather than something to slip in.
  Windows and wasm32 keep their allocators: Windows because its binaries already
  print uninitialized memory and a second suspect would confound that, wasm32
  because it has no mmap. The prelude's source grows 468 lines and 19 KB for
  everyone, but the arena is inside a macro branch, so a default build does not
  compile it and the default binary is the same size.

- **The collector's first stage: pointer maps travel in the artifact.**
  `.iyimod` carries a `Layouts` section: per type a module
  owns, its allocation size, its unrounded instance size, and the byte offsets
  of its pointer fields. The offsets come from the target's own data layout, not
  from adding field sizes up, because padding is the target's business and a map
  that misses a field is a collector that frees a live object. A struct of
  `String`, `String` and `Int32` reads back as 24 bytes, scan cap 20, offsets
  `[0, 8]`. `iyi mod dump` shows them. A pointer word past offset 65535 is
  refused by name rather than truncated into a `u16`.

  Alongside it, the object header and its mark word: `type_id` and an atomic
  `u64` holding colour in bits 0 and 1, flags in 2 to 5, and 58 reserved bits a
  forwarding pointer could later use. Colour changes are compare-and-swap and
  report whether they won, so two marking workers cannot both scan one object.
  Proven with two real threads racing 10,000 rounds: exactly one winner every
  round. The round count is 10,000 rather than 1,000 because the measured win
  split at 1,000 was 32/968, one unlucky schedule from a spec that flakes.

  What this is not: no object is allocated with that header, nothing marks and
  nothing collects. `-Dgc_boehm` is still the only way to get collection, and
  every other path still allocates and never frees. Stage 1's own tasks 3 and 4,
  work distribution and write barriers, are design and deferred to Stage 6 by
  their own text. `noscan_offsets` is empty everywhere on purpose: what "not
  traced" means is Stage 6's to define, and guessing now risks a later stage
  reading it as "do not retain" and collecting live buffers. Layouts are per
  instantiation, not per GC shape, because shape keying is R-4 and unbuilt.

### Fixed

- **`memset` strode eight elements where it meant eight bytes — in every
  released compiler.** The prelude's own `memset` advanced its
  `Pointer(UInt64)` by 8 — eight *elements*, 64 bytes — while its counter
  recorded 8, so every runtime-sized clear wrote one word in eight far past
  its count and left seven of eight bytes dirty. Invisible until now because
  the bump allocator's overwrite landed in the untouched zero tail of its own
  mapping; the arena gate's default arm found it by burning a full region —
  2,000,000 allocations of 24 bytes segfault on 0.6.0 as released. The win32
  copy carried the same stride, which is consistent with that target's open
  diagnosis of binaries printing memory they were never given, and wasm32
  carried it at width four. All three loops advance one element now; the
  `-Dgc_iyi` branch's own memset already did.

### Learned

- **A parked fiber's stack is an unscanned root, and the optimiser is part
  of the collector's contract.** Two findings from rebasing the collector
  onto 0.6.0's tree. Root discovery was written when this language had no
  fibers; 0.4.0 gave it a scheduler, so `each_root`'s walk — current stack,
  spilled registers, globals — now has a named gap: an object reachable only
  from a parked fiber's stack would be freed live. Latent, because only the
  single-fiber exercises trigger collection; recorded in GC_DESIGN.md as
  Stage 3's next task rather than a wait on threads. And the sweep gate's 2
  MiB root sat in a global written and never read, which the optimised build
  was within its rights to drop — the exercise now reads the root back after
  collecting, the check that is also what keeps the store alive.

## 0.6.0 — 2026-09-01

**A file reaches exactly what it imports, and a mistake dies where it
was written.** The import wall R-1 promised turned out not to exist —
anyone's import made a module everyone's — and now it stands per-file,
`pub import` the one door through it, closed for `using` and for
qualified names alike; the refusal teaches both fixes by name. And
typing moved home: every fully declared def in user code is checked
against its own signature in the same semantic run, generic bodies
against their bounds through synthesized witnesses — build, `check`,
artifact emit and every LSP keystroke agree about what "clean" means,
and `--shallow` is gone because there is no shallower truth to offer.

The agent's loop is verbs now, all gated: `check` with `--affected`
for the ripple, `fix`, `test --affected`, `mcp`, `run --sandbox`, and
`mod context --budget`. `Program.args` and `Program.env` landed in the
own prelude, so a pure-iyi tool reads its arguments, its environment
and the disk.

`.iyimod` format is v42 — the facade bit travels, one byte per import
edge — so a 0.5.x artifact is rejected by a 0.6.0 build and rebuilt,
never migrated.

### Added

- **The wall closes on qualified names too.** `Lib::Inner.shine()`
  without an import leaked through the type graph — the half the entry
  below recorded as open. It closed at the one funnel every written
  `Path` resolves through: an authoritative lookup that lands in an
  imported unit now demands the writing file reach that unit, directly
  or through `pub import`s, with the same refusal wording. Three fences
  hold it honest: speculative lookups (overload matching trying
  restrictions with `raise` off) keep their answer rather than gaining
  a new way to fail; a unit in no import edge is the current source's
  own and always reachable; and a writer this build never read as a
  file — a mono body or initialiser replayed out of an artifact, which
  carries its far machine's source path — is exempt, because it was
  checked when its own module built. Reachability is memoized per file
  once the top-level pass completes; latency and rebuild budgets are
  unmoved.
- **The import wall is per-file now, and `pub import` is the one door
  through it.** Found while building the door: the wall did not exist.
  `using x` checked *type existence*, which is program-wide — anyone's
  import made a module everyone's, and a consumer could `using` a
  module it never imported so long as some other file had pulled it in.
  That is the phantom-dependency disease R-1 exists to refuse, and it
  compiled here. Now `using` reaches exactly what the file imported,
  plus what those imports hand on with `pub import`, transitively — the
  facade form a mature library needs so its internal layout does not
  leak into every consumer. The refusal teaches both fixes by name.
  The facade bit travels in the artifact (`.iyimod` format v41 → v42:
  one byte per import edge), replays as `pub import` in the
  declarations a consumer compiles against, and moves the interface
  hash — re-exporting, or ceasing to, changes what a consumer may
  reach, which is interface in R-1's own sense. A first cut of this
  entry recorded qualified naming (`Lib::Inner.shine()` without an
  import) as the wall's known open half; it closed in the same wave —
  see the entry above.
- **Generic bodies are checked against their bounds — R-2c's second
  half.** `def total(s : Sized)` was fully written and still
  caller-typed: a trait restriction makes the def generic, and
  duck-typed generics ship the library author's mistake to the
  consumer. Now the bound is enough: the compiler synthesizes one
  witness type per simple trait (`struct IyiDefTypeWitness_Sized` +
  an impl whose stubs return `uninitialized` values), and types the
  body against exactly the bound — `s.size() + s.length()` dies at the
  definition with the witness named in the error, a return lie dies
  the same way, and an honest body is clean. This is the half Rust
  checks always and duck-typed generics never; here it costs one
  synthetic type per trait per compile. Witnesses are declarations, so
  they take one extra top-level visit before the main pass; `self` in
  a requirement spells the witness. Out of reach and stated:
  supertrait, generic and associated-type traits (`Enumerable` stays
  caller-typed), and requirements the stub cannot write. Two keyword
  collisions on the way in — `trait` and `import` are identifiers
  nowhere in this fork, including the compiler's own source.
- **Definition-site typing is the language's rule now — R-2c.** The
  `check` probe of the previous entry grew up and moved into the
  compiler: after the top-level pass, every fully declared def in user
  code is typed against its own signature, in the same semantic run —
  build, `check`, artifact emit and every LSP keystroke agree about
  what "clean" means, and `--shallow` is gone because there is no
  shallower truth to offer. The probes are built from *resolved* types
  (a parse-time draft died twice: a trait restriction is invisible at
  parse, and the top-level macro expander met a scope-less synthetic
  call), anchored at the def they belong to, and marked so reference
  answers never count the compiler's own calls. What stays caller-typed
  is stated: trait-restricted, generic, block-taking, unannotated,
  impl-carried (R-3 keeps those inside their trait context), non-`pub`
  module functions (R-2's wall applies to probes too), and all `.cr`
  sources — each of those probe fences was earned by a sample that
  failed a draft, not designed in advance. First real catch: the
  packages gate's own fixture — a signature edited to `Int64` over a
  body still returning `Int32`, a dormant lie the lazy rule had shipped
  for a release. LSP latency and the rebuild loop stay inside their
  budgets.
- **`check` types the body nobody calls — R-2's dividend, collected.**
  Lazy typing (inherited from Crystal) meant a build said "clean" about
  a def it never visited, and `check` repeated the lie. A fully written
  signature is exactly enough to type the body without a caller, so
  `check` runs a probe pass: for every def whose parameters and return
  are all written, one synthetic call with `uninitialized` values of
  the declared types, under `if false`. Crystal cannot offer this; here
  it falls out of the rule that signatures are written down. What the
  probe cannot reach is stated, not hidden (generic free vars, blocks,
  unannotated parameters, generic and abstract types); `--shallow` is
  the build's exact answer; `fix` compiles with the same probe, because
  two tools answering differently is two tools lying to each other.
  126 ms on the kemal-port sample, both passes included.
- **`check --affected` — the ripple.** `test --affected` answers "which
  tests re-run"; this answers the sibling question "does everyone who
  imports the change still compile": every `.iyi` whose parsed import
  closure reaches a changed file is compiled alone, probe included, and
  every failure is named with its deepest message. The closure now
  resolves from the header-derived project root (IV.6 read backwards,
  the LSP's own rule), which `test --affected` inherits — a nested
  module's consumers were invisible before.
- **The suggestion pool includes `using`-imported names.** `addd` went
  unsuggested while `add` sat one edit away in the file's own `using`
  line: the Levenshtein walk never looked there. The new walk is the
  same namespace climb the call's real lookup performs, seeded the same
  way; selective `using` contributes its selection, bare `using` the
  module's exported names. Flows into prose, `suggested_edit`, the LSP
  quickfix and `fix` unchanged.
- **`Program.args` and `Program.env` in the own prelude.** The loop is
  now around a language that can do work: a pure-iyi tool reads its
  arguments, its environment and the disk, no `--crystal`. Args ride
  the compiler's own `ARGC_UNSAFE`/`ARGV_UNSAFE` (initialised before
  anything runs); env reads libc's `environ` symbol lazily — a first
  draft captured argv from `main` into class variables and read zeros,
  because `__crystal_main` runs class-variable initialisers *after*
  `main`'s prologue stored; symbols have no such ordering. On wasm32
  `env` answers nil for every name: the absence *is* III.12's sandbox.
  The stale "no IO beyond `puts`" sentence is restated in README and
  SPEC where it stood. `bench/agent_loop.py` holds 27 steps.

- **The agent's loop, one verb per step, and all of it gated.** The
  first AI-first menu made the compiler legible (surfaces as data,
  errors as data, a server); this wave makes the loop itself cheap:
  - `iyi check [-f json]` — the front end's verdict alone: no codegen,
    no binary, exit code the answer. Checks exactly what a build
    checks, and its own comment says what lazy typing leaves unvisited.
  - **`suggested_edit` in JSON errors** — the did-you-mean travels as
    data from the raise site: file, line, column, size, replacement, a
    self-contained edit. The refusal recorded in AI_FIRST ("inventing
    edits would be prose wearing a schema") was against parsing prose
    back, not against carrying the name already computed — so now it is
    carried, the III.1.7a participle and `and`→`&&` included, and the
    LSP quickfix reads the field instead of scanning its own messages.
  - `iyi fix [--json]` — applies exactly those edits, one per round,
    recompiling between, until clean or the error carries no edit.
    `check` shows the edit; `fix` performs it; nothing is invented.
  - `iyi test --affected FILE` — only the tests whose transitive import
    closure reaches a change, parsed in milliseconds, exact. Restated
    on the way in because the menu had it wrong: interface hashes are
    the *rebuild* truth, not the test truth — an edit that moves no
    surface still changes what a consumer's test executes. Conservative
    at both unprovable edges: an unparseable test always runs, a
    deleted changed file turns the discount off.
  - `iyi mcp` — check, fix, context and test as Model Context Protocol
    tools over stdio, one JSON-RPC message per line. Deliberately a
    shell around this same binary: no second implementation, no drift.
  - `iyi run --sandbox` — III.12 worn as a verb: cross-compile to
    wasm32-wasi, link through wasi-sdk's clang standing as `cc`, run
    under a wasmtime that preopens nothing. The theft dies at the
    compile fence by name; a missing toolchain is named, never worked
    around.
  - `iyi mod context --budget N` — the grounding pack cut by a defined
    ladder, never truncation: docs off from the last import backwards,
    then surfaces collapse to headers that still name every import and
    the cost of eliding them. A token is four bytes, crude and stated.
    `--json` refuses the flag: JSON is already data.
  `bench/agent_loop.py` is the gate — seventeen asserted steps through
  ground → check → fix → affected tests → MCP → sandbox — in CI beside
  the LSP session.

- **A package that names a library it does not carry is refused.** Taken
  from Crystal's own release engineering, which fails its build when
  `otool -L` on the finished compiler names anything under
  `/usr/local/lib` or `/opt/homebrew`
  (`distribution-scripts`, `omnibus/config/software/crystal.rb`). iyi
  asks the same question at package time on both platforms, and it is
  the only self-containment proof darwin can have from its own job —
  that job runs on a machine which *has* brew's libraries, so "it ran"
  proves nothing while "it names nothing outside itself" proves
  everything. `scripts/bundle-runtime-libs.sh --verify-only` asks it of
  a package somebody else built, and CI now asks it of the release
  artifact before the clean room even starts: the structural answer
  names the offending library, where a bare-image run only says
  `cannot open shared object file`.

### Learned

- **Crystal solves this one layer lower, and iyi should follow.** Their
  LLVM is built for the package rather than borrowed from the host:
  `-DBUILD_SHARED_LIBS=OFF` with `TERMINFO`, `ZLIB`, `ZSTD`, `LIBXML2`,
  `FFI` and `Z3_SOLVER` all `OFF`, `MinSizeRel`, and only the two
  targets they ship. A statically linked LLVM with no optional
  dependencies means the closure iyi now carries — libedit, libxml2,
  libicu, libncursesw, libzstd — never comes into existence, and the
  tarball loses most of its size. What iyi does today is correct and
  proven; what it is not is small. Recorded with the flags, not
  attempted in the same breath: building LLVM in CI is its own piece of
  work with its own budget.

## 0.5.1 — 2026-08-30

**The language reached the machine most developers sit in front of, and
a caught panic stopped costing the process.** darwin arm64 is a run
target and a ship target: the same fibers, defer registry and panic
path, calling libSystem where Linux issues raw syscalls — Apple's rule,
not a compromise — with a native CI job holding the same gates and
shipping its own relocatable tarball. And III.1.4's last sentence went
literal: reading a panicked task's handle catches the panic as a
`Panicked` value and the process outlives the bug; a panic nobody reads
is still re-raised at the join, exactly once.

`.iyimod` format is unchanged at 41; a 0.5.0 artifact is rejected by a
0.5.1 build and rebuilt, never migrated.

And a release is a tag now: pushing `v*` has CI build and *prove* both
tarballs — unpacked somewhere else, samples run, the daemon served —
then attach them, with the notes read from the annotated tag's own
message. Nothing is packaged on a laptop again.

### Added

- **darwin arm64 is a run target and a ship target.** The concurrency
  runtime crossed its second platform: same fibers, same one-word
  context, same defer registry and panic path — the port changed who is
  called, libSystem's `mmap`, `kqueue`/`kevent` and
  `clock_gettime_nsec_np` where Linux issues raw syscalls, which is
  Apple's rule (III.9) rather than a compromise this design settled
  for. kqueue refuses `/dev/null` where epoll refuses a regular file,
  and both refusals answer "readable now". A native macos-14 job builds
  the release binaries, holds the gates a Linux push answers for, and
  ships `iyi-<version>-darwin-arm64.tar.gz` — proven by unpacking it
  somewhere else and running iyi's own prelude, `--crystal` and the
  daemon out of it, which is how the first darwin package was caught
  shipping Crystal's library flattened by BSD cp.

- **Observed bugs are values; unobserved bugs are loud.** III.1.4's
  "catchable at task boundaries", made literal: reading a panicked
  task's handle catches the panic — `value` answers `Panicked`, an
  ordinary `Error` implementor carrying the message, so `case`, `!`,
  `.or` and the typed group's error union handle a caught panic with
  machinery III.1.3 already built, and the process outlives the bug. A
  panic nobody reads is still re-raised at the join, exactly once. The
  gate's step is the sentence: a task panics, the reader prints
  `caught: task blew`, life goes on, exit 0.

### Fixed

- **Two LSP gate steps asserted timing, and the darwin runner said
  so.** The cancellation and burst-coalescing steps sent their frames
  one write at a time and passed on the machine that wrote them by
  luck: a quicker runner answered the request before its cancel
  arrived — the server's documented limit (in-flight work is
  uninterruptible), not a bug in it. Both steps now write their frames
  in *one* write, so "drained together" is a fact, and the burst step
  asserts the stronger thing it always meant: six changes, exactly one
  compile.
- **A release asset that did not exist passed quietly.** Both tarball
  uploads globbed under `.build/`, which `upload-artifact` v4 treats as
  hidden and skips with a warning — so the first tagged run found
  nothing to attach. Staged into `dist/` now, with
  `if-no-files-found: error`.
- **The tarball carries LLVM, and a bare image proves it.** Every
  release before this one shipped a `bin/iyi` that could not start on a
  machine without the exact libLLVM it was linked against — and no gate
  saw it, because every proof of the tarball ran in the environment that
  built it, where that library is present by construction. Moving the
  packaging into CI is what exposed it: the artifact came from a
  container with LLVM 20 and died on a laptop with LLVM 22. The package
  now carries libLLVM in `lib/` and the binaries carry an
  `$ORIGIN/../lib` rpath — escaped past the shell the bootstrap compiler runs its link
  command through, which the first cut got wrong in the way that hides
  the bug: an unescaped token bakes `/../lib`, which resolves to the
  *system* library. And the missing gate exists now: CI unpacks the
  tarball in a bare `ubuntu:24.04` with nothing but `gcc` and builds a
  program there. The cost is honest — tens of megabytes instead of a
  handful — and a
  release cannot ship without passing it.

## 0.5.0 — 2026-08-29

**The language got its editor, and a panic stopped being a process.**
0.4.0 made iyi concurrent and machine-readable; this release makes it a
language you can *live in*. `iyi lsp` grew from a first session into a
server that stands feature-for-feature beside gopls: pull diagnostics an
agent asks for instead of subscribing to, completion that writes the
`import`/`using` pair it knows you forgot, rename that reaches files
nobody opened, a code lens that runs the module over the wire, semantic
tokens so no editor needs a grammar for `.iyi` — and a three-file VS
Code client in `editors/`, with one-stanza configs beside it. The server
answers to five gates on every push: a 49-step scripted session, latency
budgets per verb, an 8,000-token word-boundary sweep, a transport soak
that hits it with garbage and demands a hover after each blow, and the
doc-numbers sweep that keeps every stated figure honest.

And panics landed the way III.1.4 always wanted them: a panic kills the
task, not the process. `defer` registers its cleanup on a per-task list
the panic path walks, so the promise holds with no unwinder, no landing
pads, no libgcc — the dependency floor never moved. A panicking task
drains its defers, its group cancels the siblings and re-raises once in
the owner; main exits 1 after its own drain; `.or_panic` became a real
panic by its lowering not changing at all. The AI_FIRST menu this cycle
opened with closed 8-for-8, every row gated.

`.iyimod` format is unchanged at 41. Released artifacts carry the
version alone, so a 0.4.0 artifact is rejected by a 0.5.0 build and
rebuilt, never migrated — which also retires object code whose panic
was still a process exit.

### Added

- **`iyi vet` — III.8 #3's row, closed as written.** "A verb, not new
  analysis": the analysis is `tool unreachable`, the verb is go vet's
  contract — findings are the exit code, switches pass through.

- **The language server — SPEC.md III.8 #2, built as `iyi lsp`.** Stdio,
  LSP 3.17's earning subset, and no semantic state at all: every change
  runs the real front end on the module under the cursor, which R-1 makes
  a 50–70 ms question on the gate's fixture — so the server is never
  stale, has no invalidation story, and gives no answer a build would
  not. Diagnostics carry the message iyi would print with the SPEC
  section it cites riding in `code` as data and a link in
  `codeDescription`; hover answers from `ContextVisitor`, definition from
  `ImplementationsVisitor`, and the outline comes from the parser alone,
  so it survives a file that does not compile. Two methods go beyond the
  protocol because no other language wrote its interfaces down:
  `iyi/contextPack` serves the grounding pack over the wire and
  `iyi/surface` serves a module's rendered surface, dirty buffer
  included. `bench/lsp_session.py` is the gate: one scripted session, a
  step per claim, in CI beside the other verbs.

- **Editor buffers reach the compiler — `iyi_file_overrides`.** One hash
  of path → buffer, consulted in exactly the two places imports read
  files: `resolve_import` counts an overridden path as existing, and
  `import_file` reads the buffer instead of the disk. The gate's step
  for it is literal: rename a def in an *unsaved* sibling, follow the
  rename in the file that imports it, get a clean verdict while the disk
  still spells the old name. A build that opens no editor pays one hash
  lookup per import. The daemon's prelude-cache rule classified it
  APPLIED_ON_ADOPT beside `iyi_mod_table` — the guard that demands the
  classification caught this commit within the minute, which is what it
  is for.
- **A nested module opened alone finds its root — `iyi_project_root`.**
  The comparison that asked "does this compete with gopls" found the gap
  within five files: a build's project root is the entry file's
  directory, so opening `<root>/calc/parser.iyi` in an editor broke its
  own `import calc/lexer`. The server now derives the root from the
  file's header — IV.6 read backwards: a path that ends with its
  header's path names the root above both — and every module in this
  repository opens clean, 28–81 ms to a verdict, the 1,190-line
  concurrency runtime included. Builds a person runs keep the entry-dir
  rule untouched.

- **Completion, references, rename — the everyday half of `iyi lsp`.**
  The same skeleton three more times: compile, then visit the typed
  result. Completion answers from the last result that held together —
  the buffer stops compiling the moment the dot lands, which is exactly
  when completion fires — and lists the receiver's methods with
  signatures as written, or the scope with its types. References merge
  the compiles of every open document, because under R-1 a def's callers
  live in its consumers' programs; a reference is a resolved edge, so an
  overload sharing the name but not the resolution stays out. Rename is
  references written back, and its gate found the rule worth keeping: a
  `using` line that selects the renamed name is a reference too — miss
  it and the rename leaves a program that does not compile. `UsingDecl`
  carries per-name locations from the parser now, and the gate's step is
  one request, three edits, two files, both buffers clean after.

- **The rest of the protocol — `iyi lsp` at gopls parity.** One session
  now speaks the whole everyday surface. Incremental sync: range edits
  applied in wire units, so a large buffer stops paying full-text tax on
  every keystroke. Signature help while the call is half-typed — the
  callee found by text, because there is no syntax yet; its overloads
  off the typed graph, falling back to every def a call by that name
  already resolved to, which is how a `using`-imported name answers.
  Hover grown to carry the def's signature as written and the `#` doc
  comment above it. Type definition, unwrapping virtual, metaclass,
  generic-instance and union shells to the declaration sites. Document
  highlight — references scoped to one buffer, the declaration marked
  as the write. Prepare-rename, so the refusal arrives before the input
  box opens. Folding — the outline for declarations, the text for
  comment and import runs, all of it alive in a buffer that does not
  parse. Workspace symbols — every `.iyi` under the root, subsequence
  match, open buffers winning over the disk, no index. Formatting —
  `Iyi.format` in process, one whole-document edit. Inlay hints — the
  inferred type after a bare assignment, the parameter's name before a
  positional literal, deduped across a generic's instantiations. The
  compiler's own "Did you mean 'x'?" re-served as a quickfix whose edit
  was computed when the error was. And semantic tokens from the lexer
  alone — which, for a language no editor ships a grammar for, means
  any LSP client colors `.iyi` correctly on day one. One named piece of
  state where the design said none: the last compile is memoised by
  (path, buffer, siblings) — the key is the whole input, so a hit
  cannot differ from a recompile; it exists because one keystroke now
  asks four questions of the same buffer. The gate grew a step per
  claim, each of these sentences asserted in the present tense.

- **The call graph and the pull shape — `iyi lsp`, third wave.**
  `textDocument/implementation` jumps from a trait to its implementors:
  an impl became an `include` in the semantic pass, so the answer is a
  walk of the type tree, not a registry. Call hierarchy makes the
  written def the node — a generic's instantiations collapse back to
  the line the person wrote — incoming edges merged across the
  session's open documents the way references are, outgoing edges read
  from the def's own compile, and the item's `data` carrying the def's
  source key so neither direction re-derives it from wire positions.
  `textDocument/selectionRange` expands off the parse tree alone, alive
  mid-edit. And diagnostics grew their pull shape — the AI-first face
  of the server: `textDocument/diagnostic` answers one buffer on
  request, `workspace/diagnostic` judges the whole project in one, open
  buffers winning over the disk, a file nobody opened still judged. An
  editor holds a subscription; an agent asks a question. R-1 is what
  makes the whole-project question affordable — one cheap compile per
  module, capped so a monorepo cannot turn a request into a build farm.
  The gate holds 32 steps.

- **Workspace-wide references, rename, and incoming calls.** The one
  gap the gopls comparison still named: these three answered from the
  session's *open* documents, so a caller in a file nobody opened was
  invisible — and a rename that missed it shipped a program that does
  not compile. They now walk the workspace the way
  `workspace/diagnostic` does: open buffers first so unsaved edits win,
  then every `.iyi` under the root, same cap, one cheap R-1 compile per
  entry, no index anywhere. The gate grew three literal steps — a
  consumer written to disk and never opened is found by references,
  edited by rename, and named by incoming calls — and holds 35.

- **Auto-import completion, fuzzy-ranked — R-2's dividend.** Bare
  completion now offers the workspace's exported defs beside the
  scope: `pub` is a parse-time fact, so one parse per module names its
  callable surface and the offer works in a buffer that has never
  compiled. Choosing an item inserts the name and the `import`/`using`
  pair arrives as `additionalTextEdits` — a fresh selective `using`
  when the module is unimported, the existing line extended
  (`{token}` → `{token, glyph}`) when it is. Matching is fuzzy (`ucs`
  finds `upcase`) and ranked honestly: scope prefix, keywords,
  workspace exports, fuzzy — the tier leads `sortText`. The gate holds
  38 steps, the new three literal: a never-compiled buffer completes
  `tok`, applies the item, and the verdict is clean.

- **A queue under the one thread: cancels overtake, bursts coalesce.**
  The reader rides its own fiber now, filling a queue while a compile
  runs. A `$/cancelRequest` for queued work answers `-32800` without
  doing the work (in-flight work stays uninterruptible — one thread's
  honest limit, stated); a typing burst's didChanges apply together, so
  six keystrokes cost at most two compiles instead of six, and the
  verdict is the final text's. The gate holds 40 steps.

- **Document links and type hierarchy.** The import block is clickable
  — `import calc/lexer` and its `using` line both target the file,
  resolved by text against the header-named root, alive in a broken
  buffer. Type hierarchy walks the compiled type tree both ways:
  supertypes include the traits an impl brought in, subtypes are the
  implementors walk generalised past traits. The gate holds 43 steps.

- **Code lens that runs, snippets, token deltas.** A runnable module
  carries one lens on its first statement; `workspace/executeCommand`
  executes `iyi.run` — the released verb against the buffer, dirty
  state included, bounded at 30 s — and returns what it printed, so an
  agent can ground, edit, and run without leaving the protocol.
  Completion items with parameters land as snippets when initialize
  said the client renders them. Semantic tokens answer deltas: one
  appended line moves five integers, and the splice reconstructs the
  full answer exactly, gate-checked. The gate holds 46 steps.

- **The speed is measured, and the server ships to editors.**
  `bench/lsp_latency.py` times every verb over the 26-module sample
  corpus and fails CI when a p95 leaves its budget: a keystroke's
  verdict lands in 36 ms p50 / 55 ms p95, hover in 1 ms off the memo,
  completion in 12 ms p50, workspace-wide references in ~1 s — one
  compile per module, the architecture priced rather than hidden.
  And `editors/` makes the server installable: a three-file VS Code
  extension (no grammar — highlighting is the server's semantic
  tokens), with the one-stanza configs for Neovim, Helix, and Sublime
  beside it.

- **A rebuilt binary no longer lobotomises a running session.** The
  first live editor session found it: `make iyi` unlinks the
  executable, `Process.executable_path` goes nil on Linux, and every
  later compile failed with "Missing executable path to expand $ORIGIN
  path" — invisible to a gate that starts a fresh server per run.
  `$ORIGIN` is resolved once and pinned, the server captures its own
  path at startup, and the gate now deletes the executable under the
  running session and watches a fresh compile answer anyway. The gate
  holds 47 steps.

- **The first screenshot taught two lessons.** Semantic tokens now
  classify bare names the way a reader does — `name(` and `.name`
  call, `name:` labels an argument, the rest is a variable — so a
  buffer stops being a sea of plain foreground; the legend grew
  `parameter` for named arguments. And inlay hints learned restraint:
  parameter names only inside parentheses (an operator wearing
  `other:` was the discovery), type hints only on a variable's first
  assignment and never for a bare literal, padded to the `total :
  Int32` the formatter writes. The gate asserts the variable and the
  call by exact position.

- **Whole words, sworn to.** The screenshots' second find: the lexer
  reuses one Token and leaves `raw` dirty between kinds, so an ident
  could inherit the previous number's *length* — every editor showed
  `t`otal, one letter colored. `raw` is now read only for the kinds
  `wants_raw` writes, and `bench/lsp_token_boundaries.py` sweeps all
  8,000+ sample tokens in CI refusing any that colors part of a word.

- **First paint. Crystal colored instantly and iyi a second later,
  because a TextMate pass is synchronous with the first frame and a
  language server round-trip is not. The VS Code extension now carries
  a deliberately minimal grammar — comments, strings, numbers,
  keywords, types, def names; the parts of a language that do not
  drift — and the server's semantic tokens override it on arrival, so
  the fast path is instant and the truth stays with the compiler.**

- **Organize imports, and a transport that does not flinch.** The
  code actions grew `source.organizeImports`: the header block
  canonicalised — imports sorted and deduped, one module's `using`
  selections merged with their names sorted, a full `using` absorbing
  them — and it offers nothing when the block holds anything it does
  not understand, a comment above all. Writing `bench/lsp_soak.py`
  (garbage frames, non-JSON and non-UTF-8 bodies, malformed params, a
  1,500-def module — a hover must answer after each, in CI) found two
  real deaths: a stray blank line read as EOF ended the session, and a
  non-JSON body killed the reader fiber and hung the pipe. The
  transport forgives both; only true EOF ends a session. The gate
  holds 48 steps.

- **`workspace/willRenameFiles` — moving a file renames the module.**
  IV.6 makes the answer deterministic: one WorkspaceEdit rewrites the
  moved file's header and the exact `import`/`using` spans in every
  consumer, open buffers and never-opened disk files alike, before the
  rename lands. The gate moves lexer.iyi to scanner.iyi, applies the
  nine edits across five files, and compiles the moved module clean.
  The gate holds 49 steps.

- **Panics — SPEC.md III.1.4, built, and the unwind owns no unwinder.**
  `defer` now registers its cleanup on a per-task list (`__iyi_defer_push`
  around every deferred scope, popped on ordinary exits), so a panic
  walks the list instead of walking frames: no landing pads, no
  personality function, no libgcc — the dependency floor does not move.
  A panicking task prints once at the site of the bug, drains its
  defers innermost-first, tells its group and dies alone; the group
  cancels the siblings and its join re-raises `a task panicked: <msg>`
  in the owner exactly once; reading a panicked task's `value`
  re-raises too; a boundary-less panic — main's — exits 1 after its own
  drain, cleanup a panic used to skip entirely. `.or_panic` is a real
  panic now, by its lowering not changing at all. `bench/panics.sh` is
  the gate: six steps, each a sentence of III.1.4 in the present tense,
  in CI beside the concurrency exercise.

### Fixed

- **An overflow in a task dies at the task boundary.** III.1.4's one
  recorded residue: `__crystal_raise_overflow` trapped straight to a
  process exit. It steps into the ordinary panic def now, so a task's
  overflow runs its defers, cancels its siblings, and re-raises at the
  boundary like any other bug — gated in `bench/panics.sh`.

### Measured

- **A `defer` costs ~16 ns.** The registry's price — one node, one
  closure under iyi's own allocator — measured by `bench/defer_cost.sh`
  (twenty million calls, release mode, with and without) and budgeted
  in CI so it cannot quietly grow.

- **The rebuild benchmark ran, and corrected its own prediction.**
  `bench/rebuild_speed.py`: an artifact rebuild does *not* beat a
  source rebuild (~1.0x on the sample corpus, ~0.85x semantic-heavy) —
  lazy typing makes unused import surface nearly free, while the read
  pays decode for everything. R-1's wall-time dividend lives where it
  was already gated: the LSP's 36 ms verdict, source-deleted builds,
  the interface hash. CI now holds what the loop owes instead: under
  two seconds per edit-rebuild on either arm, the read within 1.5x of
  the compile it replaces. Recorded rather than tuned.

## 0.4.0 — 2026-08-28

**The language runs concurrently, and a model can read it.** 0.3.0 carried a
shard across a boundary; this release gives iyi the two organs a language
needs to be *used* — and one it needs to be used by the tools of this
decade. Concurrency arrived in exactly the order III.4.8 refused to
shortcut: a scheduler, cancellable blocking primitives, then `group`,
a rendezvous `Channel`, `select` and the typed `group do ... end!` — run,
not just built, on x86-64 glibc, on musl, and on aarch64 under emulation,
with the deadline-and-cancellation claims asserted as wall-clock facts.
Dependencies arrived as III.7's first two steps: `iyi.mod` and minimal
version selection, a git fetcher, and `iyi.sum` noticing when what arrived
is not what arrived last time — proven offline, against a mirror the gate
builds and then deletes.

And the AI-first surface stopped being a plan: a module's exported API as
data (`mod dump --json`), the grounding pack an edit needs (`mod context`),
errors that cite their SPEC sections as fields (`-f json`), a test verb
with no framework under it (`iyi test`), docs riding the artifact, and a
sandbox story measured rather than told. The claim got its gate before the
README got its sentence: eight model runs, two task difficulties, 35–43%
fewer prompt tokens on the pack, and both refusals the gate issued on the
way are still written down in AI_FIRST.md §5.

`.iyimod` goes from format 40 to 41 (`Docs`, and private methods marked).
A 0.3.0 artifact is rejected and rebuilt, never migrated. Released
artifacts carry the version alone, so any 0.4.0 build on the same target
and flags reads them.

### Added

- **Dependencies exist — SPEC.md III.7 steps 1 and 2.** An
  `iyi.mod` beside the entry file is the opt-in: `module <path>` and
  `require <path> v1.2.3`, nothing else. Resolution is minimal version
  selection — the highest of the minimums anything asked for, a worklist
  and no solver — and the fetcher is `git clone --depth 1` at the tag the
  version spells, into the compiler's cache, immutable once fetched.
  `IYI_MOD_MIRROR` redirects fetches to bare repositories under a
  directory, which is how `bench/packages_resolve.sh` proves the story
  without a network: the app asks for liba v1.0.0, its other dependency
  asks for v1.1.0, and the program must print v1.1.0 and never v1.0.0;
  then the mirror is deleted and the second build must still succeed.

  Identity is the import path and the path is a URL, so the import grammar
  admits `.` and `-` inside a segment — in `import` and `using` only,
  because IV.6 #6's strict rule exists so a path and a type name determine
  each other, and `github.com` determines nothing. A requirement's prefix
  never becomes a type: the in-package path does, `using
  example.com/user/liba/colors` reaches `Colors`, and a package's own
  short imports resolve in its own checkout or fail — never passed along
  to the program's roots. A dotted import with no covering requirement is
  refused naming `iyi.mod` and the `require` line to write.

  `iyi.sum` guards what arrives: one line per requirement, a tree hash of
  its checkout, written by the tool and defended by it — a matching entry
  is silence, a tampered one is a refusal naming both hashes, and the gate
  proves both. Building it taught a rule: a checkout is read-only, because
  the first version let a build whose entry sat inside the module cache
  write a sum into the checkout, and the verifier caught its own footprint
  within the hour.

  Not built, and said so in III.7's margin: packages compile
  from source every build (their artifact story is step 5's, with
  signatures), and two packages whose in-package modules share
  a name collide in the type namespace.

- **The AI-first surface, AI_FIRST.md §3's cut.** Three tools, all riding
  machinery the rules already paid for. `iyi mod dump --json` prints a
  module's exported surface as data — exact signatures with their
  `rendered` spelling, types with fields, impls, and the interface hash
  they are keyed by. `iyi mod context FILE.iyi` prints what an edit to
  that file is allowed to know: the surface of every module it imports and
  nothing's body, each import compiled *alone* (R-1 worn as a tool), so a
  half-broken tree still grounds; `--json` makes the pack data. And
  `iyi build -f json` — inherited, measured working — now carries a
  `spec` field: the SPEC sections the message cites, as data, extracted
  by a hand-rolled walk because the first version used a `Regex` and
  `bench/dependency_floor.sh` refused the PCRE2 it linked, by name,
  within the hour. `bench/packages_resolve.sh` gates all three.

  The artifact carries docs now — the one gap III.7 named in its asset.
  `Signature` and `TypeDecl` gained a `doc` field (format v41): the
  comment above a `pub` rides into the artifact, comes back as the
  comment it was in `mod dump --declarations`, and as `"doc"` beside the
  signature in `--json` and `mod context`. Two facts the build wrote
  down: the comment rides the `pub` token, so `parse_pub` captures it or
  `parse_def` never sees it; and a doc is surface for a reader, not the
  type checker, so the interface hash is computed with docs blanked — the
  gate asserts a doc-only edit moves no hash and a signature edit still
  does.

  And the claim got its gate before it got quoted: `bench/context_pack.py`
  is AI_FIRST.md §5, both arms. The token arm is hermetic and in CI — the
  pack must stay under 70% of the raw sources it replaces (measured: 55%
  and 43%) and carry no body, which forced a correction worth the gate's
  existence: the first pack was the compile-against text at 96% of raw,
  because travelling bodies are most of a macro-heavy module, so
  `mod context` now renders the *caller's* document (`IyiMod.surface`) and
  `mod dump --declarations` keeps the compiler's. The rounds arm ran once
  against a real model: the pack won tokens by 35% and tied rounds 2–2 —
  a tie is not a win, so the README stays silent, which is the gate doing
  its job on its own author.

  The gate then ran to a verdict. Three trials per arm on a harder task
  (a mounted sub-router, a filter, path parameters): pack 1+1+3 rounds
  and 17,571 prompt bytes, raw 2+2+1 rounds and 31,053. Eight model
  calls, two task difficulties, one consistent answer — rounds track the
  model, tokens track the grounding, by 35–43% — so the bar was amended
  the way bars are amended here, by the count and in writing: the pack
  must win tokens by a named 25% and must not lose rounds. Both earlier
  refusals stay recorded in AI_FIRST.md §5, and the README's agentic row
  now quotes the measurement with the command beside it.

  `iyi test` closes the loop — the verify verb with no framework
  (AI_FIRST.md §2 #4). A test is a plain iyi program named `*_test.iyi`:
  exit 0 passes, anything else fails and prints its own evidence, which is
  the protocol every gate in `bench/` already runs on. One process per
  test, four verdicts told apart — pass, fail, does-not-build, and
  hung-killed-at-deadline (60 s default, `--timeout`), because a harness
  that can hang is not a harness. `--json` reports the run as data.
  `bench/test_verb.sh` gates all four verdicts.

  The sandbox story is written and measured — SPEC.md III.12. Built by
  subtraction: zero undefined symbols natively, and on wasm32-wasi an
  *absence* rather than a permission, because the prelude never grew a
  `File` surface there. `bench/sandbox_story.sh` holds it to three steps:
  an honest program computes through the boundary, a theft of
  `/etc/passwd` dies non-zero with not one byte in its output under a
  default wasmtime, and the refusal is the prelude's own sentence. And
  `iyi doc` exists — III.8's verb, a renderer over the surface the
  artifact already carries: functions, types, methods, docs; no bodies,
  nothing private; from a `.iyimod` directly or a `.iyi` compiled alone.

- **Concurrency exists, in exactly the order III.4.8 said it must.** A
  scheduler, then cancellable blocking primitives, then `group` and
  `Channel` — never the cheap slices: no `Share` marker gating nothing, no
  sequential `group` wearing concurrency's spelling. `src/iyi/concurrency.iyi`
  is the runtime: a one-word context (the saved stack pointer), a naked
  context switch for x86-64 and aarch64 that `@[NoInline]` had to protect
  before the release build stopped faulting, 256 KiB fiber stacks with a
  guard page each, a run queue, a deadline-sorted sleep list, and an `epoll`
  drained whenever nothing is runnable. Raw syscalls throughout, so the
  dependency floor (III.9) holds: the gate allows the runtime zero new
  undefined symbols, and the aarch64 object still has none.

  The surface is III.4.1's: `group do |g| ... end` with no bare spawn, the
  join deferred so no exit — not a `return`, not an error through `!` —
  leaves a task running; `g.spawn { }` answering a task whose `value` joins;
  the first failing task cancelling its siblings. Cancellation reaches a
  *blocked* fiber (III.4.2) and arrives as a value: a woken primitive
  answers `Cancelled`, an ordinary error member, so `!` drains a cancelled
  task through its remaining waits — III.1.2 doing III.4.2's plumbing.
  `sleep`, `wait_readable` and `iyi_read` are the cancellable primitives,
  and `read_input` goes through them on Linux — III.4.8 named that exact
  call as the one that had to stop being a direct blocking syscall, so a
  fiber reading stdin now parks instead of stalling its siblings, and a
  regular-file stdin (`< file`), which epoll refuses with EPERM, is
  answered "readable now" rather than died on;
  `Channel(T).new` is a rendezvous, as Crystal's is — a parked sender
  carries its value in its queue node's box and an emptied box is the
  delivery receipt — `.new(n)` buffers `n` sends first, a closed channel
  drains before it refuses, and `close` wakes every parked fiber: a
  receiver with `ChannelClosed`, a sender with its box still full. A park
  is named by a nonce, so a queue node a cancellation left behind is
  skipped by arithmetic rather than unlinked by hand — the same protocol
  `select`'s expansion will lean on.

  `bench/concurrency_exercise.sh` gates it, plain and `--release`, with two
  failure proofs: a deadlocked program must exit 1 naming the deadlock
  rather than hang, and the interleaving assert must itself be reachable —
  a misordered copy must fail. The anti-sequential properties are asserted,
  not printed: a channel ping-pong whose letters must alternate, two 150 ms
  sleeps that must overlap, a 10 s sleep that must end in tens of
  milliseconds when a sibling fails, a rendezvous send that cannot print
  its second half before its receiver moves, and three parked senders
  drained in the order they parked.

  `select` works, over any mix of receive and send arms, `else` included.
  The expansion the compiler already had (`::Channel.select({arms})` and a
  case over the index) is served by one variadic def: the arm tuple's
  arity is a compile-time fact a macro walks, so no arity is special. An
  arm parks with the same nonce-named node every plain call uses, a send
  arm can win *while parked* — a receiver empties its box directly — and
  on a cancelled task the first arm answers `Cancelled`, exactly as that
  arm's own primitive would have. Two prelude debts surfaced and were
  paid: `Object#===`, which any integer `case` needed, and
  `TypeCastError`, which the expansion's `.as` names on its failure path
  — a panic wearing the constant's name, since nothing here unwinds.

  The typed group is in — III.4.1's own example, taken literally.
  `group do ... end!` answers the tuple of what its direct spawns
  returned, or the first error member, with `!` propagating it through
  III.1.2's ordinary machinery — the expansion appends `g.join` and an
  `is_a?(::Error)` extraction chain to the block, and `group` now answers
  what its block answers. The build forced one correction worth keeping:
  the first version inlined the block into its caller and the gate broke
  it — an inlined name collided with a later closure's, and closured
  variables do not narrow — so the block stays a block. A spawn in a loop
  keeps the general form, asserted in the gate; `end!` needed the lexer
  told that `!` is not part of a keyword's name either.

  Not built, and said so in III.4's margin: `Share` (one thread cannot
  race, so it would refuse nothing testable), and every platform that is
  not Linux — wasm32 cannot switch stacks, and an imitation is the thing
  III.4.8 refused to ship. The prelude stands at 5,674 lines against a
  ceiling of 3,734 — remeasured, not raised: the ceiling is Crystal
  0.1.0's core, that core shipped concurrency (`thread.cr`, `fiber/`, 183
  lines), and the original list had left it out because iyi then had
  nothing to compare it against. Same tree, same purpose, both sides
  counted.

## 0.3.0 — 2026-08-26

**A shard crosses a boundary.** 0.2.0 swept nine shards through `--crystal` and
served HTTP from source; how many of the rest worked was not something it
measured. This release measures it, and the thing being measured changed:
`crystal tool bind` turns a shard into a `.iyimod` — declarations and object
code — and a program is built against that rather than against the shard's
source. R-1 the whole way down, for code nobody wrote in iyi.

Three shards cross, and twelve of Crystal's own namespaces, each under a gate
that runs the program and compares its answers with the same program built
from source:

| | |
|---|---|
| kemal 1.12.0 | routes, URL and query parameters, the handler chain, `Kemal.run` — through four boundaries, with backtracer, radix and exception_page under it |
| jwt 1.6.1 | a token signed and read back, through four boundaries, over openssl_ext, bindata and bindata/asn1 |
| sqlite3 0.21.0 + db | a table created, rows bound and inserted, a result set read with typed columns — two boundaries, and the first pair where one shard declares what the other must answer |
| twelve of Crystal's own namespaces | `JSON`, `URI`, `Log`, `Path`, `Time`, `Base64`, `UUID`, `INI`, `CSV`, `Colorize`, `XML`, `Random` |

A hundred and nineteen findings came out of it and each is written down below,
measured rather than reasoned about. The ones that changed a rule: a body that travels
is compiled twice and the two are not the same function; an `abstract def` is a
requirement and not a header; a constant has two spellings and which one a
build picks is a fact about that build; and a module is a mixin on the other
side of a `--crystal` boundary, which iyi's own module header had been
assuming otherwise.

What does *not* cross is worth as much as what does. A shard whose surface
needs a human to write it down is refused with the list, not guessed at:
`crystal tool bind` prints what it could write, what a machine could write, and
what nobody can — and the last of those is a number this release moved rather
than eliminated.

`.iyimod` goes from format 19 to 40. A 0.2.0 artifact is rejected and rebuilt,
never migrated, which is the rule below doing its job. Artifacts written by
this release are read by every other build of it on the same target and under
the same flags.

### Added

- **A module is a mixin on the other side of a `--crystal` boundary, and the
  format now says so.** iyi's module header desugars to `extend self`: in iyi a
  module is a compilation unit, not a mixin, so its functions belong to the
  module itself. A boundary's declarations are read under that header, and a
  `--crystal` boundary reopens a module of the *other* language — where a
  module is a mixin, a module function is written `def self.` and an instance
  method is not. Extending it anyway put the module into its own metaclass, and
  `module Random`, which has `abstract def next_u` for its includers to answer,
  then had a metaclass that answered nothing: `abstract def Random#next_u()
  must be implemented by Random:Module`, on a program whose only line was
  `import random`. Plain Crystal refuses `extend self` beside an `abstract def`
  for the same reason.

  So the header supplies it no longer, and the artifact carries it — which is
  the honest place for it, because whether a module extends itself is a fact
  about the module. `Random` crosses; `module Shard; extend self` still has its
  functions on the module on both sides. Two things had been leaning on the
  header without saying so, and both said `undefined` the moment it stopped:
  the constant accessors `tool bind` synthesises are module functions and are
  written `def self.` now on both sides of the boundary, and the `extend self`
  line has to come *after* the requires the header lifts out, or every one of
  them stays inside the module.

  `.iyimod` goes to format 40. A 0.2.0 artifact was already rejected; a 39 one
  is too.

- **Eleven of the library's namespaces cross, and each is a gate.** `JSON`,
  `URI` and `Log` were already there; `Path` and `Time` joined with the
  constant finding below, and `Base64`, `UUID`, `INI`, `CSV`, `Colorize` and
  `XML` found nothing at all. That last part is worth having: a gate that holds
  only the cases that once broke says nothing about the ones that never did,
  and "never did" stops being true the moment somebody changes how a boundary
  is written. Eleven namespaces, bound and consumed, in two minutes.

- **A module's own instance method travels as a body.** It is compiled once per
  including type, which is the fourth thing IV.1g says has no single symbol to
  key on — and the producer emits one only for the including types its own code
  instantiated. `db` has them because `db`'s code closes all three of its
  `Disposable`s; `module Gen` with a `def next_pair` and a `class Fixed` that
  includes it has none, and the link ended on
  `*Gen::Fixed@Gen#next_pair:Tuple(UInt32, UInt32)`.

  The keep file learned the other half. These are declared as the module's, and
  an iyi module header is `extend self`, so a consumer reads them on the module
  *and* on whatever includes it — which is what an including type needs and is
  not a claim about the shard. `module Random` writes `def new_seed` without
  `self.`, and `Random` answers to no such name; called in the keep file, which
  is compiled against the shard's own source, it stopped the fill build on
  `undefined method 'new_seed' for Random:Module`.

- **A module used as a value has no name a declaration can write.**
  `Random::Secure` is `module Secure; extend self; include Random; end`, and
  `Random#split` answers `(Random::PCG32 | Random::Secure:Module)`. The
  nameability scan read `Secure` and `Module` as two names, found both
  nameable, and wrote it down; the consumer's parser stopped on `expecting
  token ')', not 'Module'`. One colon, not two — `Foo::Module` is a type
  somebody could declare.

- **`Path` and `Time` cross, and a constant has two spellings.** A constant
  read before it is initialised is reached through `~NAME:const_read`, a
  function in the main module that runs the initialiser once; one initialised
  before anything read it is a plain global. `initialize_const` picks between
  them on `const.read?` at the moment initialisation is emitted — which is a
  fact about *that build's* order and not about the constant. The producer's
  units read these and it emitted the function; the consumer initialises them
  from its own program and emitted the global, so the artifact's object code
  asked for a function nobody wrote: `undefined symbol:
  ~Iterator::Stop::INSTANCE:const_read`, referenced from `Path`'s
  `PartIterator` unit, in a program whose own source names no iterator.
  `Time::Span::ZERO` is the same thing one namespace over. The consumer now
  defines the missing spelling for every name in an artifact's `Constants`,
  beside the type ids and the match funs it already defines for the same
  reason. The global is defined either way, so a unit referring to that instead
  still links.

  Forcing the flag from the front end instead — a `pointerof`, which is what
  `needs_init_flag?` already answers to — is wrong twice over, and both ways
  are recorded because both were measured: it initialises nothing, so
  `kemal/dsl`'s `APP` came back with its routes unregistered, and with a read
  kept beside it the changed order closed `STDERR` under `bench/bind_chain.sh`.

- **A module's instance method is not a module function.** `owners` took the
  module's own name unconditionally, on the reasoning that a module written
  `extend self` defines its functions there. A module that does *not* write it
  does no such thing: `module Random` writes `def new_seed` without `self.`,
  which is an instance method its includers get and not a name `Random` answers
  to. Read as a module function it produced `Random.new_seed` in the keep file
  and the fill build stopped on `undefined method 'new_seed' for
  Random:Module`. The bare name is taken now only where the module's metaclass
  has the module among its ancestors, which is what `extend self` does.

- **A kemal application in `samples/crystal/kemal`.** Routes, URL and query
  parameters, a JSON endpoint that reads a POST body, and a 404 handler. The
  shard is not vendored: `shard.yml` pins kemal 1.12.0 and `shards install`
  fetches it, the same as any Crystal project. It builds from source and again
  across four `.iyimod` boundaries, and the two answer byte-identically — one
  line differs between them, `require "kemal"` against `import kemal`.
  `bench/kemal_serves.sh` is this program with a gate around it; this is the
  same thing written to be read.

- **`sqlite3` runs a query.** A program that imports `s_q_lite3` opens a
  database, creates a table, inserts two rows with bound parameters, reads a
  scalar back, iterates a result set with typed `read(String)` and
  `read(Int32)`, and counts the rows — through two boundaries, `db` and
  `sqlite3`, and answers what the same program answers from source. The third
  real shard to cross, and the first whose boundary is *two* shards deep: the
  driver implements what the pool declares, and neither one ever sees the
  other's source.

  **A body that travels is compiled twice, and the two are not the same
  function.** The producer compiles it against declarations. Where such a body
  calls an `abstract def`, the producer's world may hold nothing that answers
  it — `db` alone has no driver — and what `db`'s artifact carries for
  `Connection#fetch_or_build_prepared_statement` is a function whose `else`
  branch returns its own argument. The consumer compiles the same body against
  `SQLite3::Connection` and gets the right one. Both wore the same name; the
  consumer's copy is private to its unit and the producer's is global, so every
  call the consumer wrote bound to the producer's. `DB.open` handed back a
  statement whose `crystal_type_id` was 1, and `.class` on it hit the trap at
  the end of a dispatch nothing matched — `Invalid memory access` in
  `SQLite3::Statement#perform_exec`, three frames further on than the cause.
  The consumer's copy now carries a suffix, so a name that means two different
  things is two symbols. The producer's stays global: its own object code calls
  it, and so does `sqlite3`'s — `Statement#do_close` calls `super` — and hiding
  it broke the link instead.

  **An `abstract def` is a requirement, not a method with an empty body.**
  `Def#body` is the empty string for one, which is truthy, so a requirement
  came through the generic path as a concrete method that answers `nil`. The
  format has said `required` since abstract classes crossed; the generic path
  was not saying it. Read back as an implementation, `db`'s
  `SessionMethods#fetch_or_build_prepared_statement` was the null statement.

  **A requirement with a `Nop` body is not a header.** A declaration read from
  an artifact has an empty body and is typed from its return annotation, which
  is what makes a boundary cheap. An `abstract def` looks exactly like one and
  is the opposite: no code answers *it*, the code that answers lives on a
  subclass. Taking the header path there typed the call and emitted none, and
  the caller read whatever the stack held.

  **A written return type is a restriction, and a travelling body keeps it.**
  Three places wrote the return as empty wherever the body answers, on the
  reasoning that a body that travels is read for what it returns. That is true
  and it is not a reason to drop what the shard wrote: Crystal narrows a
  written return to what the body produced, exactly as it does for the shard,
  and *dropping* it made `sqlite3` refuse its own override — `this method
  overrides ... which has an explicit return type of Stmt`. A requirement's
  return type is inherited by the implementation for the same reason its
  parameter types are.

  **The head of a path can be shadowed, not just a bare name.** `db` writes
  `::Log::Metadata::Value` — with the `::`, because a shard's author meets this
  too — and resolving it to `Log::Metadata::Value` put the shadowing one
  segment along: `undefined constant Log::Metadata::Value`, read inside a
  module that has a `Log` of its own.

  **A name inside `responds_to?` is a call, and it is the one call the search
  cannot follow.** The private-callee search reads a travelling body and finds
  the private methods it names; `responds_to?(:name)` names one on a receiver
  that is whatever the caller passed. `db` writes `Pool(T)#checkout` — generic,
  so its body travels — ending `res.responds_to?(:before_checkout) &&
  res.before_checkout`, and `Connection#before_checkout` is `protected`. `Pool`
  is not `Connection`'s ancestor and `T` binds to it nowhere a search can read,
  so the hook stayed behind: `responds_to?` answered false in the consumer,
  `auto_release` was never set, and no connection went back to the pool. Every
  statement got a fresh connection — which a file-backed database does not
  notice and `:memory:` does, losing its table between statements. Every body
  that says `responds_to?` is now searched for every type, which errs long the
  way the rest of that search does.

- **`jwt` works.** A program that imports `j_w_t` encodes a token, decodes it
  back and reads the header out of it, through four boundaries —
  `openssl_ext`, `bindata`, `bindata/asn1`, `jwt` — and answers what the same
  program answers from source. The second real shard to cross, and a different
  kind of shard from kemal: C-linked, written on macros that write classes, and
  with an exception hierarchy of its own. Eleven findings came out of it.

  **A body is what a method is, where the caller decides what the method is.**
  Already the rule for a block whose type nobody wrote; the same question asked
  of the arguments is a parameter with no restriction, a splat, or a double
  splat. `JWT.encode(payload, key : String, algorithm : Algorithm,
  **header_keys) : String` is the whole of making a token, and R-2 refused it
  and asked a human to annotate `payload` — but there is no annotation to
  write. The type is the caller's. Crystal compiles a member of that family per
  call site with the call site's types in the symbol, so there is no single
  symbol to link against and the body is the only honest declaration. The keep
  file learned the other half: a signature with a splat, or a parameter whose
  type holds an `_`, is one there is no value to make and no symbol to keep.

  Two collectors had drifted apart and the type side was behind. The
  module-function collector has read `storable` as a question about a method
  *called by symbol* since `Kemal.run` crossed; the type collector read it as
  unconditional, so `OpenSSL::PKey::RSA.new(encoded : String, passphrase =
  nil)` was dropped over `passphrase` and a consumer got the one overload left:
  `expected argument #1 to 'OpenSSL::PKey::RSA.new' to be Int32, not String`.
  And a body-carrying `new` stays behind *because it is synthesised* — an empty
  receiver is what says so — where `openssl_ext` writes three of its own.

  **`initialize` travels where the `new` made from it did not, and "did not" is
  a question about a shape.** "Only where `new` is absent" held while the only
  `new` was the compiler's. `openssl_ext` writes two `def self.new` on
  `OpenSSL::PKey::PKey` and two `initialize` beside them, and the `new` made
  from `initialize(is_private : Bool)` is a fourth overload nobody wrote,
  refused because an abstract class cannot be allocated. The name test saw two
  `new`s and called the type covered.

  **A constant's value is code, and code has a scope.** The value travels as
  source, and that source can call what R-2 held back — `GETS_BIO = begin …
  io_for(bio) … end` inside `class OpenSSL::GETS_BIO`, where `io_for` is
  `private def self.`. The private-callee search already existed for travelling
  bodies; a constant's initialiser is one. And the value has to be the value as
  *written*: `bindata`'s `KLASS_NAME = [ASN1::BER::ExtendedIdentifier]` reached
  the format as five statements over three temporaries and the consumer said
  `undefined local variable or method '__temp_829'`.

  **What a shard adds to a `lib` is more than its types**, and the correction
  is the previous entry's own reason turned around. A `fun` is a C symbol and
  the linker resolves it — true of the object code an artifact carries, false
  of the bodies it carries, because a body the consumer compiles makes the call
  itself: `undefined fun 'pem_read_bio_rsa_private_key' for LibCrypto`. A
  `lib`'s `enum`s and constants came with it. And the names in `Reopened` are
  names the consumer can write: counted as unnameable, `OpenSSL::PKey::PKey`
  crossed as a *handle* — no fields, and no `new` with them — over an `@pkey`
  field naming the `LibCrypto::EvpPKey` the shard itself declares.

  **A class variable is identified by its owner and its name, and the
  bookkeeping was keyed on neither.** `MetaTypeVar` is a `Var`, whose equality
  is `def_equals_and_hash name`. A class variable declared on a superclass is
  copied onto every subclass that reads one, so `bindata`'s `@@bit_fields` is
  six variables and was one hash key: the unit `ASN1::BER` reads four of them
  and the last write took the entry. The link ended on
  `~ASN1::BER::bit_fields:read`. That copy is also where the initialiser was
  being lost — `lookup_class_var?` carries the type, the thread-local flag and
  the initialiser node, and iyi had added a field the copy did not carry.

  A third way of reading one is visible in the code and stays unhandled on
  purpose: where the owner is a virtual type the read dispatches on the
  receiver's type id through a main-module function, and the main module never
  travels. That is what the symbol above looked like, and it was the wrong
  reading — the fix for it was written and taken back out, because nothing has
  reached that path and a rule with no measurement behind it is worse than a
  gap that is written down. SPEC.md Part V item 12 has it written down.

  **A class is held virtually, and the keep file was naming it.**
  `BinData::VerificationException.to_s(io)` emits
  `*BinData::VerificationException::to_s<IO+>`; a consumer holding the class —
  `io << exception.class` — asks for `*BinData::VerificationException+@…`. The
  keep file now calls the class side through `uninitialized T.class`. Not
  `new`: a virtual metaclass dispatches it to every subclass, and a subclass
  builds itself its own way.

  **`yaml` crosses too, and what stood in its way was one link flag.**
  `bench/yaml_reads.sh` binds a boundary from Crystal's own library — not a
  shard, which is what makes it a different measurement — and a consumer parses
  a document with an anchor and a merge key in it. The older reading, that its
  `@anchors` is typed by merging what two users of a shared module put in it,
  is no longer what happens; what was left was `undefined symbol:
  yaml_parser_parse`.

  **Which C libraries a boundary's object code needs now travels, as `Libs`
  (section 18).** `Requires` says what the consumer has to have *compiled*;
  this says what it has to have *linked against*. The consumer replays `require
  "yaml"` and so has `lib LibYAML` and its `@[Link("yaml")]` — and
  `link_annotations` collects a flag only from a `LibType` that is `used?`,
  which is a question about this build's own code. The call is in the
  artifact's `YAML::PullParser` unit, an object file the consumer reads rather
  than compiles.

  Names and nothing else: everything a link line needs — `pkg_config`,
  `ldflags`, `framework`, static — is already on the consumer's own copy of the
  annotation. What was missing is only that somebody used it.

  **A boundary built from the library is a different question from a shard.**
  `JSON`, `URI`, `HTTP`, `Compress`, `Digest` and `OptionParser` all bind, fill
  and answer what their source answers; `bench/library_boundaries.sh` holds
  three and `bench/yaml_reads.sh` a fourth. `Log` is global state written by
  macros, and it found four things.

  **`tool bind` has to survive its own question.** It asks what a shard's own
  compilation never asks, and for `Log` the answer is that typing the call does
  not terminate — it recurses through `Call#recalculate` building a metaclass
  of a metaclass until the stack ends. A stack overflow is a signal rather than
  an exception, so the `rescue` the tool had could not see one.
  `Program#iyi_instantiation_limit` is nil for every ordinary build and set by
  this tool, and past it the recursion becomes a refusal it knows how to
  report. **And a parameter written `Class` is one there is no value to stand
  for** — every metaclass there is, and there is no end to them.

  **A class variable the library declares is not the artifact's to declare
  again.** A boundary rooted at the library's own namespace writes that type
  whole, the consumer replays the require and has the real one, and the
  variable arrives twice — one initialiser wins and it is not the artifact's.
  `Log.setup` reached a `@@builder` nobody had built. The name still travels in
  `ClassVars`, which is what makes the global exist for the object code.

  **And `MonoBodies` was keyed without the side of the type** (format v35). Two
  `{% for %}` loops in `Log` write `info(*, exception : Exception)` on the
  instance and on the class: same container, same name, same parameters, no
  block, one key. The class method's body took it, and the consumer read
  `Log#info` as `Log#info` calling itself — `recursive block expansion`.

  **`db` and `sqlite3` ask for everything at once**, and they are not through
  yet — eleven more rules came out of them, and one named blocker is left.

  **A record rebuilt field by field loses what was added to it later.** Three
  rewrites constructed a fresh `TypeDecl` by listing its fields, and every list
  was written before `funs` existed — so a reopened `lib` arrived with all its
  types and not one `fun`. `copy_with` names only what changes.

  **A generic module's nested types are not parameterised by being nested**, and
  a generic's `superclass` and `includes` were missing entirely —
  `SessionMethods(Session, Stmt)` includes `QueryMethods(Stmt)`, which is where
  `exec` lives. **A generic module's instantiation is not a `ModuleType`**
  either, so `include SessionMethods(Database, PoolStatement)` was dropped.

  **A `lib` the shard owns outright belongs inside its module**, where its funs
  can name the shard's own types. `Reopened` is for one the library also
  declares.

  **An include is an ordering edge like a superclass, and so is every name in
  it** — the module and each of its type arguments.

  **A block's annotation travelled as written while everything beside it
  travelled resolved**, and resolved it has to stay an arrow: the keep file
  reads the arrow to count block parameters, and the `Proc` form counts the
  output as an input.

  **`uncompilable` is not a question to ask of a private callee**, a bare
  generic is a name rather than a type, and **a body that travels is compiled
  per subclass, so the privates it calls travel per subclass too**.

  **And `NoReturn` is an answer only where the body stays behind.**
  `NullIO#read` raises and nothing overrides it; `DB.build_driver` answers
  `NoReturn` only because this build registered no driver, and its body
  travels.

  **`previous_def` travels** (format v37). A redefinition does not sit beside
  the definition it replaces — `add_def` puts the old one on `previous` — so
  the chain is walked and each link gets its own `MonoBodies` key, numbered in
  the order they were written. The sorts that order a type's methods had to
  become stable for the count to mean anything.

  That numbering exposed a duplicate that had been there for weeks:
  `Kemal::CLI` carried **two** `def initialize(args)`, and nobody could tell,
  because both read the same key and rendered the same body. Numbered, the
  second rendered empty — and an empty `initialize` is the one Crystal's own
  rule keeps. `initialize` is protected, so the private-callee search let it
  past, and that search asked "has this crossed?" by name where it had to ask
  by signature.

  **A method that answers an ancestor's `abstract def` travels whatever its
  visibility** — the body is in one boundary's artifact and the implementation
  in another's, and the requirement is the only thing they share. **A
  parameter's external name is part of the method** (`as type : Class` is
  written `as:` at the call site). **And `forall` is another way of saying the
  caller decides**: one method per binding, so the body travels, and the
  `forall` clause itself was never carried at all.

  Two smaller ones: the private-callee search keyed its pool on parameter
  *names*, so `sqlite3`'s ten `bind_arg` overloads were one; and a synthesised
  `new` must never travel from that search either.

  **A list of what a module defines is only worth having if it is the list of
  what it has.** `Symbols` was collected for every name in `unit_names` while
  the object code was collected only for those with a file behind them, so an
  artifact could claim a symbol it did not carry. `mod dump` now names the
  symbols rather than counting them.

  **A `TypeDecl` carries its annotations** (format v38), and with them every C
  symbol `sqlite3` needs resolves. `Libs` carries *names* on the argument that
  everything a link line needs is already on the consumer's own copy of
  `@[Link]` — true of a `lib` the library declares, false of one only the
  shard has, where the consumer's copy is the only copy and it arrived bare.

  **A keep file stopped at the first method that only raises**, and every call
  after it was discarded: `CleanupTransformer` stops collecting an
  `Expressions` at a statement of type `NoReturn`, which is right for a program
  and ruinous for a file that is one long list of calls. Every keep file this
  tool has written has been truncated that way at some line, and it went unseen
  because a shard usually reaches its own methods somewhere. Each call goes in
  its own `begin`/`rescue` now, and `sqlite3`'s undefined symbols went from
  forty to five.

  **A `lib`'s name is the half that cannot move.** Moving a shard-owned one
  inside the artifact's module fixed name resolution and broke symbol identity
  — the same method mangled two ways, because every symbol whose signature
  names one of the lib's types is built from the lib's name. It goes back to
  the top level, and the funs bend instead: a parameter written
  `SQLite3::Flag` is written as the enum's base type, which costs nothing
  because a C function takes the integer and Crystal converts an enum at a
  `fun` call without being asked.

  **A boundary carries what the shard wrote, and it was carrying Crystal's
  library too** — `Class#name` crossed as a header, which is a promise of a
  symbol per subclass that only the types with units behind them could keep.
  The test is where a method is *not* written: inherited from Crystal it stays
  behind, inherited from another shard it travels.

  **A module's methods are the fourth thing whose body has to travel**,
  alongside a generic's, a block-taker's and an abstract class's, and for the
  same reason: instantiated per *including* type, and the includer may be in
  another boundary. **An empty body is a body** — `protected def do_close; end`
  is a hook, and reading it as nothing to carry sent `super()` past every
  ancestor to `Object`.

  **A shard's top level is more than its constants.** `DB.register_driver
  "sqlite3", SQLite3::Driver` is one statement and the thing that shard exists
  to do; only constants were crossing.

  **A field's default travels, and it travels in the field's place** (format
  v39). Only the type was crossing, so a consumer allocated `@total = [] of T`
  null. The first attempt put the defaults where the class variables go, and
  that was wrong for a reason worth keeping: a field's position in the list is
  its position in the layout, and the module's object code was compiled against
  it.

  **And a default is the third thing to need the value as it was written** — a
  regex literal is replaced by the constant the compiler cached it in.
  Constants and class variables already did this; instance variables now do
  too. A fourth thing cannot travel at all: a body that reads `$~`, which is
  scoped to the method that matched.

  `sqlite3` compiles, links, runs, opens the database and builds its pool. What
  it does not do yet is answer: `SQLite3::Statement#perform_exec` reads from a
  null receiver — a statement that was never built.

  **A declaration cannot name a virtual type, and everything downstream was
  reading that as the exact one.** The symbol is made of the type the method
  actually answers, so a consumer calling `db.checkout` directly asked for
  `*DB::Database#checkout:DB::Connection` and nobody had emitted one. And a
  header's return type was read literally — an ordinary `def f : Connection`
  over an abstract class types its call `Connection+`, but a header has no body
  to widen it. Every generic below was instantiated with the wrong argument,
  and a `SQLite3::Connection` in an `Array(DB::Connection)` read back as its
  own base: `is_a?(SQLite3::Connection)` answered **false**. A program that
  linked and computed the wrong answer.

  **A shard's own `alias` does not travel, and a body names one** — an alias is
  a name for a type rather than a type, so the walk dropped it at the door.

  **And a body's text takes the same rewrite its signature does.** A body names
  things the way the module wrote them, absolute, and the declarations are read
  inside a module whose root has been stripped — so R-2 answered for
  `SQLite3::TIME_ZONE`. One exception: a top-level `def` is rendered outside
  the module, so its body keeps the absolute name.

  Both now have a gate in `bench/bind_roundtrip.sh`, and each took two tries: a
  *written* return restriction on an abstract class is widened by Crystal
  anyway, so the check needs an **inferred** one; and a module function's body
  already took the rewrite, so the check needs a *type's*. A gate that passes
  before the fix proves nothing, and both of these did until they were run
  against the broken compiler.

  **And a name resolves in its own scope first.** `openssl_ext` writes a
  constant `GETS_BIO` inside `class OpenSSL::GETS_BIO`, so the return type R-2
  asks for on its `new` read as the constant. `self` is the spelling with no
  such problem, and on a metaclass it is exactly what `new` answers.

- **What a shard adds to a `lib` travels, and that was smaller than it
  looked.** `openssl_ext` reopens `lib LibCrypto` with a dozen C structs, two
  unions and a handful of `type` aliases, and a consumer stopped on
  `"open_s_s_l" numbers \`Pointer(LibCrypto::Bignum)\`, and this build cannot
  name it` — Part V item 12's own open question, reached.

  **Types only, and the reason is the whole finding.** A `fun` is a C symbol:
  `BN_new` is resolved by the system linker against `-lcrypto`, not by anything
  either side compiles, so a consumer that does not call one itself needs no
  declaration for it. What it needs is to be able to *name* the types, because
  naming is what numbering is made of. That turns a `lib` extension into the
  same shape as `Reopened` — `lib ::LibCrypto` with the members the shard
  wrote — rather than a new kind of thing.

  Two smaller rules came with it, each found by the next failure. A `lib`'s
  alias is spelled `type Engine = Void*` where a class's is `alias`, and the
  renderer knew only the second, so it wrote `type Engine` and closed it:
  `expecting token '=', not 'end'`. And **a class root keeps its class
  variables in its class.** They were written at the module level too — right
  for a module root, which is not a `TypeDecl` and has nowhere else to put
  them, and wrong for a class, which is already carrying them. `bindata` is the
  first shard here whose root is a class, and it said `can't use class
  variables at the top level`.

  What stops `jwt` now is one step further on: `ASN1::BER`'s own
  `@@bit_fields` crosses without the initialiser its superclass's macro gives
  it, and a non-nilable class variable must have one.

  Two things came out of measuring it. `bindata` defines **two** top-level
  namespaces, `BinData` and `ASN1`, and the second lives in its own file that
  `jwt` requires separately — so a shard is not always one boundary, and
  `-e` names a root rather than a shard. And binding into a directory that
  already holds a *later* boundary gives the earlier one an import edge to it:
  the order in `bench/bind_chain.sh` is load-bearing, and a stale `mods` from a
  previous run made three measurements here say `ASN1::BER` when the answer was
  `LibCrypto::Bignum`. Both are the kind of thing that reads as a compiler bug
  and is not.

- **`Kemal.run` — with no block, the way kemal's README writes it.** The
  overload that takes none is `def self.run(args = ARGV, trap_signal : Bool =
  true)`, whose whole body is `run(nil, args: args, trap_signal: trap_signal)`:
  it fills in a default and delegates. R-2 refused it for `args`, and R-2's own
  reason does not apply — a consumer typechecks a call *through* a travelling
  body, exactly as the shard's own callers do, and this body is one line naming
  a method that is already crossing.

  Narrow on purpose. "An untyped parameter is no reason to refuse a method
  whose body travels" is the general form, and it is a much larger claim: it
  would send a body for every method a shard left untyped, each one source the
  consumer has to compile and each one able to name something that did not
  cross. A delegating overload is the shape that shows up in a library's own
  API — the one that exists to be convenient — and widening it is a measurement
  nobody has made yet. `bench/kemal_serves.sh` writes `Kemal.run`, so the gate
  says which of the two this is.

- **A real kemal application serves HTTP through four boundaries**, and
  `bench/kemal_serves.sh` is the gate that says so. `GET /` answers `hello
  from a boundary`, `GET /echo/:word` reads a URL parameter, `GET /missing`
  answers 404, and the two arms — one built from source, one from artifacts —
  answer identically. That was the measure this part existed to reach.

  It is a gate rather than a note because every failure on the way here was a
  *quiet* one: a consumer that linked and then read a field nobody had
  allocated, a `class.to_s` that answered the wrong type for seven handlers in
  a row, a `new` that never ran an `initialize`. A gate that stopped at "it
  compiles" was green through all of them, which is why this one asks for
  pages. The 404 is deliberate: it is kemal's own `setup_404`, which
  `Kemal.run` reaches through a private module function whose body travels, so
  it says the unhappy path crossed too.

  What it took was the one question Part V item 12 had left open: **a shard
  that adds to a type it does not own.** Kemal reopens
  `HTTP::Server::Context` — the library's class — and gives it `@params` and
  eighteen methods. A boundary carries none of the library's types on purpose,
  because the consumer replays the requires and has them, and declaring one
  twice is how a build stops on `superclass mismatch`. So the addition had
  nowhere to go: the consumer said `undefined method 'params'` where its own
  code asked, and where the shard's compiled code asked it read a field the
  consumer had never allocated — a segfault several handlers into a request.

  The answer is the rule the tool already used one level up, asked of a type's
  members instead of a namespace's types: **what the shard wrote travels, and
  what the library wrote stays**, decided by where each member is written.
  `Section::Reopened` carries it, rendered `class ::HTTP::Server::Context`, and
  with bodies — these methods are compiled into the *library's* unit, which a
  boundary does not carry.

  Three things had to travel with it, each its own small rule:

  - **A member written by a macro belongs to the file that wrote the macro.**
    `macro finished` declares three of `Context`'s fields, and their location
    is the expansion. Asked naively they looked like nobody's, so they did not
    travel and the consumer inferred them: `@cached_route_lookup was inferred
    to be Nil, but Nil alone provides no information`.
    `Location#expanded_location` is that walk and already existed. It also
    brought **`get` and `post`** across, which a macro loop writes and which
    are the other half of kemal's DSL.
  - **A field travels with its default.** `@store = {} of String => StoreTypes`
    has one, and the library's own `initialize` knows nothing about it: `this
    'initialize' doesn't explicitly initialize instance variable '@store'`.
  - **And that default is written with its names resolved**, like every other
    text here, because it is read where the shard is not: `StoreTypes` is an
    alias kemal declares inside `Context`, and the consumer said `undefined
    constant`.

  One filter came off on the way. A field whose type this boundary could not
  name relative to the shard was dropped, and a dropped field is worse than one
  that arrives needing a name — the second says so, the first leaves the
  consumer to guess `Nil`. What makes another boundary's `Radix::Result`
  writable is the name mapping, not that filter.

- **A `new` read from an artifact, called without a default argument, never
  ran `initialize`.** The quietest failure a boundary has produced. A def from
  a `.iyimod` is a header — no body, the machine code is in the artifact — and
  a call that leaves out a default gets a wrapper that evaluates the default
  and forwards the whole list to the symbol. Two things stopped that wrapper
  from being written.

  `expand_default_arguments` retains the original body whenever an argument has
  both a default and a restriction, which `ParamParser.new(request, url :
  Hash(String, String) = {} of String => String)` does. Retaining a header's
  body copies `Nop` and drops the forwarding call on the floor, so `new`
  returned the default it had just computed, having allocated nothing.

  And the wrapper's body was never typed: the fast path for an artifact def
  keys on `match.def`, which is still the header, and skips the body visit. The
  default assignment therefore reached `CleanupTransformer` untyped, which
  replaces an untyped node with a `raise` — so the program compiled, linked,
  and died on `can't execute \`url = {} of String => String\`` the first time a
  request reached it. A header's body is `Nop` and a wrapper's is not, which is
  what tells the two apart.

  Measured, through four boundaries: kemal binds its port, logs `Kemal is ready
  to lead`, and a request walks the whole handler chain in kemal's own order.
  What stops it now is the gap Part V names rather than anything here: kemal
  reopens `HTTP::Server::Context` — a type the *library* owns, which a boundary
  deliberately does not carry — and adds `@params` to it. The consumer's
  `Context` has no such field and the artifact's compiled code reads one.

- **A class carries what it includes, and kemal's handler chain runs.** A
  `TypeDecl` had `superclass` and nothing for `include`, so a class that mixed
  a module in arrived as something else entirely: kemal's handlers
  `include HTTP::Handler`, `HANDLERS` is an `Array(HTTP::Handler)`, and the
  consumer — asked directly — said `type must be HTTP::Handler, not
  Kemal::InitHandler`. Where it was not asked directly it dispatched to
  whichever subtype it *did* know, and `handler.class.to_s` answered
  `HTTP::CompressHandler` for seven handlers in a row. The first reading of
  that was a type-id numbering fault; it was a missing edge, and the edge is
  `superclass`'s own argument one word further.

  Written back as `include` lines rather than into `supertraits`: a trait list
  is iyi's own `:` syntax and means something R-2b checks, and this is what the
  shard wrote in the language it wrote it in. After the types the class
  declares, because one of them may be the module — `ExceptionPage` includes an
  `ExceptionPage::Helpers` written inside it — and pruned when the module did
  not travel, by the rule that governs every other name here.

- **An abstract `def` is a written signature, and the method answering it may
  lean on that.** It is the one thing a shard's implementation is allowed to
  leave out: `HTTP::Handler` writes `abstract def call(context :
  HTTP::Server::Context)` and kemal's handlers write `def call(context) : Nil`,
  which R-2 refuses for having no type to write down. R-2 already says this for
  iyi's own impls — the trait wrote the types down, and a consumer types the
  call from the trait — and the same sentence is true of a Crystal module's
  abstract method. Matched on name and arity, which is all an abstract def has.

  Measured: the handler list read through the boundary is now kemal's own, in
  order, each with its own name. `Kemal.run` runs, kemal binds its port and
  logs `Kemal is ready to lead`, and a request walks the whole chain —
  `InitHandler`, `RequestLogHandler`, `HeadRequestHandler`, `ExceptionHandler`,
  `FilterHandler`, `WebSocketHandler`, `RouteHandler`. It stops in
  `ParamParser#cleanup_temporary_files`, which returns early for a request with
  no uploads and did not: `@files.each_value &.cleanup` ran on an empty hash
  and `FileUpload#cleanup` read a null receiver. That is the next thing.

- **A shard's top-level `def`s cross, and kemal's DSL is 22 of them.** A
  boundary is rooted at a namespace and `get`, `post`, `error`, `ws` and `sse`
  are written outside every namespace, on `Object`, where a boundary rooted at
  `Kemal` cannot reach them. `Kemal.run`'s own body reaches one: `setup_404`
  calls `error`.

  They travel in a section of their own (`TopLevel`, format v30), because where
  a declaration goes is not a property of the declaration: the file of
  declarations opens with `module <name>` and never closes it, which is what
  puts everything below it inside the module. These belong outside, so the
  reader parses a second text and accepts it where it stands.

  **With their bodies, always.** Every other declaration names a symbol in the
  artifact's object code, and that code is per type — a `def` outside every
  namespace has no type and so no unit, being compiled into the producing
  program's own main module, the one thing a boundary never carries.
  `render_404` crossed as a header and the link ended on `undefined symbol:
  *render_404:String`. One without a body cannot cross at all, which is honest
  rather than a link error.

- **A setter answers what it was handed, and now it can say so.** R-2 has said
  this since it was written — it is why a setter is exempt from writing a
  return type — and the boundary had no way to carry it. `property thing :
  Thing?` writes `def thing=(@thing : Thing?)` whose body is `@thing = thing`,
  so the shard's own callers get `Thing` from `config.thing = Thing.new`. A
  single annotation cannot say that: `: (Thing | Nil)` is right for the
  declaration and wrong for every call. `config.server ||= HTTP::Server.new(…)`
  in `Kemal.run`'s body came out nilable and the consumer stopped on `undefined
  method 'each_address' for Nil`. So the body travels, like every other
  caller-dependent answer.

- **A body that travels needs what it calls, whatever the shard called it.**
  The search for that was written as "the private methods a travelling body
  calls", and visibility was never the question. `Kemal.run` calls `def
  self.display_startup_message(config, server)`, which is public and whose
  parameters have no types — so R-2 has nothing to write down, it could not
  cross, and the consumer said `undefined method`. A method that could not
  cross is in exactly the position of one the shard keeps to itself.

- **A superclass with the same name as the class is written `::`.** Nothing
  inherits from itself, so two identical names are certainly two types.
  `Kemal::ExceptionPage` extends the `exception_page` shard's own root and both
  lose their namespace on the way out — one because an artifact's declarations
  are relative to its root, the other because a class root *is* the top level.

- **`Kemal.run` crosses a boundary, and nine separate things were in the way.**
  Running a kemal app is behind one method, and every one of these hid the next,
  so each was found only by fixing the one before it:

  - **"Yields without a block parameter" is the body being the shape.** A method
    written `&` — or a bare `yield` — has no annotated block type and so no
    single symbol; its machine code is the caller's and its body has to travel.
    Two spellings of that already counted; the third, which is how Crystal's own
    libraries are written far more often, did not.
  - **The question was never asked.** `Kemal.run(args = ARGV, …, &)` writes no
    type on `args`, so the method was refused as one a human has to write and
    its block was never looked at. The verdict is about a *declaration a
    consumer typechecks against*; a method whose body travels is not declared
    that way.
  - **A name was spent by the first overload seen rather than by the one that
    crosses.** `Kemal` writes four `run`s and two `config`s. Dedup is by
    signature now, which is what tells two methods apart — one per name dropped
    `Kemal.config`'s blockless form, and a travelling body calling it stopped
    the consumer on `is expected to be invoked with a block`.
  - **A module function's body never travelled.** It had a collector and no
    `MonoBodies` line, so the declaration arrived without a body and the
    consumer read a `def` nobody had compiled.
  - **R-2 refused the arrival.** Its premise is "nothing here can be recovered
    from the body, because the body is what stays behind" — and a `MonoBodies`
    entry is the body not staying behind. The exemption is the rule, not an
    exception to it. An author's own `pub def twice(x)` is untouched: the flag
    is set only on a def parsed back out of an artifact.

  The keep file learned two refusals of the same shape. It cannot call a
  method whose parameter has no type — the parameter's *name* stood where the
  type would, `uninitialized args` — and it cannot call one whose block nobody
  annotated, because writing a block needs its arity and `&` says nothing about
  it: `Kemal::Router#namespace(path : String, &)` was handed one parameter where
  the method yields none. Neither is a call worth making. Such a method has no
  symbol to keep alive; that is why its body travels.

  Two more, once the body arrived somewhere it could run. A class's travelling
  `initialize` was collected *after* the search for the private methods a
  travelling body calls, so nothing looked inside it: `Kemal::CLI#initialize`
  travels — its `new` is not a symbol anybody can name — and its body calls
  `parse`, which the class keeps to itself. And a module's own private
  functions never travelled at all. `Exports#carried_functions` was written for
  exactly this case, down to the example in its comment, and `crystal tool bind`
  never filled it: `Kemal.run`'s body calls `setup_404` and
  `setup_trap_signal`.

  `Kemal.run` crosses now, with its body and everything that body reaches
  inside `Kemal`. What stops the call one step further is not a gap in any of
  this: `setup_404` calls `error`, and `error` is a **top-level `def`** in
  kemal's `dsl.cr` — as are `get` and `post`, which is the whole DSL. A boundary
  rooted at `Kemal` cannot carry a method defined outside `Kemal`. That is the
  root-shape question, named rather than worked around.

  Kemal's boundary carries 37 units where it carried 20.

- **A method whose body travels may have an unannotated block.** R-2 refuses an
  exported signature without a block annotation because a consumer typechecking
  a call needs the shape — and a method whose machine code is the caller's hands
  the consumer its *body* instead, which is the shape. `Kemal.run` is written
  `def self.run(…, &)`, and the whole of running a kemal app is behind it. The
  bare `&` is written back as it was, and such a method's parameters travel as
  the source wrote them for the same reason: what a consumer compiles it from is
  the body, not the symbol.

- **A route is added to kemal's router through four boundaries.** That call is
  the DSL's own foundation, and it needed a chain of things to cross:
  `add_route` takes a block, so its machine code is the caller's and its body is
  compiled by the consumer — and that body calls `add_to_radix_tree`, which
  kemal keeps private, which calls `Radix::Tree#add`, whose body calls a private
  overload of itself, which calls `Node#add` and a `protected sort!`.

  Three things were still in the way. A body is found again by its **signature**,
  and a declaration's signatures are rewritten on the way out — stripped of the
  root, then mapped to what a consumer calls another boundary's types — so a key
  left behind was a body nobody found: the declaration arrived without one and
  the link ended on `undefined symbol:
  *Radix::Tree(Kemal::Route)@Radix::Tree(T)#add<…>`. A **bare `*`** is a
  parameter with no name, and written as nothing it is `, ,`. And
  **`protected`** is the same case as `private` here: a name a travelling body
  may call and a consumer may not write.

  `initialize` also travels where `new` could not be declared at all —
  `SharedKeyError#initialize(new_key, existing_key)` writes no restrictions, so
  its `new` is not a symbol anybody can name, and a body that travels and raises
  one met a class it could not construct.

  `bench/bind_chain.sh` adds a route now, in both arms.

- **A private method a travelling body calls travels with it.** A plain type's
  methods are machine code in the artifact, so a consumer needs no declaration
  for what they call — except where a *body* travels, and a block-taking
  method's does, because its machine code is the caller's.
  `Kemal::RouteHandler#add_route` calls `add_to_radix_tree`, which the shard
  keeps to itself, and the consumer compiling that body said `undefined
  method`.

  Which ones is a call graph, and the bodies are text: a private method travels
  if its name stands in one of them as a word, and then what *its* body calls
  travels too, to a fixed point. Reaching too far costs a declaration nobody
  uses; reaching too short is the error above, so it errs long. It travels as
  `private def` — reachable from the bodies beside it and from nowhere else,
  which is what it was — and the keep file does not name one: its parameters
  travel as the source wrote them, so there is not always a type to say
  `uninitialized` of.

  A generic's methods all cross now for the same reason: every one of them is
  compiled by the consumer, so what one *returns* is the consumer's to infer.
  Requiring an answer had dropped `Radix::Tree(T)#add`, and a consumer holding a
  `@routes` had nothing to call on it.

- **A generic type can be built from its boundary.** Its `new` is never carried
  — it is synthesised per instantiation and the consumer makes its own — and
  its `initialize` was not carried in `new`'s place, so a consumer could read a
  `Holder(Int32)` somebody handed it and never make one.

  Three things were in the way. A **default** did not travel, so
  `Node(T).new("", placeholder: true)` named a parameter the declaration did not
  have; parameters carry theirs now, written back as
  `tag : String = "none"`. A **type parameter** was recognised only when it was
  the whole restriction, so `T` passed and `(T | Nil)` did not, and
  `Radix::Node(T)#initialize` never crossed at all — the question is asked of
  each name in the type now. And a **private method a travelling body calls**
  had no declaration: `Node(T)#initialize` calls `compute_priority`, which
  `Node` keeps to itself. A generic's private methods travel as `private def`
  with their bodies, which is what they already were — every one of a generic's
  methods is compiled by the consumer.

  A plain type's private methods do not travel, and that is deliberate: its
  bodies do not either, so a declaration would be a name with nothing under it.

- **A name a shard declares itself is not somebody else's.** A boundary rewrites
  references to another boundary's types so the consumer reads them the way it
  will see them — and the map is keyed on the simple name, so `radix` declaring
  a top-level `Node` made every bare `Node` in `Kemal` into `Radix::Node`,
  including `Kemal::LRUCache::Node`. The consumer stopped on `wrong number of
  type vars for Radix::Node(T) (given 2, expected 1)`. The shard's own names
  are taken out of the map now: a bare name in its source means its own.

  It was invisible until `bench/bind_chain.sh` started binding the way a shard's
  author should — `--use-iyimod mods`, so each boundary sees the ones before it
  — which is also what takes kemal's three handle types to zero.

- **A boundary that crosses without its fields says which field did it.**
  A reference type whose fields name something the consumer cannot write
  crosses as a *handle* — a pointer, with no `new` — and the report said only
  how many. It names them now, and the name inside the field type that failed:
  `RouteHandler — Radix::Result, Radix::Tree`. Which ones matters, because a
  body that travels and touches a field of one cannot be compiled by the
  consumer, and that comes out as `can't infer the type of instance variable`
  in a file nobody wrote.

  It also showed that `--use-iyimod` is not optional when binding a chain:
  without it a boundary cannot see the ones bound before it, so `Radix::Tree` is
  a name `Kemal` cannot write. With it, kemal's three handle types become zero.

- **A block-taking `initialize` crosses, because its `new` cannot.** Crystal
  reaches `initialize` through `new` and marks it not-public, which is fine
  while `new` travels — and it does not when it takes a block, since a
  synthesised `new`'s body is the compiler's, with a temporary for a receiver.
  So the one a consumer needs in order to make its *own* `new` crosses instead,
  and only in that case: declaring `initialize` beside a `new` that also travels
  would be two ways to build the same type. The keep file does not call it —
  `protected method 'initialize' called` is Crystal saying `new` is how you
  build one — and it does not need to: a block-taking method's machine code is
  the caller's.

- **A body that travels is the body as it was written.** `Def#body` stops being
  source as soon as anything instantiates it: `Route.new(method, path,
  &handler)` becomes `_.initialize(method, path, &handler)`, and an underscore
  is not a receiver anybody can write — the consumer said `can't read from _`
  about a body it was handed. It is recorded in the top-level pass now, which
  runs before any of that, and keyed on the name as well as the place: a
  synthesised `new` carries the *location* of the `initialize` it was made from,
  so a key of one alone handed `new` the other's body.

  A block-taking `new` does not travel at all now, for the same reason from the
  other side: its body is the compiler's, with a temporary for a receiver, and
  the consumer makes its own from the `initialize` beside it — which is what
  `new` has always done here.

- **A block that returns `_` crosses.** `&handler : Context -> _` names one type
  and one *absence* of one, and the scan that asks whether a signature's names
  can be written read `_` as a name — so every method whose block returns
  whatever the block returns was dropped, `Kemal::RouteHandler#add_route` among
  them, and kemal's whole DSL is written on top of that one. There is no single
  return type to infer for such a method either, and none is needed: a
  block-taking method's *body* travels and the consumer compiles it, so the
  declaration carries no return type and the consumer reads its own.

- **A shard that reopens a library namespace carries only what it added.**
  `openssl_ext` is `OpenSSL`, and a `--crystal` consumer replays the requires
  and gets Crystal's — so the artifact's declarations met the library's and the
  build stopped on `superclass mismatch for class OpenSSL::SSL::Error`, then on
  `already initialized constant OpenSSL::BIO::CRYSTAL_BIO`. What separates the
  two is where a type or a constant is *defined*: under the shard, or under the
  library. One the library wrote is not declared and not assigned; one they
  both touch counts as the shard's, because what the shard added has to travel
  somehow.

- **A nested declaration's names are stripped to where they are read from.**
  `OpenSSL::PKey::PKeyError` stripped of the root is `PKey::PKeyError` — and
  that declaration is rendered *inside* `module PKey`, where it means
  `PKey::PKey::PKeyError` and resolves to nothing. The stripping goes one level
  deeper with each nesting now, so from in there the name is `PKeyError`. It was
  invisible until a superclass gave a nested type a name to resolve.

- **A method the compiler refuses to instantiate does not travel, and the
  boundary survives it.** `crystal tool bind` already instantiated every method
  it declares — that is how a written return type is held against the answer —
  and a method whose body did not typecheck was recorded as "could not be
  checked" and **declared anyway**. The keep file then named it, and one method
  that does not compile took the whole fill build with it: every declaration on
  disk and no machine code anywhere.

  What separates the two cases is who refused. This tool declining to ask — an
  unannotated block, a splat, a free variable — is not a defect in the method,
  and those still travel. The *compiler* refusing is, and those are dropped.
  `openssl_ext` has a `LibCrypto` call whose argument is a pointer too deep, in
  a method its own compilation never types: it went from **losing its whole
  artifact** to binding at 35 units and 31 MB, and the chain under `jwt` —
  `bindata`, `openssl_ext`, `jwt` — now binds end to end.

- **A boundary says whether its object-code step finished.** `crystal tool bind`
  writes the declarations and a second build fills them, compiling a keep file
  that names every method a consumer might call. A shard can hold code its own
  compilation never types — `openssl_ext` has a `LibCrypto` call whose argument
  is a pointer too deep — and asking for all of it is what finds that. The build
  dies and leaves an artifact with every declaration and no machine code.

  Read as it stands, that boundary promises a hundred methods and defines none,
  and the linker says so a hundred times without naming the cause once. It is
  also indistinguishable from one that legitimately has no object code: an
  abstract class with no subclass in its own shard is complete with zero units.
  So the fill step records that it finished, and a consumer of an unfinished
  boundary is refused by name.

- **A constant's accessor names the constant it reads.** The accessor a boundary
  writes for `Kemal::Config::INSTANCE` is `config_instance`, flattened with `_`
  — and the path it reads was reconstructed from that name by reading every `_`
  as `::`. It works until a type's own name has an underscore in it:
  `class OpenSSL::GETS_BIO` came back as `OpenSSL::GETS::BIO`, and the keep file
  named a constant no program has. The path travels beside the accessor now
  rather than being derived from it.

  Flattening still loses information — `A_B::C` and `A::B_C` both read `a_b_c` —
  so a second constant claiming a taken accessor name is dropped and printed
  beside the artifact, where two defs of one name would have been a broken
  boundary.

- **An abstract class crosses a boundary, and its concrete methods travel as
  bodies.** They are the third thing that has to, beside a generic's methods
  and a block-taker's, and for the same reason each time: they are instantiated
  per *subclass*, and every subclass is somebody else's. A shard that declares
  an abstract class and never subclasses it carries **no machine code for it at
  all** — which is why `exception_page` fills with 0 units, and why that is not
  a bug — so a consumer writing `class Report < Sheet` asked for
  `*Sheet+@Sheet#render` and nobody had made one.

  Two smaller things sat in front of it. The keep file *called* the abstract
  methods, and `t0.title` on a class with no subclass has no type: codegen said
  so as `BUG: … has no type` rather than as an error anybody could act on.
  And neither the method's nor the type's abstractness travelled, so a consumer
  read `def title` where the shard wrote `abstract def title`.

- **`pub abstract class`.** Being abstract and being reachable are different
  questions — one says the type cannot be instantiated, the other says who may
  name it — and `pub` took a class, a struct, a trait, a def, a macro and an
  enum, but not an `abstract` anything. A bound abstract class is a type a
  consumer subclasses and therefore has to be able to write; without this the
  declaration came back as a plain `pub class` and the requirement inside it
  was refused with `can't define abstract def on non-abstract class`.

- **A chain of four bound shards builds and runs.** `bench/bind_chain.sh`
  installs kemal and the three shards under it, binds all four in dependency
  order, and builds a program against the boundaries that prints what the same
  program prints built against their source. Nothing smaller finds what it
  finds: one boundary cannot collide with another's synthesised names, cannot
  have an import edge to get wrong, and cannot be a *class* root standing
  beside module roots.

- **A class root is its own namespace, and needs no module header.** An
  artifact's declarations are wrapped in `module <path>`; for a class root that
  header camelcases to the class's own name, so the class arrived declared
  inside a module of the same name and every type under it gained a level —
  `Widget::Part` was `Widget::Widget::Part`, and a consumer told to number
  `Widget::Part` could not name it. iyi wraps a file in its module only when a
  header is there, so leaving it out puts the declarations where they belong,
  and a `ClassType` is a `ModuleType`, so everything that looks a module unit
  up by name still finds it.

  Two things held the same wrong premise elsewhere. The marker that says "this
  type came from an artifact" walked *into* the scope looking for the root's own
  name, so a class root and everything under it went unmarked. And
  `bound_names` prefixed another boundary's types with its module path, which
  rewrote `Carrier` to `Carrier::Carrier`; with the prefix empty the rewrite is
  a no-op, so the import edge is recorded where the name is **met** rather than
  where the text changed.

- **An artifact says which symbols its units define.** Four undefined symbols
  were four wrong answers to one question. An artifact defines **more than it
  declares** — its own units call methods Crystal owns, so `RouteHandler`'s
  unit calls `FilterHandler#next=` and `next=` is `HTTP::Handler`'s — and
  **less than its types suggest**, because `Reference::new` is instantiated per
  receiver and exists only where something reached it. Assuming the first left
  `Kemal::FilterHandler@Reference::new` undefined; assuming the second made it a
  duplicate symbol; compiling a private copy in the consumer put the definition
  where `_main` could not see it. A `Symbols` section carries the mangled names
  each unit defines and the consumer compiles everything else: a list is not a
  rule and does not have a wrong side.

- **A `~match` function is defined under the name that travelled.**
  `(Socket::IPAddress | Socket::UNIXAddress)` is a union in the producer and
  collapses to `Socket::Address+` in a consumer that knows those are all of
  `Socket::Address`'s subclasses — the same types, the same answer, a different
  symbol. The function is built from the type resolved here and named for the
  one the object code calls.

- **The type-id list is the import graph, so it cannot be filtered.** Two
  separate failures at kemal's scale came from one list being less than whole.

  A module's type id is its *metaclass's*: `Backtracer::Backtrace::Parser:Module`
  is how a module's metaclass prints. Carrying the instance and stopping there
  defined `…::Parser:type_id` for object code that wanted
  `…::Parser:Module:type_id`, because the walk that numbers metaclasses reaches
  only classes. The consumer numbers the metaclass too now.

  And the list had been filtered to the kinds a consumer could not number for
  itself, leaving plain classes out on the reasoning that the consumer has them
  already. It has them only if it *imports the module that declares them* — and
  that import edge is derived from this very list. `Kemal` numbers
  `ExceptionPage::Styles`, the name was filtered, no edge was added, and the
  consumer never read `exception_page` at all. Whole, the list costs `Kemal`
  642 names where it carried 303, and a name is a string.

  The metaclass half takes the kemal consumer from eight undefined symbols to
  six. The import-edge half is not counted the same way: with the edge added,
  `ExceptionPage::Styles` stops being a mangled symbol at link time and becomes
  a refusal that names it, which arrives *before* the linker — so the five
  behind it are no longer measured. Both the refusal and
  `exception_page` filling with 0 units are the same item: a class-rooted
  namespace colliding with its own module wrapper, in Part V item 12.

- **What a generic declares is kept, even though the generic is not.** The keep
  file skips a generic type — rightly, since `uninitialized Holder(T)` is not a
  thing anybody can write — and skipped everything it declares along with it.
  Those have object-code units in the artifact all the same: `Radix::Tree(T)`
  holds two error classes carrying 1.3 MB each, radix's keep file was **empty**,
  and the only `to_s` symbols it emitted were the ones radix's own code
  happened to reach — `to_s<IO::Memory>`, `to_s<IO::FileDescriptor>` — while
  the boundary declared `io : IO` and a consumer asked for the declared
  `to_s<IO+>`.

  A nested type is not parameterised by its container unless it says so, so
  recursing past the generic is all it took. The kemal consumer goes from ten
  undefined symbols to eight, and `bench/bind_roundtrip.sh` carries a
  non-generic class inside a generic one and prints the symbol its declaration
  produced.

- **A variable can be read wider than the slot that holds it, and that is a
  widening.** Inside a dispatch arm the slot holds the arm's concrete type
  while the read wants the type the boundary declared — an `IO` parameter read
  as `IO+` — and `visit(Var)` called `downcast` on it:
  `BUG: trying to downcast IO+ <- IO::Memory`. It is the same correction the
  call arguments already carried, one level in.

  **Which direction it is cannot be asked of `implements?`.** Answering it that
  way broke the compiler's own build: a virtual type implements its base, so
  `Iyi::Def+` held in a slot and read as `Iyi::Def` looked like a widening and
  is the opposite. What separates them is shape — a union or a virtual type is
  the wider thing — so a widening is reading a *concrete* slot as one of those,
  and nothing else is.

  With it the kemal consumer reaches the linker rather than aborting in
  codegen. An earlier entry said that consumer had zero undefined symbols; that
  was not a measurement — the build was dying before the linker ran. It links
  now and waits on ten.

- **Inheritance crosses a boundary.** `TypeDecl` had no field for the `<`, so a
  bound `Derived < Base` arrived without its base and without the fields it
  inherits — a class's own field list is only its own — and the consumer said
  `undefined method 'tag' for Shard::Derived`. The edge travels now, and the
  declarations are written superclass-first so `class Derived < Base` resolves.

  The edge alone left three more, each a place that had only ever seen a class
  with nothing under it. **A method is keyed on the type that defines it**: a
  boundary has one symbol per method where an ordinary build makes one per
  receiver, which is the mirror of the rule the parameter side already carries.
  That symbol is keyed on the class's **virtual form**, because a value of a
  class something inherits from is held as one — the symbol is
  `*Shard::Base+@Shard::Base#tag`. And a class with subclasses has a **second
  unit**, `Shard::Base+`, holding the methods reached through that form; the
  artifact was carrying neither it nor its callees.

  **The undefined symbol was the safe half of the bug.** A match against a
  virtual type compares an id against the *range* its subclasses occupy, and
  ids are assigned by walking that same tree — so a consumer missing an edge
  numbers the tree differently. Defining the function anyway would answer
  `is_a?` wrongly and link cleanly.

  Two more followed from more of a real shard crossing: a type read from a
  `.iyimod` is exempt from the "not initialized in all of the 'initialize'
  methods" check on the branch where the field's type does not include `Nil`,
  as it already was on the other; and a restriction can be virtual while the
  value is concrete — an `IO` parameter matched against `IO+` — which is
  answered with the range rather than a single type id.

  A consumer of kemal's four bound shards goes from **11 undefined symbols to
  10**, and the three the superclass edge was built for — `~match` against
  `HTTP::StaticFileHandler+` and two like it — are among the ones gone.
  `bench/bind_roundtrip.sh` carries a base, a subclass, an inherited method and
  an overridden one.

- **The unions a bound module matches against travel.** `is_a?` against a union
  or a virtual type compiles to `~match<T>`, a function that compares a type id
  against a *range* of the program's own numbering — so it lives in the main
  module, which does not travel, and it cannot be carried as code either: a
  copy compiled by the producer would compare the consumer's ids against the
  producer's numbers and answer wrongly with no symptom.

  A virtual one the consumer could already find for itself, by taking the
  virtual form of every class it numbers. A union it could not: no walk over a
  program arrives at `(Char | Iyi::Keyword | String | Nil)`, which is a type
  kemal's code formed and a consumer of kemal's never would. A `MatchTypes`
  section carries the names and the consumer builds each function with its own
  numbering, the same arrangement `TypeIds` already has. A consumer of kemal's
  four boundaries goes from **22 undefined symbols to 11**.

  `bench/bind_roundtrip.sh` matches against a union its consumer never forms,
  and prints the carried name so the line cannot quietly stop testing anything.

- **A module crosses a boundary, and what was inside it comes with it.**
  `crystal tool bind` recorded a module as a "nested namespace skipped" and
  carried nothing for it. Two failures at kemal's scale were the same failure:
  `Backtracer::Backtrace::Parser` is a module the object code *numbers* and a
  consumer could not name, and `Kemal::Exceptions::CustomException` and three
  like it had object-code units in the artifact — 1.8 MB each — with no
  declaration anywhere, because the walk stopped at `Exceptions` and everything
  under it went with it.

  A module travels as a declaration now, with its nested types, its methods and
  its class variables. Without `pub`: iyi's `pub` takes a def, a class, a
  struct, a trait and an enum, and what a namespace owes is that the things
  *inside* it can be named, each carrying its own visibility. A consumer of
  kemal's four boundaries goes from **40 undefined symbols to 22**, and
  `bench/bind_roundtrip.sh` keeps a nested module with a class and a
  module-level `def self.` in it.

- **A module's own class variables travel, and so do the type ids of modules.**
  Running kemal's four shards through boundaries in dependency order —
  `backtracer` → `radix` → `exception_page` → `kemal` — found both. A
  `TypeDecl` holds a type's class variables and a module is not a `TypeDecl`,
  so `module Backtracer; class_getter(configuration)` left
  `Backtracer::configuration` undefined at the end of a build that had every
  one of that shard's types and their class variables. `Exports` holds the
  module's own now.

  And type ids are handed out by walking `Object`'s subclasses, which reaches a
  class and neither an enum nor a module — `Backtracer::Backtrace::Parser` was
  numbered nowhere in a consumer that never mentions it. `TypeIds` carries
  those too, which turns the link error into the refusal that names the module
  and the type it cannot reach.

  `bench/bind_roundtrip.sh` keeps a class variable on the module root as well
  as on the class under it.

- **A bound shard can match a regex, which took two more holes than the
  constant did.** With the pattern crossing and the class variables crossing, a
  `--crystal` consumer of a shard that *matched* still ended on
  `undefined symbol: *Regex::PCRE2::current_jit_stack` and
  `Regex::MatchOptions:type_id`. Both read as the copy rule failing to bring a
  library method along, and both were something else — `nm` on the unit shows
  the accessor was copied.

  `@@current_jit_stack` is `@[ThreadLocal]`, and a thread-local global is read
  through a `noinline` function that hands back its address rather than
  directly, because LLVM would hoist the address out of the thread. That
  function is the main module's, and a main module does not travel. It is the
  third thing a class variable owes, after the global and the read function.

  `Regex::MatchOptions` is an enum, and "a program defines every type id" means
  every id it has *handed out*. Ids come from walking `Object`'s subclasses,
  which reaches a class and not an enum — an enum takes its id from the first
  code that asks, and a consumer that never mentions it never asks. `TypeIds`
  carries the enums a unit numbers, beside the generic instances it already
  carried, and the two are missing for opposite reasons: an instantiation does
  not exist until it is named, an enum exists and is unnumbered.

  `bench/bind_regex_identity.sh` matches with its patterns now instead of only
  naming them, so each shard's literal is checked against text the other one's
  would reject.

- **A class variable crosses a boundary, which nothing had ever carried.** A
  class variable is a global. The methods that read one travel as a module's
  machine code and refer to it by symbol, and the global itself is defined in
  the main module — the one part of a build that never travels. Nothing in the
  format mentioned class variables at all, so R-1's own claim was false for any
  module that had one, in iyi's own language: build a module with a
  `@@seen : Int32 = 0`, delete its source, build again from the artifact, and
  the link ends on `undefined symbol: App::Counter::Tally::seen`.
  `bench/samples_roundtrip.sh` is the gate for exactly that claim and passed,
  because none of the six samples has a class variable.

  `TypeDecl` carries the declaration now — name, resolved type, and the
  initialiser as written — the way `fields` already do, one level up. That is
  what a module's own needs, and a bound shard's too.

  It is not enough alone, and `@@cache : String? = nil` is the case that says
  so: a nil initialiser assigns nothing, so it is dropped before the artifact
  is written, and the consumer that read the declaration made no initialiser
  from it and emitted no global. So a `ClassVars` section carries the names a
  unit's object code refers to and the consumer defines each. That second
  channel is also all a class variable of *Crystal's* library needs — the
  consumer has the declaration already, having compiled the same library, and
  a bound shard calling `String#upcase` was left without
  `Unicode::upcase_ranges`.

  **The global is not the whole debt, and the consumer cannot work out the
  rest.** A class variable with a live initialiser is read through
  `~Owner::name:read`, a main-module function that initialises on first use;
  one without is read straight off the global. Which a unit emitted is the
  producer's fact, so the section carries a flag beside each name. Both guesses
  were tried and each breaks a different world: assume the direct form and a
  `--crystal` build leaves `~Exception::CallStack::skip:read` undefined, which
  `bench/bind_roundtrip.sh` caught; assume the lazy form and an iyi-prelude
  program dies on `BUG: __crystal_once is not defined`, because that prelude
  has no `__crystal_once` and nothing under it ever takes the branch.

  **The value is caught before the compiler rewrites it.** The initialiser
  travels as source, and the node a class variable holds is not that source by
  the time an artifact is written — `CleanupTransformer` has replaced it with
  the literal's expansion. `@@nums = [1, 2, 3]` reached the format as five
  statements over three temporaries, and the consumer said `read before
  assignment to local variable '__temp_2'`.

- **A regex literal's constant is named after the literal, and what it was made
  from crosses a boundary.** The compiler turns a regex literal into a
  program-level constant, and the name it invented was the order the literal
  was met in: `$Regex:0`. That name reaches the linker — a unit reading the
  constant refers to `~$Regex:0:const_read` — and encounter order is not an
  identity two programs share. A consumer of a bound shard failed on
  `undefined constant ::$Regex:0`, and the obvious fix, skipping such names,
  was worse than the bug: the producer's object code still referred to the
  mangled name, and whichever constant the consumer had numbered zero would
  have satisfied it. A different pattern, silently.

  The name is `$Regex:` and a digest of the pattern and the flags now, so it
  means the same thing in a program that never compiled this source, and two
  modules that wrote the same literal share one constant rather than defining
  two. `$` still keeps it out of reach of anything anybody can write.

  A digest cannot be read backwards, so the pattern travels too, in a
  `Regexes` section beside the names in `Constants` — it cannot go through the
  source channel, because `$` is not legal in a constant and `Exports` is
  parsed text. The consumer builds the constant with the same `Regex.new` call
  the expander builds for a literal met in source, and from there it is
  ordinary: typed when read, initialised where read.

  **The name is the load-bearing half, and the channel alone looks like it
  works.** With the channel in and encounter-order naming restored, two bound
  shards holding one literal each both wrote `$Regex:0`, and the second shard
  matched against the first one's pattern with nothing raised and exit 0.
  `bench/bind_regex_identity.sh` is the gate: it takes two boundaries, because
  one can be wrong about the name and still right about the pattern.

- **A real shard is installed, built against and asked for two pages every
  build.** `bench/shard_serves.sh` takes the README's headline example
  literally: `require "kemal"` in an `.iyi` file, built `--crystal`, serving.
  Nothing here checked it. The samples cannot — none of them requires a shard,
  which is the point of the example — and CI's tarball job builds a *synthetic*
  shard against `crystal/syntax_highlighter`, which proves the library ships
  whole and cannot prove that a real shard's macros parse, that its route
  blocks compile, or that the thing answers.

  It reaches the network, which no other gate here does, and the shard is
  pinned at 1.12.0 so it fetches one version rather than today's. Two routes,
  because a single static string would pass with the router never running; the
  second reads a URL parameter, so the answer is right only if the request
  reached the block the shard's macros defined.

- **A bound shard is built from its boundary, linked and run every build.**
  `bench/bind_roundtrip.sh` is `samples_roundtrip.sh`'s question asked of the
  other kind of artifact: object code that is a shard's, declarations that
  `crystal tool bind` wrote, and a `--crystal` consumer. It binds, fills the
  units, builds the same program both ways, runs both and compares.

  III.6 rule 1 names two failures for a boundary whose signatures are wrong —
  an undefined symbol, or a call returning something of another type — and
  `spec/compiler/bind_spec.cr` reaches neither, because it reads declarations
  back and never links. That was written down as a deliberate limit. Nothing
  covered it, and the first thing this gate did was fail:

  ```
  ld.lld: error: undefined symbol: *Shard::Part#wider:(String | Nil)
  ```

  **And it found the same question on the other side of the arrow.**
  `def discards(io : IO)` is monomorphised on what it is passed, so the keep
  file emitted `discards<IO>` and a consumer handing it `STDOUT` asked for
  `discards<IO::FileDescriptor>`. Both answers that suggest themselves are bad:
  instantiating for every concrete subtype is the whole-program work an
  artifact exists to avoid, and refusing such methods costs real surface —
  `JSON` has 10 of 180 declarations taking an `IO`, `YAML` 10 of 193, `URI` 7
  of 55, counting only `IO`.

- **A call to a declaration read from a `.iyimod` is keyed on the parameter as
  declared, not on what the call site passes.** One line of a consumer said
  which answer the gap above wanted: `part.discards(STDOUT)` failed to link and
  `part.discards(STDOUT.as(IO))` linked and ran. The symbol was callable the
  whole time; the call was reading past the declaration.

  Keying on the argument is right everywhere the body is present to be compiled
  once per argument type. A declaration from an artifact has no body and
  exactly one symbol, so the parameter as written is what the call is keyed on
  and the argument is widened to it — the conversion `.as(IO)` was performing by
  hand. Getting the direction backwards says so plainly:
  `BUG: trying to downcast IO+ <- IO::FileDescriptor`, which is `downcast`
  being handed a widening. Nothing is refused and nothing is instantiated per
  subtype.

- **`pub enum`, and an enum crosses a boundary.** iyi took an `enum` already —
  the language has one and the compiler makes the type — but `pub` did not, so a
  module could declare one and never hand it out. It does now, and
  `crystal tool bind` writes the enum's members with the integer they are
  numbered on, read from what the compiler assigned rather than renumbered: the
  object file a consumer links is what gave them their numbers. An earlier note
  said iyi had no `enum` at all, which came from grepping the prelude and was
  wrong about the language.

- **A private type travels as private.** `JSON::PullParser` holds an
  `Array(ObjectStackKind)` and its object code numbers
  `Pointer(ObjectStackKind)`, so a consumer has to *number* a type it must never
  be able to *write*. Declaring it without `pub` is exactly that, and R-2b keeps
  the name unreachable. Dropping such types was the first answer and only the
  linker said otherwise.

- **A rebuild of a type declaration carries all of it.** Pruning and renaming
  both reconstructed a `TypeDecl` and left `value` and `macros` behind, which is
  how an alias lost its right-hand side and, once enums arrived, how one lost
  its members.

- **`crystal tool bind` asks what the consumer of a bound shard can name, which
  is not what it had been asking.** `nameable?` decides every count this tool
  prints, and it asked what an *iyi-prelude* program could name — a program that
  cannot consume one of these artifacts at all, because the units number
  `Pointer(LibUnwind::Exception)` whatever the shard does. The consumer is a
  `--crystal` program, which has Crystal's library, and now the shard's requires
  besides. Read from where each type was written rather than from a list.

  The surface had been reading low throughout. Without binding anything first:
  `JSON` 168 → **181** signatures and 13 → **0** waiting, `YAML` 166 → **194**
  and 32 → **0**, `URI` 48 → **55** and 9 → **0**. `Kemal` goes from 27 types
  carrying 65 methods to **34 carrying 148**, and `Kemal::Route`,
  `RouteDefinition`, `FileUpload` and three more stop being refused for naming
  types their actual consumer would have.

  Two things had to follow. A top-level name of Crystal's is written `::Log`,
  because an artifact's declarations are rendered inside their own module and
  `Kemal::Log` is a constant that would shadow it. And a generic carries the
  types nested inside it, which is how `Kemal::LRUCache::Node(K, V)` went
  missing while `LRUCache` travelled.

- **A bound shard's requires travel, and so does a dependency that only its
  type ids show.** A unit numbers the types its own `require`s brought in —
  `Radix` reaches `Hash(String, HTTP::Cookie)` — and a consumer whose prelude is
  Crystal's still does not have every file of it, so `require "http/cookie"`
  goes in the artifact. Crystal's only: a require that resolved into somebody
  else's `lib` is another shard, and replaying it would have the consumer
  compile from source the thing an artifact exists to spare it.

  The other half is an import edge nobody could see. `Kemal` names no `Radix`
  type in any declaration and its object code refers to
  `Array(Radix::Node(...))`, so a consumer that imported `kemal` had never heard
  of `radix`. The build that fills the object code reads the boundaries beside
  it and adds the edge, because only that build knows the type ids — `tool bind`
  and this are different processes.

- **A generic type crosses a boundary.** Its methods exist once per
  instantiation and the instantiations belong to whoever writes them — a
  consumer that writes `Holder(Float64)` needs a method the producer never made
  — so what travels is the declaration with its type parameters and the
  *source* of its methods, in `MonoBodies`, which is the answer IV.2 already
  names and `crystal tool bind` was not using. `new` stays out: it is
  synthesized from `initialize`, so a consumer makes its own and a carried one
  would meet it at the linker.

  A generic travels even with no methods to carry, because a consumer may need
  only to *name* it: `Kemal` refers to `Array(Radix::Node(...))` and calls no
  `Node` method. `Radix` carries three types where it carried none.

  What a generic's methods must have is a written return type. The trick that
  rescues an ordinary method — instantiate it on purpose and read what comes
  back — has no single answer when the owner is generic, so 20 of `Radix`'s 33
  methods stay behind.

- **A harness for what a consumer pays for a shard** (`bench/bind_speed.py`),
  from its source and from its boundary, at three sizes. A boundary pays once
  compiling the shard is a real share of the build — near ten thousand lines
  here — and costs a little below that: 2,167 lines costs 2%, 10,087 saves 9%,
  29,767 saves 11%.

  It could not be asked of `Kemal`, which cannot be bound: its object code
  numbers `Array(Radix::Node(...))`, a generic instance from another shard, and
  a generic travels as bodies rather than declarations. What `tool bind` says
  about `Kemal` stands on its own — 254 public methods, 93.3% needing no human,
  31 units of object code.

- **A private constant is not handed out.** The keep file read
  `Kemal::FilterHandler::WILDCARD_PATHS` through a generated accessor, which is
  what the shard's own compiler refuses. It still travels in the artifact's
  initialiser, because *defining* one is not *reading* it and the object code
  refers to it either way.

- **A build that fills a boundary does not link.** The keep file is not a
  program anybody runs — it exists so codegen emits the methods a consumer will
  call — and what the boundary needs is the objects, not the executable they
  would have gone into. Forcing the whole of `IO`'s surface produces a program
  that will not link, on `Crystal::EventLoop::Polling` internals a demand-driven
  build never reaches, and the units are written after the link. `IO`'s artifact
  fills now — 18 units, 14.8 MB — where it had been empty.

- **Measured what the library would be worth as an artifact** (SPEC.md Part V
  item 12e). A generated module the shape of a library — 103,002 lines, 5,000
  exported methods, declarations at the 5% of the source that Crystal's own
  library has them at — reads back from its `.iyimod` in 0.11 s against 0.43 s
  from source, in 25 MB against 163 MB. The daemon, on the same term, is 0.47 s
  to 0.33 s and costs 200 MB rather than saving it.

  `crystal tool bind` already writes a `.iyimod` for a Crystal namespace:
  `JSON` crosses 90.3% of its public surface unaided, `YAML` 78.0%, `URI`
  58.1%. What the rest waits on is the core types — `String`, `Array`, `IO` —
  which are not a namespace and so have no root to point the tool at.

- **The ecosystem and R-1, together: `--crystal` and `.iyimod` now work in one
  build.** A module that requires `json` compiles once into an artifact, and a
  program that requires Kemal links against it without opening its source. The
  two features were each half of the thing anybody actually wants.

  Three things had to be answered, and they were the same question three times
  — *a name in the module's object code that only the consuming program can
  define*, which is the rule `TypeIds` was already in the format for.

  - The main module's helpers, `~match<IO+>` first. The consumer emits them
    with its own numbering rather than the artifact carrying them, because a
    match against a virtual type compares against a range of type ids and those
    numbers belong to the program. A carried copy would have compared the
    consumer's ids against the producer's range and answered wrongly with
    nothing to see.
  - The module's requires. A module that required `uri` and a consumer that did
    not left `URI::Error.class:type_id` undefined at link time. They travel now
    — the new `Requires` section, format v20 — and the consumer replays them.
  - The `!dbg` location, fixed below.

  There is one copy of the library in the result, which was measured rather
  than assumed: `STDOUT` and `PROGRAM_NAME` are the same object on both sides
  of the boundary, and the specs assert it.

  What it saves is small and is written down as such: on a twelve-module app
  the modules cost 0.16 s from source and nothing from artifacts, against
  3.1 s for Crystal's library, which every build still reads from source.

- **`iyi daemon`.** A single-threaded `iyi-daemon` is built and shipped beside
  `iyi`; `iyi daemon start` holds Crystal's library analysed between builds. It
  takes about 0.3 s off the front end of a `--crystal` build — 0.81 s to 0.47 s
  on a twelve-module app — and costs about 200 MB resident per prelude it holds.

  Name your shard in a `--prelude` file of your own and it is held too, which is
  the largest effect by some way: 1.28 s to 0.60 s on the same app with Kemal.
  What the daemon is good at is holding the program's *dependencies*, not the
  library underneath them.

  Not offered before because iyi's own prelude takes 0.03 s to analyse and
  there was nothing to hold. `--crystal` gave it something.

- **A `.iyimod` records which library it was built against**, and importing
  across the two is refused by name in both directions. This replaces the old
  refusal, which was blunter and aimed at the wrong thing: `--emit-iyimod` and
  `--use-iyimod` no longer need iyi's own prelude. What they need is for the
  module and the program to agree on which library they mean. Both worlds are
  compiled by the same compiler and mangle the same names, so a mixed program
  would link — on the names that happen to agree.

- **`samples/iyi/calc`: a language, in the language.** Three modules — a
  scanner, a parser and an evaluator — reading a program from standard input,
  written against iyi's own 8,299-line library and nothing else. Every other
  sample is a page long, and a language that has only been used for pages has
  not been used.

  It grew the prelude by exactly what it asked for, which is the rule the
  prelude grows by: `String#[]`, `String#[](start, count)`, `String#to_i` and
  `read_input`. Nothing else was missing. `/` was not added, and that is the
  interesting one: iyi has no floats, Crystal's `/` on integers returns a
  `Float64`, and a name that means two things is what III.1.7a settled against
  — so integer division stays `//` in both.

- **Files can be removed.** `File.delete` uses `unlinkat` on Linux,
  `unlink` on Darwin and `DeleteFileA` on Windows. wasm32-wasi refuses it:
  deleting a path needs a preopened directory capability the prelude does not
  have. `samples/iyi/files.iyi` now deletes what it creates.

- **`derive` runs once, where the type is declared.** `derive <macro>` in a
  class or struct body resolves through the exported macro table, expands while
  the declaring type is processed, and the methods it generates belong to that
  module and travel in its artifact. `samples/iyi/derive.iyi` is built from its
  artifacts with `std/derives` deleted every build, so a consumer never runs
  the macro. The macro is handed the declaration's name and fields, built for
  the purpose: passing the declaration itself put the `derive` node inside its
  own macro argument, and no build that touched an artifact terminated.

- **A derive can ask what a field's type implements.** Each field carries the
  type it was written as, so `field[:type] <= ToJSON` is answerable — including
  where the type, the trait and the impl all belong to another module and arrive
  from its artifact, which is the `Order` case SPEC.md II.4 designs. The type is
  read from the annotation, because an instance variable's type is settled by a
  later pass and there is nothing to ask yet when a derive runs; R-2 is what
  makes that enough.

  A derive reads the declarations above it, so `getter n : Int32` is a field.
  One written below is refused, naming the call and which way to move it, rather
  than generating a method over the fields it happened to see. And because
  handing over a type hands over every question a macro may ask a type,
  `all_subclasses`, `subclasses` and `includers` raise inside a derive: they
  answer with the whole program rather than with a declaration, which is the
  caching promise R-5 rests on. Outside a derive they are untouched.

- **`derive named, counted` runs both.** Each macro named on one derive line
  runs in turn, left to right, reading the same declaration. A name nothing
  exports is reported at that name rather than at the line.

- **A Windows binary links, and then does something different every run.**
  Windows was one of the seven targets whose emitted objects CI audits and one
  of the six that had never been run. Running it found the object is fine and
  everything after the linker is not.

  Getting it to start needed two things the object audit cannot see. An
  LLVM-emitted object carries no `/DEFAULTLIB` directives, which an
  MSVC-compiled one would, so nothing pulls in `kernel32` or a C runtime. And
  naming the libraries is not enough: the *static* CRT (`libcmt`) links just as
  cleanly and then exits `0xC0000005` before `main` runs, while the dynamic CRT
  (`msvcrt ucrt vcruntime`) starts correctly. That was found with a ladder of
  programs whose smallest rung is `module w1` — it faulted too, which ruled out
  the allocator, the write path and `ExitProcess` in one step.

  What it does at run time cannot be trusted, in three different ways. The same
  binary, twenty runs, nothing changed between them: it has printed the right
  answer, printed `ache\w` (a fragment of a path from elsewhere in memory) where
  the program prints `HELLO, IYI!`, printed `BEEP ` with the digits gone, and
  exited `0xC0000005`. The two wrong-output shapes are a case conversion and a
  number rendered into a string, which looked like a lead until a run
  access-violated: an intermittent AV on a four-line program is a wild write,
  not a formatting bug.

  The obvious theory is recorded as wrong so nobody spends the afternoon on it:
  `HeapAlloc` not clearing cannot be it on its own, because the POSIX path
  allocates atomically with plain `malloc`, which does not clear either, and
  macOS has never printed the wrong thing.

  So Windows is not a run target and the README does not say it is. CI keeps a
  twenty-run watch that always passes and prints the tally — right, wrong,
  crashed — because there is no property of running an iyi program there that
  currently holds twenty times out of twenty.

- **The Windows link command names the libraries it needs.** An LLVM-emitted
  object carries no `/DEFAULTLIB` directives the way an MSVC-compiled one does,
  so `--cross-compile` printed a `cl.exe` command that could not link the object
  it had just produced: seven unresolved externals, six of them `kernel32`. The
  prelude's Win32 blocks now carry `@[Link("kernel32")]` and the dynamic CRT,
  and CI links with the printed command rather than one written into the
  workflow, so the command a person is told to type is the command that is
  tested.

- **An iyi program is run on wasm32-wasi every build.** The module imports four
  `wasi_snapshot_preview1` functions and nothing else, and it linked and then
  trapped on `unreachable` before printing anything. wasi-libc's entry stub does
  not call `main`: clang renames a C `main` to `__main_argc_argv`, the stub
  calls that name, and a module defining only `main` leaves the stub's weak
  reference unbound and traps the first time it is called through. The prelude
  now defines the name the stub calls, and `hello.iyi` runs under wasmtime with
  the same bytes it prints natively.

  And the command printed for this target is now `cc --target=wasm32-wasi`
  rather than `wasm-ld ... -lc`, which linked a module with no entry that no
  host could start. Only the driver knows where its sysroot keeps `crt1.o`, so
  naming the driver is the only way to print a command that produces a program.
  CI runs that printed command with wasi-sdk's clang as the `cc` it names.

- **A Crystal namespace can be bound, built and called from an iyi program, in
  two commands.** `--emit-bind` on the keep file's own build puts the per-type
  units into the artifact, with the type ids and constants they refer to, using
  the collectors an iyi module's artifact has always used — and the consumer
  links what the artifact carries:

  ```
  crystal tool bind -e ABCGreeter --emit-bind mods shard.cr
  crystal build --iyi-keep ABCGreeter --emit-bind mods -o keepbin abc_greeter_keep.cr
  iyi build --crystal --use-iyimod mods -o app app.iyi
  ```

  No `nm` and no `objcopy`, where four printed steps had been and had never
  worked at the end. The object `--emit obj` makes is a whole program and
  carries Crystal's library with it; an ordinary build leaves one object per
  type and the ones a namespace owns carry no runtime at all.

  `--crystal` on the consumer is not decoration: the unit numbers
  `Pointer(LibUnwind::Exception)` whatever the shard does, because a `String#+`
  can raise. The artifact is marked `crystal_library: true` for the same reason,
  which it always was — it was written `false` on an argument about what a
  boundary stands between, and that argument does not survive looking at what
  the unit refers to.

  A constant crosses as the assignment that makes it, so the consumer builds it
  in its own program at the time III.5 says — which is what the unit needs,
  referring to `Store::TABLE` and defining nothing. `Store.word(1)` answers
  `one`, where the same call used to segfault on the first read. Its own
  constants only: a unit refers to Crystal's as well, and those belong to the
  library the consumer already has.

  What a boundary cannot carry is an enum, and `crystal tool bind` says so by
  name instead of calling it a namespace skipped whole. iyi has no `enum`, so
  nothing on the far side declares one: a signature naming an enum cannot cross
  and neither can a type holding one. It is what `JSON` waits on — it binds to
  19 units and 7.5 MB and then stops on `JSON::PullParser`'s `ObjectStackKind` —
  and it is a language feature rather than another thing about object files.

  One nested inside a type under the root crosses as well, written
  `Inner::X = ...` — which defines rather than reopens wherever the namespace
  exists, and the declarations rendered above it are what make it exist.

- **Lookaround, and the reason it was refused was wrong.** `Iyi::Rx` supports
  all four forms, `(?=)`, `(?!)`, `(?<=)` and `(?<!)`, nested to any depth. The
  engine's header and SPEC.md both said lookaround was the price of RE2's
  linear-time guarantee, on the premise that it needs a backtracker. It does
  not: a lookaround over a regular inner pattern is a regular property of a
  position, answered by a pre-pass costing one state set per character and
  nothing per position. RE2 omits it because of its one-pass DFA design, not
  because linear time forbids it. The guarantee is unchanged, and what it
  actually costs is the constructs that are not regular, backreferences,
  recursion, subroutine calls and conditionals. Lookbehind here is not
  length-limited the way pcre2's is, so it accepts patterns pcre2 rejects.
  SPEC.md III.10 and Appendix B #17 carry the correction with the earlier
  reading still in them.

  **A capturing group inside an assertion is refused, and that refusal is
  new.** The pre-pass answers whether an assertion holds at a position and
  never which text its inner pattern consumed, so the group cannot be set.
  Reporting an empty capture where pcre2 reports a real one is the quiet
  difference this engine exists to avoid, so it refuses at compile time with
  the position instead.

- **The escapes and the folding a pattern in this tree actually reaches for.**
  Named groups in all three spellings, `(?<name>)`, `(?'name')` and
  `(?P<name>)`, numbered alongside unnamed ones the way pcre2 numbers them,
  with name lookup on the match. `\p{...}` and `\P{...}` for L, Lu, Ll, N and
  M, braced or single-letter, inside a character class or out, with every other
  category refused by name rather than approximated. `\v` as pcre2's vertical
  whitespace class and `\V` as its complement. `\x{...}` at any digit count,
  refusing at the offending position for no digits, a missing brace, a value
  above U+10FFFF, or a surrogate, which pcre2 in UTF mode refuses too. And
  `(?i)` folds past ASCII now, through
  `Char#downcase(Unicode::CaseOptions::Fold)`, simple case folding, the same
  relation pcre2 uses.

  `spec/compiler/iyi/rx_spec.cr` holds all of it against pcre2 over one corpus,
  31 examples including exhaustive codepoint sweeps for the character classes.
  None of it cost a library: `bench/dependency_floor.sh` still exits 0.

  Three readings stay this engine's own, each narrow and each stated rather
  than left to be discovered. `\d` is any Unicode number where pcre2 under
  `UCP` means `\p{Nd}` exactly, because no public stdlib predicate answers Nd
  alone, which is also why `\p{Nd}` is refused rather than approximated. `ß`
  and `ẞ` do not match caselessly here, because `ẞ` full-folds to `"ss"` and
  chasing that one pair opens others, simple lowercase not being symmetric.
  And lookbehind follows the union law here where pcre2 does not: on `"a"` at
  byte 0, `(?<=(?:a|$))` searched from 0 reports byte 0, the same pattern
  anchored at 0 reports nothing, and the ungrouped `(?<=a|$)` is right, so the
  trigger is the wrapping group rather than the branch lengths.

### Found

- **`UInt32` is barely usable in iyi's own prelude, and its `==` is wrong.**
  `x = 99_u32; x == 99_u32` answers **false**. There is also no `<`, no `>`, no
  `to_i64` and no `to_u64` on `UInt32`. Found while checking the collector's
  header, where the `type_id` is a `u32`: the memory was provably correct, since
  the containing 64-bit word read back as 99, while a `UInt32` comparison
  against the literal said otherwise, which sent two checks chasing a defect
  that was not there. The collector reads that field as part of its 64-bit word
  and is unaffected, and the exercises now do the same and say why. This
  predates the collector work and wants a fix of its own rather than a
  correction buried in a GC stage.

### Fixed

- **A boundary whose root is a module was read as carrying nothing.**
  `bound_names` asks whether the program has a type by each name an artifact
  declares, and asked it bare. That is right when the root is a *class* —
  `-e ExceptionPage` declares `ExceptionPage` and the program has one — and
  wrong when the root is a *module*: `-e Radix` declares `Node`, `Tree` and
  `Result` at the artifact's own top level, and the program has no top-level
  `Node`. It has `Radix::Node`.

  So `radix.iyimod` read as **6 types, 0 this program can name** while sitting
  in the same directory as a `Kemal` that names `Radix::Tree` eight times, and
  every one of those signatures went on waiting for a boundary that was already
  carrying the type. Asked under the artifact's root as well, and recorded
  under it too because that is how the producer writes them.

  Measured on the real shard: **`Kemal` goes from 168 signatures and 12 waiting
  to 182 and 0.** Nothing it names is undeclared any more.

- **A method that takes a block is now called with one, and rule 1's residual
  reaches zero.** `infer_return` instantiates a method on purpose to read what
  it answers, and it did that with no block — so `JSON::Builder#string`, which
  has an overload taking a value and one taking a block, matched the first and
  answered `wrong number of arguments (given 0, expected 1)`. Its return type
  was then the last thing on the boundary standing on the shard's word, over a
  block the annotation had already described in full.

  Two pieces. The call gets a `Block` of the annotated shape — the same block
  the keep file has written as text since blocks first crossed, `{ |b0| nil }`
  or an `uninitialized` of the output where the output is not `Nil`. And it
  gets a `parent_visitor`, because a block's body is code and code is visited;
  a blockless call never needed one, and the compiler says so exactly:
  `Iyi::Call#parent_visitor cannot be nil`.

  **Crossing on a return nobody checked: URI 0 of 55, JSON 0 of 181, YAML 0 of
  194.** Blocks being instantiable moves the other half too — 64 return types
  read in `JSON` where the tool had refused, 81 in `YAML`.

  One of the two this closed was not the tool's fault and is worth saying so:
  `YAML::Any#to_json_object_key` names `JSON::Error` in its body, and the probe
  it was measured with required only `yaml`. The tool refused correctly and the
  input was short. `YAML` reads 194 signatures with both required, against 193
  with one.

- **A block-taking method crossed a bound boundary and could not link.**
  IV.1g settles what such a method does: its machine code is the caller's, so
  the producer emits each instantiation private to the unit that called it and
  no symbol for one leaves the artifact — and its body travels in `MonoBodies`
  instead, for the consumer to compile its own from the block it wrote. That
  paragraph says explicitly that the question is about a `def` and not about a
  type.

  `crystal tool bind` was answering it about a type. Only a *generic* type's
  methods carried their bodies, so an ordinary class's block-taking method
  crossed as a declaration with nothing behind it — a promise nothing could
  keep, and `undefined symbol: *Shard::Part#each<&Proc(Int32, Nil)>` at the end
  of a build with no other complaint.

  It carries the body wherever the method is written now. Both shapes round
  trip and both are in `bench/bind_roundtrip.sh`: one that `yield`s and one
  that captures its block as a `Proc`. The first guess was that only the
  yielding one broke, because `yield` is inlined; a captured block fails
  identically, so the rule is the block. The surface does not move — `JSON`
  180 signatures, `YAML` 193, `URI` 55, before and after.

- **What is left of III.6 rule 1 is counted where it is owed, and it is two
  methods rather than eighty.** The report counted every written return that
  could not be held against an answer: URI 27, JSON 13, YAML 39. Most of those
  methods do not cross at all — a parameter with no type, a block nobody
  annotated, a splat — and are already refused by name further down, so
  counting them as unchecked said the boundary was trusting things it had never
  carried.

  Counted over the signatures that actually travel: **URI 0 of 55, JSON 1 of
  180, YAML 1 of 193**, and the report names them with the whole reason rather
  than a reason cut to a column. `JSON::Builder#string` — the tool builds no
  block for the call it synthesises — and `YAML::Any#to_json_object_key`.

  An abstract def is not among them any more either. It has no body to
  instantiate and no symbol of its own: what a caller reaches is an
  implementation, and every implementation is an ordinary method this tool
  checks as itself. `YAML::Nodes::Node#kind` was being counted as a return
  standing on the shard's word when it is one carried by the methods
  underneath it.

- **`bench/bind_speed.py` said a shard reaching into another one cannot be
  bound, and that stopped being true two commits before anybody reread it.**
  The header gave `Kemal` numbering `Array(Radix::Node(...))` as the case and
  a generic travelling as bodies rather than declarations as the reason. Both
  halves have since been answered — a generic carries its declaration *and* its
  bodies, and the build that fills a boundary reads the boundaries beside it and
  adds the import edge — and the paragraph went on asserting the old state.

  Corrected by measuring rather than by reasoning, and without the network: a
  two-shard tree of exactly that shape — a generic `Node(T)` in one, a second
  whose object code numbers `Array(Node(String))` and whose declarations name
  no `Node` — binds, links, runs, and prints what the source arm prints. The
  order matters and the header now says so: the reached-into shard is bound
  first and named with `--use-iyimod`, because only a build that sees that
  boundary can add the edge. Without it the consumer stops at import with
  `"kemal" numbers Array(Radix::Node(String)), and this build cannot name it`.

  SPEC.md III.6 already recorded the correction and needed nothing; it also
  names what real `Kemal` still waits on, which is three types belonging to
  other shards. The stale sentence carried a stale number besides — it called
  the smallest sweep 1,627 lines where the bench prints 2,167.

- **`crystal tool bind` holds a written return type against what a caller is
  actually handed, and the two are not always the same.** III.6 rule 1 says the
  binding asserts and is not checked. Half of it already was: a method whose
  return type nobody wrote is instantiated on purpose and the answer read. The
  other half — a method that *writes* its return type — was copied out verbatim
  and held against nothing, on the premise that what Crystal was told is what
  Crystal does.

  It is not. Crystal narrows a return restriction to what the body produced, so
  `def wider : String?` returning a `String` types its call **`String`**, and a
  consumer told `String?` holds a union where the object code answers a bare
  pointer. That is rule 1's "a call that returns something of another type",
  reached without anybody writing a wrong signature.

  Five in Crystal's own library, and each is a different shape: `JSON::Any#size`
  and `YAML::Any#size` say `Int`, which is a family head and not a type anything
  can hold; `JSON::Lexer.new` says the abstract base where the factory hands
  back `StringBased` and `IOBased`; `YAML::Schema::Core.parse_scalar` declares a
  union carrying `Slice(UInt8)`, which it never produces. The report names them
  and counts what is left: URI **40 agree, 0 disagree, 27 could not be checked**,
  JSON 119/3/13, YAML 111/2/40. Where the two disagree the artifact carries the
  **answer**, because the symbol is named after the answer and not after the
  restriction — see the round trip below, which is what settled that.

  **The first version of this check read the method's body rather than its call,
  and it was wrong in the direction that matters.** `def discards(io : IO) : Nil`
  has a body producing an `IO` and a caller receiving `Nil`, because `: Nil`
  discards; reading the body reported three defects in `URI` alone that were not
  there. The question a boundary asks is what a *caller* is handed, and the spec
  now pins the `: Nil` case for that reason.

- **A return type is asked whether a variable could hold it, which only the
  parameters were being asked.** `Int` is the head of a family on either side of
  the arrow: a method answering one has a symbol per member exactly as a method
  taking one does, and the generated keep file cannot compile either. `storable`
  looked at the arguments alone, so `JSON::Any#size : Int` was counted as a
  signature that crosses. JSON goes **181 → 180** and YAML **194 → 193**; URI is
  unchanged at 55.

- **`bench/build_speed.py` has not built anything since the identity cutover,
  and it is the gate for the one claim this project is built around.** It asks
  a wrapper where this checkout's sources are, and `f55ba16cb` renamed the
  variables it asks for to `IYI_*` while leaving it asking `bin/crystal`. The
  two command surfaces answer in their own vocabularies by design, so
  `crystal env IYI_PATH` is not an error — it prints an empty line and exits 0.

  The bench checked the exit status, got 0, and passed the compiler an
  environment with no search path in it at all. Every build then failed with
  `can't find file 'iyi/prelude'` and every row of the table printed a dash.
  It does exit non-zero, so it was never *silently* wrong; it was simply not
  being run.

  Two changes, and the second is the one that matters. It asks `bin/iyi`, which
  is the surface that knows those names. And it checks the **answer** rather
  than the status, because an exit code cannot see an empty string — a bench
  that cannot find the path now says which one it wanted.

- **`bench/incremental.py` was broken the same way, and it is the harness
  behind the number on the front page of the README.** Same shape exactly: it
  asked `bin/crystal` for `IYI_PATH`, got an empty line and a 0, and every
  build in it failed with `can't find file 'iyi/prelude'`. Fixed the same way,
  and it exits non-zero too, so this was also not being run rather than being
  believed.

  Running: 30 modules, 300 types, 7,208 lines, editing one module's body —
  **iyi 0.07 s, `go build` 0.09 s, Crystal 0.76 s** on a release compiler. The
  same edit with no artifacts is 0.18 s, so R-1 is worth 0.11 s of it.

  Worth putting beside the other bench rather than apart from it. `medium.iyi`
  is 6,900 lines in **one file** — no modules, no artifacts, nothing to cache —
  and there iyi is 0.13 s against Go's 0.02 s. iyi loses on a monolith and wins
  on a project, and SPEC.md's 0.1.0 section said only the first half because
  only the first bench could run.

- **The same bench withheld iyi's own figures at scale whenever Go was
  absent.** The 300-type pair is timed only after both halves are built and run
  against each other, which is right for the comparison and wrong for
  everything else: on a machine with no Go the whole block was dropped, and
  that block is the size SPEC.md's scale question is about. "The pair disagreed"
  and "there is no Go here" are now different answers. The first still drops the
  rows; the second prints iyi's and marks the Go column as not measured.

  With them back: at 6,912 lines, front end 0.05 s, end to end 0.39 s cold and
  **0.13 s warm** on a release compiler.

- **`gsub` copied the tail twice on an empty match at the end of the subject.**
  `Iyi::Rx.gsub("abc", /$/, "<>")` answered `"abc<>abc"`. An empty match at the
  very end left the cursor behind it, so the text between the cursor and the
  end was appended a second time with the tail. `/$/` over `"abc"` is the
  smallest case and reaches it with no lookaround in sight, so this was already
  wrong before any of the above.

- **`crystal tool bind` says why a bound shard cannot be linked into a program
  that has Crystal's runtime either.** A consumer built with `--crystal` is the
  program that *has* the runtime the shard's initialisation was missing, so it
  ought to be the answer; instead the link fails on `Crystal::Hasher::seed`,
  `Thread::threads`, `Fiber::fibers` and every other runtime global, defined
  once by each side. The object this pipeline makes is a whole program — a keep
  file is compiled like one — so it carries the library with it, and a program
  can have that library once. Without it the shard's state never starts; with
  it, nothing links. The names were not the problem and neither were the
  constants: the packaging was.

- **A harness for what the daemon takes off a whole build**
  (`bench/daemon_full_build.py`), which SPEC.md IV.1d had said was too noisy to
  publish. Twelve modules under `--crystal` with codegen and a link, eight
  alternating pairs, a module edited before every build, and it refuses to run
  on an unoptimised binary — the three corrections IV.1d had to make, built in
  so they cannot be forgotten again. **0.63 s to 0.46 s, or 26%**, with two runs
  agreeing to a hundredth.

  What was called noise was largely the measurement: `/usr/bin/time`, whose
  negative elapsed times IV.1d records, is not installed on this machine. The
  app here is lighter than the one the published table was made from — its
  front end is 0.35 s against 0.81 s — so this is a new row rather than that
  row measured further.

- **The prelude cache key is checked by the compiler now, not by whoever
  remembers.** A cache key is a claim that everything not in it does not matter,
  and this one was written when the only thing reading it was prelude analysis;
  every switch added since had to be checked against it by hand, silently.
  `--use-iyimod` is what happened when somebody did not — accepted, ignored, and
  the build compiled every module from source without a word. Each of
  `Compiler`'s switches is now written down as one of three things: in the key,
  re-applied when a build adopts a preanalysed prelude, or reaching neither.
  Adding a property fails the build until it is given one of them.

  Two of the classifications are judgements rather than facts, and saying so is
  the point: `mcpu`, `mattr` and `mcmodel` reach codegen and not analysis, and
  `progress_tracker` and `stderr` are where output goes — `new_program` sets the
  first and the adopt path sets neither.

- **`crystal tool bind` asked a hand-written list what an iyi program can name,
  and the list was wrong in both directions.** It claimed `Void`, `UInt32` and
  `Float64` — which iyi's prelude never declares — and left out `Slice`, `Int`,
  `Tuple` and `NamedTuple`, which `Program#initialize` creates for every program
  before any prelude is read. Those four were most of what the boundary appeared
  to be waiting on, so the list invented the work it was being read to size.

  `Program#builtin_type_names` records those types where they are made, and the
  tool asks it. `JSON` crosses 152 → 168 signatures, `YAML` 158 → 166, `IO`
  157 → 270 with what it waits on falling 140 → 5. The percentages do not move
  and nothing that crossed stopped crossing. What is left of "the core" is `IO`
  — nearly done itself — and then `Time`, `Time::Span`, `Set`, `File::Info`.
  See SPEC.md Part V item 12e.

- **CI could not package the tarball, and the guard that stopped it was right.**
  `iyi-tarball` carries `release := 1` and make applies that to what it builds
  for that goal — so the workflow naming `iyi` first built an ordinary one, and
  the tarball found it up to date by file times and refused. That refusal is
  exactly what `check_iyi_is_release` was added for; what was missing was the
  workflow catching up with it. It asks for `iyi-tarball` alone now.

- **The four steps `crystal tool bind` prints are taken by a spec now**
  (`spec/compiler-cli/bind-pipeline_spec.cr`): bind a shard, compile its keep
  file to an object, read the symbols, globalise them, and build an iyi program
  that links against it — then run the program and read what it printed. Three
  of the four steps were wrong when they were first run by hand, and each was
  invisible until something later failed, the later thing being `ld`. It skips
  itself where binutils is missing, or where `crystal` and `iyi` were built from
  different commits, since an artifact is read only by the build that wrote it.

- **`crystal tool bind` says that a bound shard's run-time state does not
  cross.** Crystal runs a constant's initialiser from `__crystal_main` and
  compiles the reads unguarded; a consumer has its own `__crystal_main` and
  never calls the shard's, so the constant stays null and the first read
  segfaults. A folded constant is fine — `LIMIT = 10` reads 10 — and one built
  at run time is not.

  Calling the shard's `__crystal_main` does not fix it, which was tried:
  renamed out of the way with `objcopy --redefine-sym` and called from the
  consumer, it segfaults *inside* the initialisation, before reaching any
  constant. Crystal's top level expects Crystal's runtime — a thread, an event
  loop, the exception machinery — and an iyi program is not one. So a boundary
  carries code that needs no initialisation, and that is the bound on it today.

  An earlier draft of this entry said the failure was silent — "no error at any
  step, the program answers wrongly". That was a measurement mistake: the exit
  status being read was a `printf`'s rather than the program's. It segfaults.

- **A method has as many symbols as it has ways of being called, and the keep
  file named one.** The mangled name carries the types at the *call site*, not
  the types in the declaration: `JSON.parse(input : String | IO)` is one
  declaration and three symbols, and the file named only the one where the
  argument is the declared union. Every consumer that passed a plain string
  linked against nothing. It emits the product of the parameters' shapes now,
  which measures smaller than it sounds — a union parameter is about one in
  twenty, 7 of `IO`'s 103 and 1 of `JSON`'s 53 — with a cap that reports itself
  rather than expanding without limit.

- **A `def self.` module function crossed under the wrong symbol.** A module
  written `extend self` puts its functions on the module and mangles
  `*Widget@Widget::polite<String>:String`; one written `def self.polite` puts
  them on the metaclass, which has no `@`. Both were recorded as the first, so
  every `def self.` in a shard produced a declaration the consumer called by a
  name nothing emitted — and Crystal's own library is written the second way
  throughout. The receiver is recorded now, which the artifact's format already
  had a field for and the type path already used.

- **A bound shard's module path is `camelcase` run backwards, and using
  `String#underscore` for it broke every acronym.** `underscore` answers `json`
  for `JSON`, and `json` camelcases back to `Json` — so the producer emitted
  `*JSON@JSON::...` while the consumer asked for `*Json@Json::...`, and `ld` was
  the only thing that ever said so. `camelcase` starts a group at every
  upper-case letter, so the inverse of `JSON` is `j_s_o_n`, which is a legal iyi
  path and comes back whole; `HTTPServer` is `h_t_t_p_server`, which
  `underscore` had flattened to `http_server` and lost. A shard named `ABC`
  links and runs.

  This corrects what the previous release notes said. They claimed `JSON`,
  `YAML`, `URI` and `HTTP` were outside the mapping's image and that the
  library-as-artifact thesis waited on a question about iyi's module paths.
  There was no such question: the mistake was reasoning about `underscore`'s
  image rather than `camelcase`'s.

- **`crystal tool bind` says when a root's name cannot survive the trip.** What
  actually falls outside is a name the grammar cannot spell — `Foo_Bar` needs
  two underscores running and `camelcase` reads two as one, so it comes back
  `FooBar`. Both sides mangle alike, so such a root produces an object file
  whose symbols no consumer will ever ask for, and `ld` is four steps too late
  to hear it.

- **A bound shard's iyi module name was the root downcased, and the symbol is
  what that broke.** Both sides mangle alike, so `Greeter.polite` is
  `*Greeter@Greeter::polite<String>:String` compiled from either language — but
  only if the consumer's module *is* `Greeter`, and a consumer builds that name
  by camelcasing the path it imported. `MyGreeter` became `mygreeter` became
  `Mygreeter`, which mangles to a symbol the shard's object file does not
  contain, and nothing said so until the linker did. The name is `underscore`d
  now, which is what `camelcase` inverts, with `::` as `/`.

  With it, a program built from a bound shard links and runs — the first time
  the four steps this tool prints have been taken end to end.

- **The pipeline `crystal tool bind` prints did not run.** A mangled name
  carries the types it was compiled for and a union prints with spaces in it —
  `*JSON::Any#as_a?:(Array(JSON::Any) | Nil)` — so the unquoted `$(...)` in the
  `objcopy` line split 50 of `JSON`'s 301 symbols into fragments and objcopy
  answered with its usage. It is an `xargs -0` now, and the four lines run as
  printed.

- **A boundary can now name another boundary's type, which is what `IO` was
  for.** `JSON`, `YAML` and `URI` all take an `IO`, so binding them is worth
  nothing unless the artifact can say so. The producer calls the type `IO`; a
  consumer that imported it calls it `Io::IO`, and an artifact that wrote the
  first resolved to nothing. Names from the boundaries passed in `--use-iyimod`
  are written the way the consumer will see them, and the modules they came from
  travel as the artifact's `imports`, so `import json` alone is enough — the
  consumer does not have to work out that it needs `import io` as well.

- **A field's type crossed as `IO+`.** That is how a virtual type prints — a
  fact about this build's dispatch rather than a name anybody can write — and a
  field declared `IO+` is one no consumer can read back. `infer_return` had
  devirtualised its answers since it was written; the field walk never did.

- **A bound namespace's artifact named types the consumer could not resolve, and
  nothing had ever tried to read one back.** The tool had no spec at all: every
  check it carried was a number it printed, and a number cannot say whether
  anything can consume the artifact printed beside it. `spec/compiler/bind_spec.cr`
  is that check, and it failed the first time it ran.

  An artifact's module name is the root downcased, and a consumer builds a type
  back out of it by camelcasing — a mapping iyi keeps reversible on purpose
  (SPEC.md IV.6 #6), so `MyLib` returns as `Mylib` and `JSON` is not in its image
  at all. Meanwhile the declarations inside still said `MyLib::Entry`. A class
  root never showed it, because its own name is a declaration in the file and
  `MySink::Entry` resolves against that wherever the module lands. The producer's
  prefix comes off a module root's declarations now, which is the same property
  said directly: what an artifact declares belongs to the artifact.

- **`crystal tool bind` exported methods that take a block nobody annotated.**
  A block-taking method is compiled per block *type*, so one whose block has no
  written type has no single symbol to declare. `infer_return` refused these
  already — but only when it ran, and a method that writes its own return type
  never reaches it. No count showed it; `Time`'s generated keep file did, by
  refusing to compile with *`Time.measure` is expected to be invoked with a
  block*. They are refused and reported on their own line now.

- **`crystal tool bind` can be pointed at the boundaries already written.**
  `--use-iyimod DIR` — the same switch a build uses — reads the `.iyimod` files
  there, and a signature naming one of their types is no longer waiting on
  anybody. Each name is checked against the program rather than trusted, since a
  class root's declarations are absolute and a module root's are relative to a
  name the file does not record; what is dropped is counted and printed.

  It is what closes the question item 12e opened. With `IO`, `Time` and
  `SemanticVersion` bound, `JSON` crosses 168 → 181 signatures, `YAML`
  166 → 192 and `URI` 48 → 55 — the exact gains the unlock report predicts, and
  it predicts them by a different route, which is the two checking each other.

  The counts also stopped calling a free variable a type. `T`, `self` and a
  block returning `_` are not types anybody can declare, and counting them
  beside `IO` said there was more waiting than there was; they have their own
  line now. What is left: `JSON` and `URI` wait on **nothing** anybody could
  declare, and `YAML` waits on `Set` alone — which is generic, so it travels as
  bodies rather than declarations and belongs to a different piece of work.

- **`crystal tool bind`'s keep file never descended into nested types.** A
  nested type travelled as a declaration while its methods were named by
  nobody, so the artifact promised symbols the object file did not carry — a
  link error rather than a compile one, and invisible until something linked.
  `JSON`'s artifact holds 16 types and the keep file reached 9 of them, leaving
  16 methods on the other 7 unemitted. The walk recurses now, and the counts
  printed beside the artifact are counted through the nesting too, having read
  as top-level-only for the same reason.

- **`crystal tool bind` generated a keep file that could not compile when
  pointed at a core type.** A shard's root is a module — `Kemal`, `JSON` — and
  the tool assumed one everywhere: it reopened the root as `module IO`, which is
  a class, and called `IO.write`, which is an instance method. A class root's
  own surface and its constants now stay behind and are reported by name and
  count, rather than being declared with no symbol to link against. What travels
  is the types under it, which is enough to make `crystal tool bind -e IO`
  produce an artifact and an object file end to end.

  It carries the root itself now. A module's own methods are module functions
  and a class's are its type's, so a class root travels as one declaration
  holding everything under it — `IO` with `IO::Memory` and twelve more inside:
  14 types, 148 methods, 311 symbols. Its constants still stay behind.

- **`crystal tool bind` declared private types.** `IO::Encoder` is private, and
  an artifact naming it names a constant the consumer is not allowed to write.
  Method visibility was already checked; the type's was not. The generated keep
  file is what found it, being the first thing outside the shard to say the name
  out loud.

- **`crystal tool bind` counted a signature as crossing when a variable could
  not hold its parameters.** A name being writable is not the same as a value
  being holdable: `Int` is the head of a family, and a method taking one is
  compiled once per member with a symbol apiece, so there is no single symbol
  to declare. `can_be_stored?` is the compiler's own answer and the tool asks
  it now, reporting those signatures on their own line rather than as types
  nobody has declared. It is what the counts above are corrected by — they
  read 182, 168 and 286 before it.

- **`crystal tool bind` read restrictions as text, and it flattered the core.**
  A method inside `JSON::Token` writes `kind : Kind`, which is
  `JSON::Token::Kind` — the shard's own type, already travelling — and the tool
  counted it as a type nobody had declared. `self` went the same way: a method
  returning `self` in `URI` returns `URI` and waits for nobody. Every such
  spelling pushed the "what this boundary is waiting on" list in one direction,
  *towards the core*, which is the claim that list was being used to support.

  Restrictions are resolved against the owning type now. The boundary the tool
  can already write grows by 33 signatures — `JSON` 142 → 152, `YAML` 142 → 158,
  `URI` 41 → 48 — and the percentages of surface needing no human do not move,
  because those measure a different thing and resolution does not touch it. Two
  `YAML` signatures returning a bare `Array` stopped crossing, which is a
  correction rather than a loss: a declaration that says `Array` without saying
  of what is not one a consumer can use.

  With the list true, `IO` is first for all three namespaces and by more than
  before — +13, +21, +8 — against 21 for everything generic. See SPEC.md Part V
  item 12e.

- **The tarball could be built from an unoptimised compiler, and was.** `build:`
  sets `release := 1`; `iyi-tarball` did not, and even asking would not have
  been enough — make rebuilds on file times, so a `.build/iyi` left over from an
  ordinary `make iyi` is newer than every source and gets packaged as it is.
  Nothing about the tarball would look wrong; every build every user ran would
  simply go through an unoptimised compiler. The target now asks the binary
  rather than the build: `--version` says which it is, and packaging refuses
  otherwise.

  This is also why the daemon numbers first published here were about three
  times too generous — they were measured with one of those binaries. See
  SPEC.md IV.1d for the corrected table and for the other two ways the
  measurement was wrong.

- **The tarball could not build a program that requires Kemal.** `install_iyi`
  cut `compiler/` from the copy of Crystal's library it ships, and the standard
  library requires it: `crystal/syntax_highlighter` requires
  `compiler/crystal/syntax`, the exception page requires the highlighter, and
  Kemal requires the exception page. README's headline example did not work in
  the thing people download, and 0.2.0 shipped that way. CI now builds a shard
  out of the unpacked tarball.

- **The build daemon died after serving one build from another directory**, and
  could not find `lib` in the client's project. Three bugs, all older than this
  release and all the same fact forgotten — the daemon runs in its own
  directory and the client does not. The third was that `CrystalPath` is a
  struct, so fixing the second through a getter mutated a copy and changed
  nothing. Every existing daemon spec passed through all three, because each
  passes an absolute path and starts the daemon where the runner is.

- **A build that adopted a preanalysed prelude ignored `--use-iyimod`.** That
  path never runs `new_program`, so a build's switches were whoever analysed
  the prelude's — none. The flags, the target and the prelude are in the
  analysis's cache key and so are safe; `--use-iyimod` is not, and was accepted
  and silently ignored while every module was compiled from source.

- **A constant an artifact reads carries a location.** The reads a consumer
  performs on an artifact's behalf were synthesised without one, and LLVM
  refuses a call with no location inside a function that has debug info. It
  never fired under iyi's own library and fired at once under Crystal's, which
  is where it was found — while looking at whether artifacts and `--crystal`
  can be used together. They now can; this was the first of the three things in
  the way.

### Changed

- **A module path is read from the root, not from where it is written.** A
  module called `samples/calc` importing `calc/lexer` resolved `Calc` to
  itself, then said the module was not imported: a true-looking sentence about
  the wrong thing. A module's path is its file's path (R-1), so it cannot mean
  something different depending on where it appears. Found by writing the
  sample above, which is called `calc`.

- **`Array#sort` is `sort_in_place`, and `sorted` is the copy.** A plain `sort`
  meant the opposite thing in the two libraries — it sorted the array under
  iyi's and returned a copy under Crystal's — with no error either way, which
  is the worst shape a difference can take. The plain verb is not in this
  library now, so the same call is an error under one and Crystal's meaning
  under the other.

  Measured before deciding: of everything iyi's library mutates — `<<`, `[]=`,
  `concat`, `shift`, `sort` — only `sort` disagreed, because Crystal writes `!`
  on the mutating member of a *pair* and plainly for the rest. One method
  today, and the shape every future pair would have had. SPEC.md III.1.7a has
  the three options that were on the table.

  The error teaches the rule: a missing name whose participle exists says so,
  which the suggestion machinery could not — `sort` to `sorted` is two edits.

- **iyi answers as iyi.** `iyi tool` printed `Usage: crystal tool`, and it was
  the shape of the bug rather than the string that mattered: the banner was a
  constant interpolating the program name, and a constant is built before the
  entrypoint has said which of the two binaries this is. `clear_cache --help`
  printed the literal text `#{Command.program_name}` at a user, because its
  heredoc was quoted. `repl --help` printed nothing at all. `iyi foo` could
  never find `iyi-foo`: the git-style subcommand lookup was hardcoded to
  `crystal-`, so the extension point existed for one binary of the two.

  Underneath, the compiler carries its own name: `Iyi` is the namespace,
  `src/compiler/iyi` the source, `IYI_*` its nineteen settings, `~/.cache/iyi`
  the cache, `IyiPath` the thing that reads `IYI_PATH`. `bench/identity_floor.py`
  is the gate, and the number it reports went from 12,426 lines across 178
  paths to zero; every remaining mention of Crystal is listed there with the
  reason it genuinely means the other language.

  Nothing about the compatibility binary changed, and that is asserted rather
  than assumed: `crystal` still answers as `crystal`, still reads `CRYSTAL_PATH`
  and its siblings, and `require "compiler/crystal/syntax"` still resolves.
  Crystal's own standard library does that, and anything that used the compiler
  as a library may too. Where both names are set for one setting, iyi's wins.

  Two of the defects were only visible on Linux CI, and both were the same
  mistake: a local run that set `IYI_PATH` by hand, and a gate whose
  `git ls-files` exited 128 inside a container and so checked nothing.

Master is `0.3.0-dev`. Under the artifact rule 0.2.0 introduced, that means
every build of it interoperates with nothing but itself: a version between two
releases names no compiler, so it cannot be handed one released artifact and
told they match.

## 0.2.0 — 2026-08-20

**A program chooses its library.** 0.1.0 had iyi's own 1,184-line prelude, and
that was most of what stood between the language and anybody's real program.
It turned out not to be a library problem: a prelude is a library and the rules
are the language, so a program can keep one and change the other. `--crystal`
does, and there `require` means what it means in Crystal. Nine shards were
swept through it and a Kemal server written in iyi serves HTTP; how many of the
rest work is not something this release measured.

Two more entries take the rules further out — `pub` reaches a macro and a
constant — and closing each found the same hole underneath: a surface nobody
wrote and nobody could refuse.

Artifacts written by this release are read by every other build of it, on the
same target and under the same flags. A `-dev` version between two releases
names no compiler and interoperates with nothing but itself, which is the rule
below doing its job rather than an exception to it.

### Changed

- **The tarball carries Crystal's library, so `--crystal` works in what people
  download.** It shipped iyi's own 56 KB and nothing else, so the release's
  headline feature answered `require "json"` with "can't find file" outside a
  checkout. It ships both now — 13.4 MB to 14.9 MB — and CI runs a `--crystal`
  program out of the unpacked tarball, which is where this was found and where
  it would have been found again.

- **`make cli_spec` says once when the daemon and the compiler are different
  builds.** The daemon refuses a client built from another compiler, correctly
  — it holds an analysed prelude — but the spec saw that as nine failures, each
  printing two version strings, with the reason in none of them. It is easy to
  arrive at, too: the build commit comes from git HEAD while make compares file
  times, so a commit can leave two binaries disagreeing about a commit while
  agreeing about every line of code.

- **`iyi mod diff` says whether a change reaches a module's consumers.** The
  three hashes an artifact carries already answered it and nothing asked them.
  It compares two `.iyimod` files, says which of interface, implementation and
  source moved — with what each of the three means, because the middle one is
  the surprising one — and names the exports that came and went when the
  interface is what moved. `--exit-code` exits 1 in that case, which is
  `git diff`'s spelling and its reason: the answer is not a failure.

- **An iyi program is run on three targets every build, not one.** It compiled
  for nine and was tested on one, which is a weak thing to call portability.
  CI now cross-compiles `hello.iyi` for musl and for aarch64, links each with
  the target's own `cc` and `libgc` (the command `--cross-compile` prints)
  and runs them: in an Alpine container and under emulation. The check is that
  each prints what the same program printed on the machine that compiled it.

- **`bench/runtime.py` measures what the library costs at run time.** The two
  libraries are within noise where they do the same work; `Hash` is 5x ahead
  and does less; `String` is 3.62x behind with the collector off. The first
  reading said string building was twenty times faster, and it was the
  collector, so the bench reports both columns and the honest one is the
  second. A later run no longer shows the twenty; as they run, string
  building is within noise, and the collector is masking a slower builder.

- **iyi describes itself as its own language, compatible with Crystal.** "A
  language built for Developer & Agentic Experience, Portability, Performance,
  and Efficiency", and README says what stands behind each of the four and what
  does not: the edit loop and the artifact are built, portability means nine
  targets that compile and three that are run, the run-time measurement is new
  and says the two libraries are within noise where they do the same work, and
  the agentic claim is a mechanism rather than a result.

  Compatibility is stated as something checkable and in one direction: the same
  compiler builds `.cr` files, an iyi program can `require` a shard with
  `--crystal`, and a Crystal program cannot require an iyi module, because R-2's
  written types and R-3's closed types are what an artifact is made of.

  `iyi version` reads `iyi 0.2.0-dev (built on Crystal 1.22.0-dev …)`: the
  language first and what it is built on after. The licence and NOTICE.md are
  unchanged, because Apache 2.0's attribution is an obligation rather than a
  description.

- **An artifact is read by the release that wrote it, not by the build.** A
  `.iyimod` was locked to the exact compiler build, commit and all, so two
  builds of the same version refused each other's modules and handing one to
  somebody meant handing them your compiler too. The identity is now the
  released version, the target and the flags. Every build of the same released
  version reads every other's artifacts on the same target under the same
  flags. A `-dev` version keeps the commit because it names no release. The
  version comes from `src/IYI_VERSION`, which is also what the binary reports
  and names the tarball.

- **A plain build using iyi's own prelude reaches no third-party library.**
  On macOS and Linux it needs no libgc and links only the platform libc. On
  macOS its undefined symbols are five libc calls (`write`, `exit`, `memset`,
  `malloc`, `realloc`), where 0.1.0's list was seven and four belonged to the
  allocator. On Linux the prelude now issues raw syscalls for `write`, `exit`
  and the allocator (`mmap`), so a Linux program's object asks libc for
  nothing at all. The linked executable still carries the five references its
  link template leaves, named below.

  The price is that the default does not collect. The prelude's allocator
  selection is inverted: a plain build binds `src/gc/none.cr`, which allocates
  over `malloc` and `realloc` and never frees. `-Dgc_boehm` opts back into real
  collection (`libgc.1.dylib` and the four `GC_*` symbols, exactly as before),
  and `-Dgc_none` still works and selects the default allocator. The flag used
  to be accepted and ignored because the prelude declared `@[Link("gc")]`
  directly. That was fixed first, then the default was flipped.

  The compiler lost `libiconv` (the Makefile passes `-Dwithout_iconv`) and
  `libpcre2`, and keeps `libgc`. `-Dgc_none` was tried on the compiler itself
  and is not viable: it emits invalid IR ("Load operand must be a pointer",
  from `LLVM::Module#verify`) on some runs and dies in `main_user_code` on
  others, being a long walk over ASTs with parallel codegen and fibers under
  an allocator that never frees. How pcre2 came off, and what it cost, is in
  the regex entry below.

  `bench/dependency_floor.sh` checks linked libraries beside symbols for a
  default build with iyi's own prelude and for `-Dgc_boehm`, and fails when
  either grows. It checks the compiler binary too, against an allowlist and a
  denylist that now carries `libpcre`. It does not build `--crystal`; that mode
  links Crystal's standard library and may pull every library a required shard
  pulls, so the zero-third-party-library claim and the floor gate do not apply
  to it.

  The gate reads a binary's own direct dependencies on both host platforms:
  `otool -L` load commands on macOS, and `readelf -d` NEEDED entries on Linux.
  `ldd` was on the Linux path and read the transitive closure instead, so
  libLLVM's dependencies counted as iyi's and the Linux compiler appeared to
  link libxml2, libz, libffi, libedit, icu, zstd, lzma, libbsd, libmd and
  libtinfo, while macOS showed none of it. The two platforms were measuring
  different claims, and the wide reading had no teeth: an allowlist holding
  libxml2 because libLLVM brings it can never catch iyi reaching for libxml2
  itself, which is the only case the denylist exists for. Proven both ways:
  rebuilding the compiler with an explicit `-lxml2` fails the gate by name,
  the same library inside libLLVM passes, and `otool -L` on `libLLVM.dylib`
  shows it beside libffi, libedit and libz. `linux-vdso.so.1` left the output
  without being allowed by anything: it was never a `DT_NEEDED` entry, the
  kernel maps it, and `ldd` was merely saying so.

  iyi is no longer Linux x86-64 only. One compiler cross-compiles for seven
  audited triples on four platforms: Linux x86_64 and aarch64, macOS x86_64
  and aarch64, Windows msvc and gnu, and wasm32-wasi. The own-prelude floor
  held on every one, measured with `llvm-nm --undefined-only` against the
  artifact each target actually emits (`.o` for ELF and Mach-O, `.obj` for
  Windows, `.wasm` for wasm32), two programs per triple. This is an emitted
  object audit, not a claim that the test suite runs on every target.

  At the object layer, Linux x86_64 and aarch64 leave no undefined symbols at
  all. macOS x86_64 and aarch64 leave `exit`, `malloc`, `memset`, `realloc` and
  `write`, all from libSystem. Windows msvc leaves `ExitProcess`,
  `GetProcessHeap`, `GetStdHandle`, `HeapAlloc`, `HeapReAlloc` and `WriteFile`,
  all from kernel32, and the gnu triple adds `main`. wasm32-wasi leaves
  `wasi_fd_write` and `wasi_proc_exit`, which are WASI imports. `malloc` and
  `realloc` are gone: the prelude binds `llvm.wasm.memory.grow.i32` as a
  two-argument `fun` and bump-allocates over grown pages. An earlier finding
  that Crystal could not reach `memory.grow` was an arity error, not an
  impossibility. The wasm linker globals (`memory_base`, `stack_pointer`,
  `table_base`, `indirect_function_table`) are linker plumbing, not
  dependencies.

  The linked executable is the other layer and it is not the same number. On
  Linux the program carries the five undefined references its C runtime
  objects leave behind, `__libc_start_main`, `__gmon_start__`,
  `__cxa_finalize` and the two weak `_ITM_` clone-table callbacks. They belong
  to the link template's `crt1.o`, `crti.o` and `crtbegin.o`, not the prelude.
  CI reported them on Linux, which is how this file learned that a claim
  measured on an object is not a claim about an executable. The gate allows
  those five by exact name, so `malloc` or `mmap` still fails: a wildcard would
  have been shorter, and "whatever the crt supplies" is not a measurable set,
  so it would also have hidden a prelude falling back to libc. The five were
  measured against the glibc in the container CI pins, and a different base
  contributes a different fixed set. Musl or an older glibc fails by name
  rather than passing, which is what a fixed-list check is for. On macOS the
  executable leaves the same five libSystem calls the object asked for. On
  both host platforms, an own-prelude program's dependency list is the
  platform libc and nothing else.

  The compiler binary links libLLVM, libc++, libgc and libSystem, and that is
  the whole direct list. `otool -L .build/iyi` prints those four;
  `.build/crystal`, the same compiler under its compatibility name, prints the
  same four. This is the compiler's own link line rather than everything that
  ends up mapped. What libLLVM pulls in beyond itself is LLVM's decision and
  the distribution's build. The floor is a property of what iyi builds rather
  than of what builds it, and the toolchain binary is now LLVM plus a collector
  plus the platform. SPEC.md III.9 records why the compiler keeps that
  collector, and III.10 records how pcre2 left.

- **Macro-level regex now runs on iyi's owned engine, with RE2 semantics.**
  `src/compiler/iyi/rx.cr` is differentially verified against pcre2
  (Appendix B #22). The price for a macro author is no in-pattern
  backreferences and no lookaround. A macro that uses one fails with a named
  error rather than meaning something else, and no pattern in a program or at
  compile time can take exponential time.

  `libpcre2` is off the compiler. `otool -L .build/iyi` lists libLLVM, libc++,
  libgc and libSystem, and `nm -u .build/iyi` leaves none of the thirteen
  `pcre2_*` symbols it used to. An earlier diagnosis blamed the leftover on
  the standard library prelude, assuming `require "regex"` emitted
  `@[Link("pcre2-8")]` even when nothing called it. That was wrong: an unused
  `@[Link]` does not put a library on the link line. The cause was ten reachable
  regex literals. `--emit llvm-ir` on the compiler shows ten expanded regex
  constants, `$Regex:0` through `$Regex:9`, whose patterns identify four
  standard library files the compiler compiles into itself.

  Those four now parse by hand, with no engine, and none calls `Crystal::Rx`,
  because the standard library does not reach into compiler internals:

  - `src/option_parser.cr`, seven literals in `parse_flag_definition`, reached
    from `compiler.cr`, `loader.cr` and most of `command/*`. A 20,633-case
    differential against the original seven regexes found 0 mismatches.
  - `src/process/shell.cr`, one literal in `Process.quote_posix`, reached
    because the compiler shells out to the linker. A 194,690-input
    differential covering every Unicode scalar to U+2FFFF found 0 mismatches,
    and 18 hostile arguments passed a live `/bin/sh` round trip.
  - `src/semantic_version.cr`, `VERSION_PATTERN`, reached from
    `macros/methods.cr` for `compare_versions`. `valid?` and `parse?` now share
    one scanner so they cannot drift. One existing asymmetry remains on
    purpose: `valid?("99999999999999999999999.1.1")` is true while `parse?`
    raises `ArgumentError` from `to_i`.
  - `src/spec/cli.cr`, two uses rather than one, reached because
    `command/spec.cr` requires `spec/cli` so `crystal spec --help` can print
    the runner's options. `--location` is one literal. `-e/--example` was
    `Regex.new(Regex.escape(pattern))`, which is substring matching written
    the long way.

  **`-e/--example` is a breaking change to a standard library public API.**
  `Spec::CLI#pattern` was `Regex?` and is now `String?`.
  `Spec::Item#matches_pattern?` and `filter_by_pattern` now take a `String`,
  with `=~` replaced by `includes?`. The behaviour is identical because
  `Regex.escape` had already reduced every pattern to a literal substring, but
  the type is not. Direct callers get a compile error rather than a
  deprecation.

  Two findings cost more to rediscover than the dependency. PCRE2 in this tree
  is compiled with `UCP`, so its `\s` is Unicode and `Char#whitespace?` is a
  different predicate. They agree on every character except U+0085 NEL, which
  `option_parser.cr` now names explicitly. The differential first reported
  1,114 mismatches, all containing U+0085. The same flag makes `\d` mean
  `\p{Nd}`, so `--location` used to accept a non-ASCII digit as a line number
  and deliberately no longer does. Second, in `/\A(.+?)\:(\d+)\Z/`, the lazy
  `(.+?)` reads as "shortest prefix" and is not one. `(\d+)\Z` has to reach
  the end and `:` is not a digit, so the engine backtracks until the last colon
  is the split. That makes `a:1:2` file `a:1`, line 2. A `split(':')`, or any
  leftmost scan, gets that wrong.

  The gate closed behind it. `libpcre2` came off
  `ALLOWED_LIBS_COMPILER` in `bench/dependency_floor.sh`, and `libpcre` went
  onto `FORBIDDEN`, so the compiler is held to the same denylist as
  own-prelude programs. Injecting a reachable regex literal back into
  `option_parser.cr` makes the gate exit non-zero at both layers, naming the
  gained library and the denylist hit. The first probe was discarded because
  it used an unused constant. Crystal does not instantiate an unreachable
  constant, so no library came back and that probe did not test the gate.

- **Appendix B #20 through #26 record the runtime decisions.** iyi writes its
  own garbage collector (#20), overruling the earlier plan to adopt gcry and
  pay it back in layouts. The owner's goal is control over concurrency,
  parallelism and performance, and owning the collector is the only path to
  it. gcry remains prior art: roughly 87% throughput at roughly 0.80x post-GC
  RSS against Boehm, with precise stack roots correctness-stable and not an RSS
  win. The bill is explicit: heap, stop-the-world, roots, finalizers and
  platforms are rebuilt in this tree. Until that collector serves parallel
  codegen, the compiler keeps bdw-gc (#24, superseded and restated).

  The default own-prelude build still allocates and never collects (#23), so a
  long-running program grows without bound. `-Dgc_boehm` is the opt-in.
  iyi's own prelude has no IO beyond `puts` and no concurrency. A
  `--crystal` program uses Crystal's standard library instead and is outside
  both that limitation and the own-prelude dependency floor.

### Added

- **`iyi build --crystal` compiles a program against Crystal's standard
  library, so `require` reaches the ecosystem.** A `.iyi` file refused
  `require` because there was nothing to require: the prelude is what a program
  gets. That reason stops being true when the prelude is Crystal's. The rules
  do not change with the library — the module header, `pub`, `import`, `using`,
  traits and `impl` are all still there, and a shard is ordinary Crystal
  compiled into the program.

  A Kemal server written this way serves HTTP. What it gives up is R-1 for that
  dependency: the shard is read from source, so the edit loop pays for it the
  way Crystal does. Your own modules are unaffected, and `--emit-iyimod` still
  writes them.

  `crystal tool bind` writes what it generates with `--emit-bind`, its own
  switch, because what it writes is a boundary for a shard rather than this
  build's own modules.

  The two libraries are two modes and do not mix on the artifact side:
  `--use-iyimod` and `--emit-iyimod` need iyi's own prelude. An artifact's
  object code numbers the types its module made, which under Crystal's library
  include the standard library's own, and a consumer compiling its own copy of
  that library has two of everything. That was an LLVM module which would not
  verify; it is a sentence now.

  **Nine shards were swept through it**, each built twice — as an iyi program
  and as a Crystal one, so that a difference is this fork's and a shared
  failure is the ecosystem's. `kemal`, `db`, `ameba`, `habitat`,
  `baked_file_system`, `radix`, `sqlite3`, the standard library's own
  `json`/`yaml`/`uri`/`http`, and a program that round-trips
  `JSON::Serializable` and writes a file. All nine behave the same in both
  languages. One needed a word changed and it was the rule working: `habitat`'s
  macro resolves the type it is handed by name, and a class an iyi module
  leaves unmarked is private, so it needs `pub class`.

  `samples/crystal/stdlib.iyi` is the program CI builds to keep this true: a
  trait with a default, an `impl` on a generic, an error union with `!` and
  `.or`, a `defer`, and JSON, YAML and URI in the same file.

- **`pub` takes a constant.** `pub LIMIT = 42` is reachable through the
  module's name; an unmarked constant is the module's own and is refused by the
  sentence an unmarked `def` gets. Nothing was added to the artifact format,
  because a module's top level already travels as source and the mark travels
  with it.

  The hole under it is the same one `pub macro` found: a constant's visibility
  was never set, so every constant a module declared was reachable. That is
  what a real shard leans on — Kemal hands out every object it has through one.

- **`pub macro`, so a macro can cross a module boundary.** Every macro a module
  writes already travelled in its artifact, because a body that travels may
  call one, but none of them was reachable: `pub` did not take a macro. A
  marked one is now reachable exactly as a `pub def` is, unqualified after
  `using` or through the module's name, and it works against an artifact with
  the module's source deleted. What it exports is a name and an arity, because
  a macro takes syntax and returns syntax.

  Two things worth knowing. Closing this found the hole under it: a macro's
  visibility was never set, so **every** module's macros were already callable
  through its name — that is refused now, with the sentence an unexported `def`
  gets. And macros are not hygienic, so a `pub macro` that writes `tmp = 99`
  assigns to the consumer's `tmp`; SPEC.md IV.4 says so in full.

- **`iyi tool format` formats iyi.** The formatter is Crystal's and knew none
  of iyi's syntax, so a module header, a `pub`, a `trait`, an `impl`, a
  `using`, a bounded `forall`, a `where`, a `defer`, a `!` or an `.or` sent it
  into "there's a bug formatting this file". It knows all of them now, and a
  directory is searched for `.iyi` files as well as `.cr` ones. The prelude and
  the nine samples format to themselves, which is the test that made the last
  three of those show up.

- **`iyi repl` brings the interpreter back on a smaller base** (Appendix B
  #25, reopening #11). It starts, reads a line, evaluates it on the 781-line
  macro interpreter, prints the result, and survives a bad line. Session
  variables persist across lines. Each line is a fresh parse unit, so a bare
  `x` is a Call until the REPL rewrites names it already holds into Vars. This
  is not the 11,377-line revert, which cannot run an iyi program past its
  module header.

  There is no C interop, so no libffi, and the own-prelude floor enforces that:
  libffi is on `bench/dependency_floor.sh`'s denylist. Adding to a sample the
  exact `@[Link("ffi")]` shape a naive revert would produce failed at three
  independent layers, reporting the gained symbol `ffi_prep_cif`, the gained
  library `libffi.8.dylib`, and the denylist hit.

- **wasm32 grows its own heap** (Appendix B #26). The own prelude binds
  `llvm.wasm.memory.grow.i32` as a two-argument `fun` (memory index, then page
  delta) and bump-allocates over the grown pages. `malloc` and `realloc` are
  gone from the emitted `.wasm`; the remaining undefined symbols are the WASI
  imports `wasi_fd_write` and `wasi_proc_exit`, plus linker globals. An earlier
  probe used the one-argument form, failed verification, and was misread as
  "Crystal cannot bind this intrinsic". The two-argument form lowers to
  `memory.grow 0`. Accepting wasi-libc as the platform runtime, or documenting
  wasm32 as a qualified target, were both rejected.

### Fixed

- **A generic imported from an artifact links again when its type argument is
  inferred.** `Box(Int32).new(42)` always worked and `Box.new(42)` did not.
  Inference makes `new` a method on `Box(T)`, which is the artifact's own type,
  and the rule that says "this type's machine code is in the artifact" was
  reading the generic itself. An artifact carries a unit for every non-generic
  type a module declares and none for a generic one, because a generic has
  machine code only once somebody picks its arguments, and the consumer is who
  picks them. So the consumer declared a `new` that nothing defined and the
  program failed to link, saying `undefined reference to Box(T)::new<Int32>`.
  The consumer's rule now matches the producer's. Reported after 0.1.0 went
  out.

- **`Array#sort` sorts the array, and `sorted` hands back a copy.** SPEC.md
  III.1.7(A) settled that pair — the plain verb mutates, the participle copies,
  Swift's convention adopted because `!` had to leave identifiers so postfix
  `!` could propagate an error — and the prelude did not implement it: `sort`
  returned a copy and nothing mutated. It does now, and `sorted` is one line
  over it.

  Worth knowing when moving between the two libraries: Crystal names the same
  pair `sort!` and `sort`, so `a.sort` copies there and sorts here. It is the
  one call in this prelude that means something different under `--crystal`,
  and the note is in `src/iyi/array.iyi` where somebody is standing when it
  matters.

- **A `using` that cannot deliver is refused where it is written.** A module
  header makes a type, and inside it that name means the module — so
  `using app/count::{Tally}` in a module called `tally` asks for a name it
  cannot have. What it said before was that `Tally` was not
  `App::Count::Tally`, at the first line that used one, with nothing pointing
  at the directive. Found by writing a command-line program.

- **`String#size` counts when nobody counted.** Crystal reads `@length == 0` on
  a non-empty string as "not counted yet" and scans; this prelude returned the
  field. A string built by Crystal's own `to_json` therefore printed correctly
  through iyi's `puts` and answered `size` **0** — no error, a wrong number.
  Free for every string this prelude makes, because it fills the field. Found
  while measuring what crosses between the two languages.

- **A macro that cannot see a type says why.** An unresolved path stays a
  `Path`, so every method a macro would call on the type is undefined on that,
  and the message named `Path` rather than the type or the rule:
  `undefined macro method 'Path#constant'`. It now asks whether the path names
  a type that exists and is unexported, and says so when it does. Found by
  `habitat`.

- **The front end reads a `.iyi` file again.** Refusing `require` in a `.iyi`
  file spares the prelude's own, and the flag that says so was set in the
  driver but not in `crystal-front`, so the front-end binary refused the line
  it had just written itself. It is bench-only and ships in nothing.

- **A version bump takes effect.** `src/VERSION` and `src/IYI_VERSION` are
  compiled in with `read_file`, and the build did not depend on them, so
  changing the number changed nothing until something else did.

## 0.1.0 — 2026-08-18

The first release. There is nothing to compare it against, so this says what is
in it rather than what changed, and what a later version will have to keep
faith with.

### The language

Four rules, and everything else follows from them (SPEC.md):

- **R-1** A module is the unit of compilation. `import` forms a DAG, and
  compiling a module reads its imports' declarations, never their bodies.
- **R-2** Everything a module exports (`pub`) writes down full parameter and
  return types.
- **R-2b** `using` brings exported names into unqualified scope, written by the
  consumer.
- **R-3** No open classes. `impl Trait for Type` lives in the module that
  declares the trait or the one that declares the type.

Traits with defaults and associated types, generic impls with `forall`, errors
as ordinary union members with `!` propagation, `defer` scoped to the block,
and Crystal's syntax otherwise: union types, nil-safety, blocks, local
inference, macros.

### The artifact

0.1.0 shipped `.iyimod` **format v19**: declarations, macros, bodies that have
to travel, object code, and a checksum per section. Its artifacts were locked
to the exact compiler build, so another build refused and rebuilt them rather
than migrating them. The 0.2.0 rule above replaces that build identity with
released version, target and flags, while development versions keep the commit.

`iyi build --emit-iyimod DIR` writes them, `--use-iyimod DIR` builds against
them, and `iyi mod dump` prints one as text.

### The tool

`iyi` takes `build`, `run`, `mod`, `env`, `clear_cache`, `tool`, `version` and
`help`. `crystal` is the same compiler under its own name, and it still
compiles `.cr` files. `eval` is deliberately not on iyi's list: it has no
filename, so it gets Crystal's prelude and Crystal's rules, and a command that
answers in another language is worse than one that says where it went.

### Measured

One machine, release compiler, best of seven, seconds. A 30-module,
7,208-line project, rebuilt after changing one line in one module:

| | iyi | Crystal | `go build` |
|---|---|---|---|
| rebuild after one edit | **0.13** | 1.17 | 0.16 |

The same edit with every module read from source instead of from artifacts
costs 0.23 s, which is what R-1 is worth on this project. A full build of a
6,900-line program from scratch is 0.24 s against `go build`'s 0.09 s, which is
where iyi loses. `python3 bench/incremental.py` and `python3
bench/build_speed.py` print both, and refuse to time programs that do not agree
on their output.

### Not in this release

iyi's own 0.1.0 prelude had no IO beyond `puts` and no concurrency; SPEC.md
III.4 specified concurrency and none was built. There was no package manager,
standard library or self-hosting, and the release supported Linux x86-64 only.
`derive` macros did not cross modules. The own prelude was 1,184 lines, its
collections were small, and `a[-1]` raised rather than indexing from the end.
The formatter did not know iyi's syntax: `iyi tool format` said so and left
`.iyi` files alone.

### Provenance

A fork of [Crystal](https://github.com/crystal-lang/crystal) at 1.22.0-dev,
Apache 2.0 with Swift exception, Copyright 2012-2026 Manas Technology
Solutions. The backend, the GC and the type checker are Crystal's work. The
compiler reports itself as `Crystal 1.22.0-dev` because that is what it is, and
it is bootstrapped by released Crystal 1.21.0, which is the version CI pins
and the one to install if you are building this from source.

Two bugs in Crystal's own compiler were found here and fixed in this fork; they
belong upstream and are separate commits for that reason:

- `Crystal.relative_filename` chopped the working directory off any path that
  merely began with its name, so a build in `/x/crystal` with a cache in
  `/x/crystal-cache` wrote its object files to `-cache/…`.
- The cache cleaner deleted the directory of a build that was still running,
  because it keeps the ten most recently modified directories and a build stops
  looking recent while its units sit in an optimization pass.
