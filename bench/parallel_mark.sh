#!/usr/bin/env bash
# Drives bench/parallel_mark.iyi: the parallel marker, GC_DESIGN.md Stage 7.
#
#     bash bench/parallel_mark.sh
#
# Three steps, the last a failure proof:
#   1. The program holds, release: a million-node tree survives five marks
#      alone and five with helpers, and the helpers blackened nodes.
#   2. The two pause means, printed: alone against with helpers.
#   3. Failure proof: the marker's donation of its stack's bottom removed
#      from a copy of the prelude; the helpers wake and find nothing, and
#      the program exits 1 saying so.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
IYI="$REPO/bin/iyi"
WORK="$(mktemp -d)"
cd "$WORK" || exit 1

step() { echo "== $1"; }

case "$(uname -s)" in
  Linux | Darwin) ;;
  *) echo "parallel mark: measured on Linux and darwin; nothing to measure here"; exit 0 ;;
esac

step "the parallel marker, release build"
if ! "$IYI" build --release "$REPO/bench/parallel_mark.iyi" -o marks > build.log 2>&1; then
  cat build.log; exit 1
fi
if ! timeout 300 ./marks > answers.txt 2>&1; then
  cat answers.txt; exit 1
fi
grep -q 'every property held' answers.txt || { cat answers.txt; exit 1; }

step "the mark, alone and with helpers ($(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu) cores here)"
grep -E '^(tree|mark):' answers.txt | sed 's/^/  /'

step "failure proof: a marker that never shares its stack is refused"
mkdir -p patched/iyi
cp "$REPO"/src/iyi/*.iyi patched/iyi/
awk '{ sub(/since >= DONATE_EVERY/, "since >= STACK_WORDS"); print }' "$REPO/src/iyi/prelude.iyi" > patched/iyi/prelude.iyi
cmp -s patched/iyi/prelude.iyi "$REPO/src/iyi/prelude.iyi" && { echo "the awk found nothing to change"; exit 1; }
if ! IYI_PATH="$WORK/patched:$REPO/src" "$IYI" build --release "$REPO/bench/parallel_mark.iyi" -o nodonate > build-nodonate.log 2>&1; then
  cat build-nodonate.log; exit 1
fi
timeout 300 ./nodonate > nodonate.txt 2>&1
code=$?
if [ "$code" -ne 1 ] || ! grep -q "blackened nothing" nodonate.txt; then
  echo "the sharing check did not fire (exit $code):"; tail -3 nodonate.txt; exit 1
fi
printf '  exits 1 at "%s"\n' "$(grep -m1 'blackened nothing' nodonate.txt)"

echo "workdir $WORK"
echo "parallel mark: every step held"
exit 0
