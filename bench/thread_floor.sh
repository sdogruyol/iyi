#!/usr/bin/env bash
# Drives bench/thread_floor.iyi: what a kernel thread, and a stop-the-world
# over kernel threads, cost the dependency floor (SPEC.md III.9) — measured
# before the design that needs them (GC_DESIGN.md Stages 4, 7, 8, 9;
# SPEC.md III.4.7's `Share`) is written.
#
#     bash bench/thread_floor.sh
#
# Five steps, and the last two are failure proofs, because a gate that
# cannot fail is not a gate:
#
#   1. The program holds every property, plain and --release: N threads,
#      each with a tid of its own and a thread-local block of its own;
#      every one stopped where it ran by a signal and a handler, released
#      by one wake; every one joined; every `@[ThreadLocal]` slot still its
#      owner's at the end.
#   2. The binary keeps the floor. This is the measurement the file exists
#      for, and it is asserted, not printed. On Linux: the runtime's five
#      C-template names and nothing else — a thread by raw `clone` adds no
#      symbol, and a thread-local variable adds no `__tls_get_addr`. On
#      darwin, where III.9's rule is that every call is libSystem's: the
#      exact list below, which is the runtime's names plus what a thread
#      costs there, spelled out one by one.
#   3. The pause, by thread count, printed from real runs. Reported rather
#      than budgeted: a budget would be a number this script made up, and
#      the shape (how it scales past the core count) is the finding.
#   4. The ran-its-loop assertion is reachable: a thread that counts into
#      the wrong word exits 1 at that check's own name.
#   5. The thread-local assertion is reachable. On Linux, `clone` without
#      CLONE_SETTLS leaves every thread on the main thread's block. On
#      darwin dyld lays the block out and there is no bit to drop, so the
#      `@[ThreadLocal]` annotation itself is dropped instead: the slots
#      become one thread's class variables and clash. Either way the
#      program exits 1 naming the thread-local that was not.
#
# Linux x86_64 and aarch64, darwin aarch64.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
IYI="$REPO/bin/iyi"
WORK="$(mktemp -d)"

cd "$WORK" || exit 1

step() { echo "== $1"; }

case "$(uname -s)" in
  Linux) cores="$(nproc)" ;;
  Darwin) cores="$(sysctl -n hw.ncpu)" ;;
  *)
    echo "thread floor: measured on Linux and darwin; nothing to measure here"
    exit 0
    ;;
esac

# ── 1. The program, twice ─────────────────────────────────────────────────
step "thread floor, plain build"
if ! "$IYI" build "$REPO/bench/thread_floor.iyi" -o floor > build.log 2>&1; then
  cat build.log; exit 1
fi
if ! timeout 60 ./floor 4 100 > answers.txt 2>&1; then
  cat answers.txt; exit 1
fi
grep -q 'every property held' answers.txt || { cat answers.txt; exit 1; }

step "thread floor, release build"
if ! "$IYI" build --release "$REPO/bench/thread_floor.iyi" -o floor-release > build-release.log 2>&1; then
  cat build-release.log; exit 1
fi
if ! timeout 60 ./floor-release 4 100 > answers-release.txt 2>&1; then
  cat answers-release.txt; exit 1
fi
grep -q 'every property held' answers-release.txt || { cat answers-release.txt; exit 1; }

