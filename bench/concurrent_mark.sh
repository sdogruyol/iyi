#!/usr/bin/env bash
# Drives bench/concurrent_mark.iyi: the mark beside the program, GC_DESIGN.md
# Stage 9, and the write barrier it stands on.
#
#     bash bench/concurrent_mark.sh
#
# Three steps, the last a failure proof:
#   1. The program holds, release: twenty-four rounds each move a payload
#      out of an unmarked chain into an already-marked holder under a
#      running mark, and every payload is intact after the collection.
#   2. The pauses, printed: the stop-the-world mark over the same chain
#      against a concurrent collection's two stops.
#   3. Failure proof: the barrier's shade removed from a copy of the
#      prelude; the first payload moved under a mark is freed, and the
#      program exits 1 saying so.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
IYI="$REPO/bin/iyi"
WORK="$(mktemp -d)"
cd "$WORK" || exit 1

step() { echo "== $1"; }

case "$(uname -s)" in
  Linux | Darwin) ;;
  *) echo "concurrent mark: measured on Linux and darwin; nothing to measure here"; exit 0 ;;
esac

step "the mark beside the program, release build"
if ! "$IYI" build --release "$REPO/bench/concurrent_mark.iyi" -o marks > build.log 2>&1; then
  cat build.log; exit 1
fi
if ! timeout 300 ./marks > answers.txt 2>&1; then
  cat answers.txt; exit 1
fi
grep -q 'every property held' answers.txt || { cat answers.txt; exit 1; }

step "the pauses, stopped and beside the program ($(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu) cores here)"
grep -E '^(moves|pause):' answers.txt | sed 's/^/  /'

step "failure proof: a barrier that shades nothing loses the moved payload"
mkdir -p patched/iyi
cp "$REPO"/src/iyi/*.iyi patched/iyi/
awk '{ sub(/mutator_shade\(w, base\) if base != 0/, "# the barrier shades nothing"); print }' "$REPO/src/iyi/prelude.iyi" > patched/iyi/prelude.iyi
cmp -s patched/iyi/prelude.iyi "$REPO/src/iyi/prelude.iyi" && { echo "the awk found nothing to change"; exit 1; }
if ! IYI_PATH="$WORK/patched:$REPO/src" "$IYI" build --release "$REPO/bench/concurrent_mark.iyi" -o nobarrier > build-nobarrier.log 2>&1; then
  cat build-nobarrier.log; exit 1
fi
timeout 300 ./nobarrier > nobarrier.txt 2>&1
code=$?
if [ "$code" -ne 1 ] || ! grep -q "the barrier lost it" nobarrier.txt; then
  echo "the payload check did not fire (exit $code):"; tail -3 nobarrier.txt; exit 1
fi
printf '  exits 1 at "%s"\n' "$(grep -m1 'the barrier lost it' nobarrier.txt)"

echo "workdir $WORK"
echo "concurrent mark: every step held"
exit 0
