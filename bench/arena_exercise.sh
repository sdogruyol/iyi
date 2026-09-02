#!/usr/bin/env bash
# Exercises the Stage 2 size-class arena allocator, and the default allocator
# beside it, so the same program proves both.
#
#     bash bench/arena_exercise.sh
#
# GC_DESIGN.md's Stage 2 names the verification: "allocate and free objects of
# various sizes; verify no corruption; inspect arena structure; measure
# allocation speed". `bench/arena_exercise.iyi` is that program and this runs
# it twice, plain and with `-Dgc_iyi`, because an allocator that is opt-in has
# two paths to keep working and only one of them is new.
#
# Four things happen here that the program cannot do for itself. It is run
# without the flag, which is the only way to know the default path still
# works. Its exit code is read rather than its output, because a check that
# fails raises and a panic exits non-zero. `bench/arena_large_probe.iyi` is
# run separately and its death is the assertion: freeing a large object
# releases the mapping, and the proof of a released mapping is that reading
# it faults. And the `-Dgc_iyi` binary's undefined symbols are audited the
# way `bench/dependency_floor.sh` audits a default build's, because a new
# allocator is exactly the kind of change that arrives with a new library.
#
# Needs `make` for bin/iyi, plus `nm`, and `otool` on darwin or `readelf` on
# Linux. Exits non-zero if any check fails.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
IYI="$REPO/bin/iyi"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

status=0

# The same readers `bench/dependency_floor.sh` uses, for the same reason: what
# a binary itself leaves undefined and what it itself asks to have loaded.
symbols() {
  nm -u "$1" 2>/dev/null |
    sed -e 's/^ *//' -e 's/^U  *//' -e 's/@.*$//' |
    awk '{ print $NF }' |
    sed -e 's/^_//' |
    grep -v '^$' |
    sort -u
}

libraries() {
  if command -v otool >/dev/null 2>&1; then
    otool -L "$1" 2>/dev/null | sed -n '2,$p' | awk '{ print $1 }' | sed 's|.*/||' | sort -u
  else
    readelf -d "$1" 2>/dev/null |
      sed -n 's/.*Shared library: \[\(.*\)\]/\1/p' |
      sed 's|.*/||' | sort -u
  fi
}

# Reports every element of $2 not matched by a prefix in $1.
unexpected() {
  local allowed="$1" found="$2" item keep ok
  for item in $found; do
    keep=no
    for ok in $allowed; do
      case "$item" in "$ok"*) keep=yes ;; esac
    done
    [ "$keep" = no ] && printf '%s\n' "$item"
  done
  return 0
}

build_and_run() {
  # $1 label, $2 output name, $3 source, rest: flags
  local label="$1" name="$2" source="$3"
  shift 3
  if ! "$IYI" build "$@" -o "$WORK/$name" "$source" >"$WORK/$name.build.log" 2>&1; then
    echo "$label: build failed"
    tail -12 "$WORK/$name.build.log"
    status=1
    return 1
  fi
  "$WORK/$name" >"$WORK/$name.out" 2>&1
  local exit_code=$?
  sed 's/^/  /' "$WORK/$name.out"
  if [ "$exit_code" -ne 0 ]; then
    echo "$label: exited $exit_code"
    status=1
    return 1
  fi
  return 0
}

echo "== the exercise, -Dgc_none (the opted-out bump pointer)"
build_and_run "gc_none" exercise-default "$REPO/bench/arena_exercise.iyi" -Dgc_none

echo
echo "== the exercise, the default (the collector's arena)"
build_and_run "default" exercise-gc "$REPO/bench/arena_exercise.iyi"

# The same two, --release: the speed a shipped program sees, which is the
# number that moved when the fast path grew a thread-local read (one call
# in a plain build, one `%fs:` load in a release one).
echo
echo "== the same two, --release"
build_and_run "gc_none, release" exercise-default-release "$REPO/bench/arena_exercise.iyi" -Dgc_none --release
build_and_run "default, release" exercise-gc-release "$REPO/bench/arena_exercise.iyi" --release