# ── 2. The floor ──────────────────────────────────────────────────────────
case "$(uname -s)" in
  Linux)
    # The same five names bench/concurrency_exercise.sh allows, for the
    # same reason: they are crt1.o's, not the program's. `clone`, `futex`,
    # `tgkill`, `rt_sigaction` and `gettid` are syscalls here and appear
    # as nothing.
    step "dependency floor: a thread without pthreads adds no symbol"
    for bin in floor floor-release; do
      added="$(nm -u "$bin" |
        sed -e 's/^ *[wU] *//' -e 's/@.*$//' |
        grep -v -E '^(_ITM_deregisterTMCloneTable|_ITM_registerTMCloneTable|__cxa_finalize|__gmon_start__|__libc_start_main)$' |
        grep -cv '^\s*$')"
      if [ "$added" -ne 0 ]; then
        echo "$bin put $added undefined symbols on the link line:"
        nm -u "$bin"
        exit 1
      fi
    done
    echo "  five template names and nothing else, plain and release"
    ;;
  Darwin)
    # The exact list, held the way bench/concurrency_exercise.sh holds the
    # exercise's. Twelve names are every darwin program's (the runtime's
    # list in bench/dependency_floor.sh). Eight are what a thread costs,
    # and each one is a dependency taken on by name:
    #   pthread_create, pthread_join, pthread_kill   the thread
    #   pthread_threadid_np                          its id, both views
    #   sigaction                                    the stop
    #   os_unfair_lock_lock, os_unfair_lock_unlock   the park
    #   __tlv_bootstrap                              a @[ThreadLocal]: the
    #       thunk in every Mach-O thread-local descriptor, which dyld
    #       rebinds to its own tlv_get_addr at load
    # The release build carries one more, `bzero`, and it is not the
    # thread's: LLVM's optimiser turns the arena's clearing loops into a
    # memset, and the aarch64 back end spells a zeroing memset `bzero`.
    # A --release `hello` on darwin names it too; bench/dependency_floor.sh
    # builds plain and never sees it.
    step "dependency floor: what a thread costs darwin, by name"
    runtime='___error __dyld_get_image_header __dyld_get_image_vmaddr_slide _clock_gettime_nsec_np _exit _kevent _kqueue _mmap _munmap _pthread_get_stackaddr_np _pthread_self _write'
    thread='__tlv_bootstrap _os_unfair_lock_lock _os_unfair_lock_unlock _pthread_create _pthread_join _pthread_kill _pthread_threadid_np _sigaction'
    printf '%s\n' $runtime $thread | LC_ALL=C sort > expected-floor.txt
    printf '%s\n' $runtime $thread _bzero | LC_ALL=C sort > expected-floor-release.txt
    for bin in floor floor-release; do
      nm -u "$bin" | sed -e 's/^ *//' | awk '{ print $NF }' | LC_ALL=C sort > "found-$bin.txt"
      if ! diff "expected-$bin.txt" "found-$bin.txt" > "diff-$bin.txt"; then
        echo "$bin moved the darwin floor (< expected, > found):"
        cat "diff-$bin.txt"
        exit 1
      fi
      extra_libs="$(otool -L "$bin" | sed -n '2,$p' | awk '{ print $1 }' | grep -cv 'libSystem')"
      if [ "$extra_libs" -ne 0 ]; then
        echo "$bin links something besides libSystem:"
        otool -L "$bin"
        exit 1
      fi
    done
    echo "  the runtime's twelve names, the thread's eight, libSystem alone; release adds bzero"
    ;;
esac

# ── 3. The pause, by count ────────────────────────────────────────────────
step "stop-the-world by thread count, release build ($cores cores here)"
for count in 1 4 8 16 64; do
  echo "  $count threads:"
  timeout 120 ./floor-release "$count" 200 | grep -E '^  (stop|resume)' | sed 's/^/  /'
done

# ── 4. Failure proof: the ran-its-loop assertion is reachable ─────────────
# A thread that counts into the wrong word looks alive to every earlier
# step — it has a tid, it stops, it resumes, it joins — and is caught by
# the last check by name. The earlier checks cannot be made to fire by a
# one-word edit that leaves the threads real, which is the point of them.
step "failure proof: a thread that never counted is refused"
sed 's/__tf_add(line + 16_u64, 1_u64)/__tf_add(line + 24_u64, 1_u64)/' \
  "$REPO/bench/thread_floor.iyi" > idle.iyi
grep -q 'line + 24_u64' idle.iyi || { echo "the sed found nothing to change"; exit 1; }
if ! "$IYI" build idle.iyi -o idle > build-idle.log 2>&1; then
  cat build-idle.log; exit 1
fi
timeout 60 ./idle 2 10 > idle.txt 2>&1
if [ $? -ne 1 ] || ! grep -q "never ran its loop" idle.txt; then
  echo "the loop check did not fire:"; cat idle.txt; exit 1
fi

# ── 5. Failure proof: the thread-local assertion is reachable ─────────────
step "failure proof: threads sharing one thread-local block are refused"
case "$(uname -s)" in
  Linux)
    # The one flag bit, dropped from the constant and from both arms' asm
    # immediates: every thread then inherits the parent's thread pointer
    # and shares its block, so the slots clash and the program says whose.
    sed 's/012d/0125/g' "$REPO/bench/thread_floor.iyi" > shared.iyi
    [ "$(grep -c '0125' shared.iyi)" -ge 3 ] || { echo "the sed found nothing to change"; exit 1; }
    ;;
  Darwin)
    # No bit to drop: dyld lays the block out for every pthread. What can
    # be dropped is the annotation, and then the slot, the seed and the
    # line are one thread's class variables that every thread writes.
    sed '/@\[ThreadLocal\]/d' "$REPO/bench/thread_floor.iyi" > shared.iyi
    [ "$(grep -c '@\[ThreadLocal\]' "$REPO/bench/thread_floor.iyi")" -ge 3 ] || { echo "the sed found nothing to change"; exit 1; }
    ;;
esac
if ! "$IYI" build shared.iyi -o shared > build-shared.log 2>&1; then
  cat build-shared.log; exit 1
fi
timeout 60 ./shared 2 10 > shared.txt 2>&1
if [ $? -ne 1 ] || ! grep -q "thread-local" shared.txt; then
  echo "the thread-local check did not fire:"; cat shared.txt; exit 1
fi

echo "workdir $WORK"
echo "thread floor: every step held"
exit 0
