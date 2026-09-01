#!/usr/bin/env python3
"""Fails when a number the docs state as current has drifted from the tree.

The docs quote sizes as facts a reader can check, and the convention is
`wc -l` (README says so where it first quotes one). Three times now a number
has gone stale without anyone noticing: PR #3 corrected a batch, the 0.2.0
merge left the prelude at 1,184 lines when it was 1,989, and the same figure
was repeated in eleven places across four files.

    python3 bench/doc_numbers.py          # check
    python3 bench/doc_numbers.py --list   # every occurrence found
    python3 bench/doc_numbers.py --json   # what the tree measures, for the site

Only CURRENT claims are checked. A release note saying "0.1.0 had a
1,184-line prelude" is a statement about the past and stays; the check looks
for the phrasings the docs use to describe the tree as it is now.

What this does NOT check is whether a sentence is true, only whether a number
matches what the tree measures. `bench/identity_floor.py` is the same idea for
a different kind of claim.
"""

from __future__ import annotations

import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent


def wc(paths) -> int:
    return sum(len(p.read_text().splitlines()) for p in paths)


def bang_names() -> int:
    """Distinct method names ending in `!` in Crystal's standard library.

    README says `!` propagates an error in iyi, so a Crystal method whose name
    ends in one cannot be called from a `.iyi` file, and quotes how many such
    names there are. `src/compiler/` is excluded because the compiler is not the
    standard library, and `__crystal_pseudo_!` is excluded because it is a
    compiler intrinsic rather than a name a person calls.
    """
    names: set[str] = set()
    for p in (REPO / "src").rglob("*.cr"):
        if "/compiler/" in str(p):
            continue
        try:
            text = p.read_text()
        except (UnicodeDecodeError, OSError):
            continue
        for m in re.finditer(r"^\s*def\s+([a-z_][A-Za-z0-9_]*!)", text, re.M):
            names.add(m.group(1))
    names.discard("__crystal_pseudo_!")
    return len(names)


def generated_project_lines() -> int:
    """What `bench/incremental/generate_project.py` writes, as iyi.

    The edit-loop numbers are about a generated 30-module project and the docs
    quote its size. The generator is the authority, so it is asked rather than
    remembered: two places said 7,208 while it emitted 7,207.
    """
    import subprocess
    import tempfile

    with tempfile.TemporaryDirectory() as work:
        subprocess.run(
            [sys.executable, "bench/incremental/generate_project.py", work],
            cwd=REPO, capture_output=True, text=True, check=True,
        )
        return wc(sorted((pathlib.Path(work) / "iyi").rglob("*.iyi")))


# The spec files that exist because of iyi's own rules, named rather than
# globbed. A glob for "iyi" in the path is the obvious measure and it is wrong:
# the namespace rename moved a dozen of Crystal's tool specs under
# `spec/compiler/iyi/`, and counting those claims Crystal's testing as iyi's.
# `iyi_path_spec.cr`, `iyi-daemon_spec.cr` and `iyi/tools/unreachable_spec.cr`
# are the same trap wearing an iyi name: each is a Crystal spec that was renamed.
#
# A missing file raises rather than counting short, because a rename that this
# list does not follow would otherwise report a smaller number as though the
# specs had shrunk.
IYI_SPECS = (
    "spec/compiler/iyimod_spec.cr",             # the artifact format
    "spec/compiler/iyi_import_spec.cr",         # the import path
    "spec/compiler/iyi_derive_spec.cr",         # derive, R-5
    "spec/compiler/semantic/iyi_spec.cr",       # iyi's own semantics
    "spec/compiler/iyi/rx_spec.cr",             # the engine, differential
    "spec/compiler/formatter/iyi_formatter_spec.cr",  # `pub`, which Crystal has no word for
    "spec/compiler/object_header_spec.cr",      # the collector's header, GC_DESIGN.md Stage 1
)


def iyi_spec_lines() -> int:
    paths = []
    for rel in IYI_SPECS:
        path = REPO / rel
        if not path.exists():
            raise SystemExit(
                f"doc_numbers: {rel} is gone, so the spec count cannot be measured. "
                "If it moved, follow it here; the number is not allowed to shrink quietly."
            )
        paths.append(path)
    return wc(paths)


def measured() -> dict[str, int]:
    """The numbers, measured the way the docs say they are measured."""
    return {
        "prelude": wc(sorted((REPO / "src/iyi").glob("*.iyi"))),
        "samples_std": wc(sorted((REPO / "samples/iyi/std").glob("*.iyi"))),
        "compiler": wc(sorted((REPO / "src/compiler").rglob("*.cr"))),
        "samples": len(sorted((REPO / "samples/iyi").glob("*.iyi"))),
        # Bytes on disk, not lines: the docs quote the library's size as a
        # download, which is what a person unpacking the tarball sees.
        "prelude_kb": round(
            sum(p.stat().st_size for p in sorted((REPO / "src/iyi").glob("*.iyi"))) / 1024
        ),
        "bang_names": bang_names(),
        "generated": generated_project_lines(),
        "spec_iyi": iyi_spec_lines(),
        "targets": targets(),
    }


def targets() -> int:
    """Distinct targets CI type-checks the library for.

    Read out of the workflow rather than counted by hand, which is how the docs
    came to say eight while the workflow listed nine. `x86_64-w64-mingw32` and
    `x86_64-windows-gnu` are the same platform spelled by two vendors, so the
    audit list adds nothing the type-check list does not already name.
    """
    text = (REPO / ".github/workflows/iyi.yml").read_text()
    m = re.search(
        r"Type-check the standard library.*?for target in (.*?); do", text, re.S
    )
    if not m:
        raise SystemExit(
            "doc_numbers: the workflow's type-check target list moved; "
            "this check cannot find it and so is not checking anything"
        )
    return len([t for t in m.group(1).replace("\\", "").split() if t])