# Every check in the program prints a line, and the arena-only ones print
# nothing without the flag. Naming them here is what stops a build that
# silently compiled the whole arena section out from reading as a pass.
echo
echo "== every arena check reported"
for check in "size classes:" "addressability:" "clearing:" "reuse:" "traversal:" "large:"; do
  if ! grep -q "$check" "$WORK/exercise-gc.out" 2>/dev/null; then
    echo "  MISSING: $check"
    status=1
  fi
done
[ "$status" -eq 0 ] && echo "  size classes, addressability, clearing, reuse, traversal and large all reported"

echo
echo "== a freed large object's mapping is gone"
if ! "$IYI" build -o "$WORK/large-probe" "$REPO/bench/arena_large_probe.iyi" >"$WORK/large-probe.build.log" 2>&1; then
  echo "  probe build failed"
  tail -12 "$WORK/large-probe.build.log"
  status=1
else
  # Run through a child shell whose stderr is dropped: the fault is the
  # expected result here, and the "Segmentation fault" line a shell prints
  # for a killed job would read as this script's own failure.
  bash -c '"$0" >"$1" 2>&1' "$WORK/large-probe" "$WORK/large-probe.out" 2>/dev/null
  probe_exit=$?
  # 128 + SIGSEGV(11), or 128 + SIGBUS(10) where a platform reports an
  # unmapped read that way. Either is the read faulting, which is the claim.
  case "$probe_exit" in
    139 | 138)
      echo "  the read faulted (exit $probe_exit): munmap released the mapping"
      ;;
    0)
      echo "  the probe READ the freed mapping and lived, so nothing was released:"
      sed 's/^/    /' "$WORK/large-probe.out"
      status=1
      ;;
    *)
      echo "  the probe exited $probe_exit, which is neither a fault nor a clean read"
      sed 's/^/    /' "$WORK/large-probe.out"
      status=1
      ;;
  esac
fi

echo
echo "== the allocation floor, measured against the -Dgc_iyi binary"
# The default program floor is `bench/dependency_floor.sh`'s to state, and it
# measures a plain build. This measures the build that floor cannot see. The
# Linux list is unchanged from that script's, because the arena allocator
# issues mmap and munmap as raw syscalls there and asks libc for nothing. The
# darwin list is that script's, every name libSystem's (Apple documents
# libSystem as the interface and raw syscalls as not a stable ABI), minus the
# file calls no exercise makes, plus `clock_gettime`, which is the exercise
# program's own stopwatch rather than the allocator's and is not on any
# sample's line. The list is exact and every entry is used: `malloc`,
# `memset` and `realloc` were here from before the collector became the
# default and would have let a fallback to libSystem's allocator pass; the
# kqueue, clock and dyld names arrived with the concurrency runtime and the
# owned collector and were never recorded here, because this gate did not
# run on darwin until the darwin job took it.
case "$(uname -s)" in
  Linux)
    allowed_symbols="ITM_deregisterTMCloneTable ITM_registerTMCloneTable _cxa_finalize _gmon_start__ _libc_start_main"
    if ! command -v readelf >/dev/null 2>&1; then
      echo "  readelf is required on Linux to read NEEDED entries" >&2
      exit 2
    fi
    ;;
  *) allowed_symbols="__error _tlv_bootstrap pipe pthread_create pthread_kill sysctlbyname read _dyld_get_image_header _dyld_get_image_vmaddr_slide clock_gettime clock_gettime_nsec_np exit kevent kqueue mmap munmap pthread_get_stackaddr_np pthread_self write" ;;
esac
allowed_libs="libSystem libc.so ld-linux libgcc_s"

if [ -x "$WORK/exercise-gc" ]; then
  gc_syms="$(symbols "$WORK/exercise-gc")"
  gc_libs="$(libraries "$WORK/exercise-gc")"
  printf '  symbols   %s\n' "$(echo $gc_syms)"
  printf '  libraries %s\n' "$(echo $gc_libs)"

  extra_syms="$(unexpected "$allowed_symbols" "$(echo $gc_syms)")"
  if [ -n "$extra_syms" ]; then
    echo "  the arena allocator asks the machine for something new:"
    echo "$extra_syms" | sed 's/^/    /'
    echo "  Each is a dependency being taken on. If that is the decision, record it"
    echo "  here and in the commit (SPEC.md III.9)."
    status=1
  fi

  extra_libs="$(unexpected "$allowed_libs" "$(echo $gc_libs)")"
  if [ -n "$extra_libs" ]; then
    echo "  the arena allocator links something new:"
    echo "$extra_libs" | sed 's/^/    /'
    status=1
  fi
  [ -z "$extra_syms$extra_libs" ] && echo "  nothing new: the arena allocator costs no symbol and no library"
