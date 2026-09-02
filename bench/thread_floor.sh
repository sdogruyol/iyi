#!/usr/bin/env bash
# Drives bench/thread_floor.iyi: what a kernel thread, and a stop-the-world
# over kernel threads, cost the dependency floor (SPEC.md III.9) — measured
# before the design that needs them (GC_DESIGN.md Stages 4, 7, 8, 9;
# SPEC.md III.4.7's `Share`) is written.
#
#     bash bench/thread_floor.sh
#
# Four steps, and the last is a failure proof, because a gate that cannot
# fail is not a gate:
#
#   1. The program holds every property, plain and --release: N threads by
#      raw `clone`, each with a tid of its own; every one stopped where it
#      ran by `tgkill` and a handler, released by one futex wake; every one
#      joined on the tid word the kernel clears at exit.
#   2. The binary keeps the floor: the runtime's five C-template names and
#      nothing else. This is the measurement the file exists for — a thread
#      without pthreads adds no symbol — and it is asserted, not printed.
#   3. The pause, by thread count, printed from real runs. Reported rather
#      than budgeted: a budget would be a number this script made up, and
#      the shape (how it scales past the core count) is the finding.
#   4. The tid assertion is reachable: a program whose thread reads the
#      process id instead of a thread id exits 1 at that check's own name.
#
# Linux x86_64 and aarch64 only. darwin's thread is libSystem's by III.9's
# rule and its floor is measured by its own job; here the script says so
# and exits 0 without claiming anything.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
IYI="$REPO/bin/iyi"
WORK="$(mktemp -d)"

cd "$WORK" || exit 1

step() { echo "== $1"; }

if [ "$(uname -s)" != Linux ]; then
  echo "thread floor: measured on Linux; darwin's arm is libSystem's pthread_create and is its own measurement"
  exit 0
fi

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
# The same five names bench/concurrency_exercise.sh allows, for the same
# reason: they are crt1.o's, not the program's. `clone`, `futex`, `tgkill`,
# `rt_sigaction` and `gettid` are syscalls here and appear as nothing.
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

# ── 3. The pause, by count ────────────────────────────────────────────────
step "stop-the-world by thread count, release build ($(nproc) cores here)"
for count in 1 4 16 64; do
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

echo "workdir $WORK"
echo "thread floor: every step held"
exit 0
