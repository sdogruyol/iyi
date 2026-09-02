#!/usr/bin/env bash
# Drives bench/thread_floor.iyi: what a kernel thread, and a stop-the-world
# over kernel threads, cost the dependency floor (SPEC.md III.9) — measured
# before the design that needs them (GC_DESIGN.md Stages 4, 7, 8, 9;
# SPEC.md III.4.7's `Share`) is written.
#
#     bash bench/thread_floor.sh
#
# Six steps, and the last three are failure proofs, because a gate that
# cannot fail is not a gate:
#
#   1. The program holds every property, plain and --release (and on darwin
#      the -Dtf_mach stop, release): N threads,
#      each with a tid of its own and a thread-local block of its own;
#      every one stopped where it ran by a signal and a handler that read
#      the thread's sp and pc out of the context and found the sp on that
#      thread's stack, released by one wake; every one joined; every
#      `@[ThreadLocal]` slot still its owner's at the end.
#   2. The binary keeps the floor. This is the measurement the file exists
#      for, and it is asserted, not printed. On Linux: the runtime's five
#      C-template names and nothing else — a thread by raw `clone` adds no
#      symbol, and a thread-local variable adds no `__tls_get_addr`. On
#      darwin, where III.9's rule is that every call is libSystem's: the
#      exact list below, which is the runtime's names plus what a thread
#      costs there, spelled out one by one.
#   3. The pause, by thread count, printed from real runs, and what one
#      touch of a `@[ThreadLocal]` costs against a plain class variable.
#      Reported rather than budgeted: a budget would be a number this
#      script made up, and the shape (how it scales past the core count)
#      is the finding.
#   4. The ran-its-loop assertion is reachable: a thread that counts into
#      the wrong word exits 1 at that check's own name.
#   5. The thread-local assertion is reachable. On Linux, `clone` without
#      CLONE_SETTLS leaves every thread on the main thread's block. On
#      darwin dyld lays the block out and there is no bit to drop, so the
#      `@[ThreadLocal]` annotation itself is dropped instead: the slots
#      become one thread's class variables and clash. Either way the
#      program exits 1 naming the thread-local that was not.
#   6. The held-context assertion is reachable: the context's sp read at
#      the pc's offset is not on any thread's stack, and the program exits
#      1 counting the handlers that read it.
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

# darwin has a second stop: `-Dtf_mach`, Mach's thread_suspend and
# thread_get_state in place of a signal and a park. Built and held to its
# own list so the comparison in step 3 stays reproducible.
if [ "$(uname -s)" = Darwin ]; then
  step "thread floor, release build, the Mach stop"
  if ! "$IYI" build --release -Dtf_mach "$REPO/bench/thread_floor.iyi" -o floor-mach > build-mach.log 2>&1; then
    cat build-mach.log; exit 1
  fi
  if ! timeout 60 ./floor-mach 4 100 > answers-mach.txt 2>&1; then
    cat answers-mach.txt; exit 1
  fi
  grep -q 'every property held' answers-mach.txt || { cat answers-mach.txt; exit 1; }
fi

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
    # The release build once carried one more, `bzero`: the compiler zeroes
    # every `Pointer.malloc` with an `llvm.memset`, and the aarch64 back end
    # lowers a memset it will not inline to a `bzero` call. The prelude
    # defines `bzero` now, the way it defines `memset`, so the name resolves
    # to the program's own and the release list is the plain list.
    step "dependency floor: what a thread costs darwin, by name"
    runtime='___error __dyld_get_image_header __dyld_get_image_vmaddr_slide _clock_gettime_nsec_np _exit _kevent _kqueue _mmap _munmap _pthread_get_stackaddr_np _pthread_self _write'
    thread='__tlv_bootstrap _os_unfair_lock_lock _os_unfair_lock_unlock _pthread_create _pthread_join _pthread_kill _pthread_threadid_np _sigaction'
    # The Mach stop swaps the four stop-and-park names for four of its own:
    #   pthread_mach_thread_np                       the thread's port
    #   thread_suspend, thread_resume                the stop
    #   thread_get_state                             the registers, read held
    mach='__tlv_bootstrap _pthread_create _pthread_join _pthread_mach_thread_np _pthread_threadid_np _thread_get_state _thread_resume _thread_suspend'
    printf '%s\n' $runtime $thread | LC_ALL=C sort > expected-floor.txt
    printf '%s\n' $runtime $thread | LC_ALL=C sort > expected-floor-release.txt
    printf '%s\n' $runtime $mach | LC_ALL=C sort > expected-floor-mach.txt
    for bin in floor floor-release floor-mach; do
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
    echo "  the runtime's twelve names, the thread's eight (the Mach stop's other eight), libSystem alone, plain and release"
    ;;
esac

# ── 3. The pause, by count ────────────────────────────────────────────────
step "stop-the-world by thread count, release build ($cores cores here)"
for count in 1 4 8 16 64; do
  echo "  $count threads:"
  timeout 120 ./floor-release "$count" 200 | grep -E '^  (stop|resume)' | sed 's/^/  /'
done
if [ "$(uname -s)" = Darwin ]; then
  # The other stop, same table: thread_suspend returns held, so its stop is
  # the loop alone, and its resume is measured from thread_resume to every
  # counter moving. It loses at every count (CHANGELOG.md has the reading),
  # and the table is printed so that stays a measurement.
  step "the same, by thread_suspend and thread_get_state (-Dtf_mach)"
  for count in 1 4 8 16 64; do
    echo "  $count threads:"
    timeout 120 ./floor-mach "$count" 200 | grep -E '^  (stop|resume)' | sed 's/^/  /'
  done
fi
# And what the cutover's spelling costs: one read-modify-write of a
# `@[ThreadLocal]` against one of a plain class variable, in the release
# build, printed for the same reason the pauses are.
grep '^touch:' answers-release.txt | sed 's/^/  /'

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

# ── 6. Failure proof: the held-context assertion is reachable ─────────────
# One offset moved by a word, so the handler reads pc where it expects sp:
# a code address is on no thread's stack, and every handler says so.
step "failure proof: a handler reading the wrong register is refused"
sed -e 's/TF_UC_SP = 160_u64/TF_UC_SP = 168_u64/' -e 's/TF_UC_SP = 432_u64/TF_UC_SP = 440_u64/' \
    -e 's/TF_MC_SP = 264_u64/TF_MC_SP = 272_u64/' "$REPO/bench/thread_floor.iyi" > astray.iyi
cmp -s astray.iyi "$REPO/bench/thread_floor.iyi" && { echo "the sed found nothing to change"; exit 1; }
if ! "$IYI" build astray.iyi -o astray > build-astray.log 2>&1; then
  cat build-astray.log; exit 1
fi
timeout 60 ./astray 2 10 > astray.txt 2>&1
if [ $? -ne 1 ] || ! grep -q "was not their thread's stack" astray.txt; then
  echo "the held-context check did not fire:"; cat astray.txt; exit 1
fi

echo "workdir $WORK"
echo "thread floor: every step held"
exit 0