else
  echo "  no -Dgc_iyi binary to audit"
  status=1
fi

echo
echo "== the samples, both allocators, same output"
# The exercise is written to be exercised; the samples are what people run.
# Building each one both ways and diffing is what says the arena allocator is
# a drop-in rather than a thing with its own programs. `calc` reads standard
# input and falls back to its built-in source on EOF, so it gets /dev/null.
mkdir -p "$WORK/samples" && cp -r "$REPO/samples/iyi/." "$WORK/samples/"
for source in "$REPO"/samples/iyi/*.iyi; do
  sample="$(basename "$source" .iyi)"
  (
    cd "$WORK/samples" || exit 1
    if ! "$IYI" build -o "$WORK/$sample-default" "$sample.iyi" >"$WORK/$sample.default.log" 2>&1; then
      echo "  $sample: default build failed"
      exit 1
    fi
    if ! "$IYI" build -Dgc_iyi -o "$WORK/$sample-gc" "$sample.iyi" >"$WORK/$sample.gc.log" 2>&1; then
      echo "  $sample: -Dgc_iyi build failed"
      tail -8 "$WORK/$sample.gc.log"
      exit 1
    fi
    "$WORK/$sample-default" </dev/null >"$WORK/$sample.default.out" 2>&1
    default_exit=$?
    "$WORK/$sample-gc" </dev/null >"$WORK/$sample.gc.out" 2>&1
    gc_exit=$?
    if [ "$default_exit" -ne "$gc_exit" ]; then
      echo "  $sample: exit $default_exit default, $gc_exit under -Dgc_iyi"
      exit 1
    fi
    if ! diff -q "$WORK/$sample.default.out" "$WORK/$sample.gc.out" >/dev/null; then
      echo "  $sample: OUTPUT DIFFERS"
      diff "$WORK/$sample.default.out" "$WORK/$sample.gc.out" | head -10
      exit 1
    fi
    echo "  $sample: identical output, exit $default_exit"
  ) || status=1
done

echo
echo "== speed, same program, same machine, plain build and --release"
bump_ns="$(grep -m1 '^ *speed:' "$WORK/exercise-default.out" 2>/dev/null | awk '{ print $2 }')"
arena_ns="$(grep -m1 '^ *speed:' "$WORK/exercise-gc.out" 2>/dev/null | awk '{ print $2 }')"
pair_ns="$(grep 'alloc+free' "$WORK/exercise-gc.out" 2>/dev/null | awk '{ print $2 }')"
bump_rel="$(grep -m1 '^ *speed:' "$WORK/exercise-default-release.out" 2>/dev/null | awk '{ print $2 }')"
arena_rel="$(grep -m1 '^ *speed:' "$WORK/exercise-gc-release.out" 2>/dev/null | awk '{ print $2 }')"
pair_rel="$(grep 'alloc+free' "$WORK/exercise-gc-release.out" 2>/dev/null | awk '{ print $2 }')"
printf '  bump pointer      %s ns per allocation, %s ns --release\n' "${bump_ns:-?}" "${bump_rel:-?}"
printf '  size-class arena  %s ns per allocation, %s ns --release\n' "${arena_ns:-?}" "${arena_rel:-?}"
printf '  size-class arena  %s ns per alloc+free pair, %s ns --release\n' "${pair_ns:-?}" "${pair_rel:-?}"
echo "  A size-class allocator is expected to cost more than a bump pointer on"
echo "  the fast path. The number is reported rather than hidden, and it is the"
echo "  price of a heap that can hand memory back."

echo
if [ "$status" -eq 0 ]; then
  echo "the arena allocator holds"
else
  echo "the arena allocator did not hold"
fi
exit $status