# Each entry: the measured key, the pattern that quotes it as current, the file,
# and how many times that pattern is expected to appear there. The count is
# load-bearing: two sites in one file shared a pattern, and dropping one of them
# left the other matching, so the check went on passing while a sentence it was
# meant to cover had gone. A pattern must capture the number in group 1.
CLAIMS: list[tuple[str, str, str, int]] = [
    ("prelude", r"iyi's own library is ([\d,]+) lines", "README.md", 2),
    ("prelude", r"iyi's own library, ([\d,]+) lines", "README.md", 1),
    ("prelude", r"standard library instead of ([\d,]+)", "README.md", 1),
    ("prelude", r"iyi's own prelude \| ([\d,]+) lines", "SPEC.md", 1),
    ("prelude", r"still true of iyi's own ([\d,]+) lines", "SPEC.md", 1),
    ("prelude", r"Done: ([\d,]+) lines", "SPEC.md", 1),
    ("prelude", r"\| ([\d,]+)-line own prelude", "SPEC.md", 1),
    ("prelude", r"against iyi's own ([\d,]+)-line prelude", "SPEC.md", 1),
    ("prelude", r"against iyi's own ([\d,]+)-line library", "CHANGELOG.md", 1),
    ("prelude", r"against iyi's own ([\d,]+)-line", "samples/iyi/calc.iyi", 1),
    ("samples_std", r"own prelude \+ ([\d,]+) in samples", "SPEC.md", 1),
    ("compiler", r"\| ([\d,]+) lines, Crystal, forked", "SPEC.md", 1),
    ("spec_iyi", r"\| ([\d,]+) for iyi \|", "SPEC.md", 1),
    ("prelude_kb", r"library is ([\d,]+) KB on disk", "README.md", 1),
    ("prelude_kb", r"carries both libraries: iyi's own ([\d,]+) KB", "README.md", 1),
    ("prelude_kb", r"beside `bin/iyi` is ([\d,]+) KB", "Makefile", 1),
    ("prelude_kb", r"ships only iyi's own ([\d,]+) KB", "Makefile", 1),
    ("prelude_kb", r"its own, and it is ([\d,]+) KB", "Makefile", 1),
    ("bang_names", r"standard library has \*\*([\d,]+) such names\*\*", "README.md", 1),
    ("generated", r"edit one module in a ([\d,]+)-line project", "README.md", 1),
    ("generated", r"on the same ([\d,]+) lines", "README.md", 1),
    ("targets", r"compiles for \*\*(\w+) targets\*\*", "README.md", 1),
    ("targets", r"for (\w+) targets and was tested on one", "SPEC.md", 1),
    ("targets", r"Four of the (\w+) now", "SPEC.md", 1),
    # The count of sample programs was quoted as a word and drifted by three
    # before anything noticed, because the digit patterns above cannot see a
    # spelled-out number.
    ("samples", r"\| (\w+) programs:", "README.md", 1),
]

# The prose spells small numbers as words and should keep doing so, so the
# check reads words as well as digits rather than pushing digits into a
# sentence to suit itself.
WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
}


def as_number(raw: str) -> int | None:
    bare = raw.replace(",", "")
    if bare.isdigit():
        return int(bare)
    return WORDS.get(bare.lower())


def main() -> int:
    show_all = "--list" in sys.argv
    truth = measured()
    # The site reads these rather than transcribing them, so the page and this
    # gate agree by construction: one measurement function, two consumers. A
    # number typed into a template is the artifact this project argues against.
    if "--json" in sys.argv:
        import json

        print(json.dumps(truth, indent=2, sort_keys=True))
        return 0
    wrong: list[str] = []
    found: list[str] = []

    for key, pattern, rel, expected in CLAIMS:
        fp = REPO / rel
        text = fp.read_text()
        hits = list(re.finditer(pattern, text))
        if len(hits) != expected:
            wrong.append(
                f"{rel}: /{pattern}/ appears {len(hits)} time(s), expected "
                f"{expected}. A sentence this was written to cover was reworded "
                f"or removed, so the check stopped checking it"
            )
            if not hits:
                continue
        for m in hits:
            line = text[: m.start()].count("\n") + 1
            stated = as_number(m.group(1))
            if stated is None:
                wrong.append(
                    f"{rel}:{line}  captured {m.group(1)!r}, which is neither a "
                    f"number nor a word this check knows. Add it to WORDS or "
                    f"tighten the pattern"
                )
                continue
            ok = stated == truth[key]
            found.append(f"{'ok  ' if ok else 'WRONG'}  {rel}:{line}  {key}={stated}")
            if not ok:
                wrong.append(
                    f"{rel}:{line}  says {key} is {stated:,}, tree measures {truth[key]:,}"
                )

    if show_all:
        for f in found:
            print(f)
        print()

    print("measured:", ", ".join(f"{k}={v:,}" for k, v in sorted(truth.items())))

    if not wrong:
        print("the numbers the docs state are the numbers the tree has")
        return 0

    print("\nA NUMBER THE DOCS STATE AS CURRENT HAS DRIFTED\n")
    for w in wrong:
        print(f"  {w}")
    print(
        "\nUpdate the sentence, or update this script if what it measures is no "
        "longer what the sentence means. Counts are `wc -l`, which is the "
        "convention README states where it first quotes one."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
