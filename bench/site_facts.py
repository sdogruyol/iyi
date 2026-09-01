#!/usr/bin/env python3
"""The numbers the website is allowed to print, and where each one came from.

The site has no code path that renders a hand-typed figure. Every number on
every page arrives through this script, which is why it exists: two figures
were hand-copied out of README.md while the website was being designed and
both were already stale.

    python3 bench/site_facts.py            # the record, as JSON
    python3 bench/site_facts.py --check    # fail if any pattern stopped matching

There are TWO CLASSES OF NUMBER and the site is required to render them
differently, because they are not the same kind of claim.

STRUCTURAL. Line counts, target counts, sample counts. Measured from the tree,
exact, identical on every machine. These come from `doc_numbers.py`'s
`measured()`, the same function that already gates README.md in CI, so the page
and the gate cannot disagree. A structural number can be stated flatly.

RECORDED. Seconds, bytes, milliseconds. These are a machine, not a language,
and README.md is scrupulous about saying so: it names the exact box and it
publishes a tired session reading 0.22 / 1.81 / 0.27 where a good one read
0.13 / 1.17 / 0.16. So a recorded number is never emitted on its own. It is
emitted as a group carrying the machine that produced it, the command that
prints it, and every session README.md publishes, so the site can draw the
spread and lead with the ratio. The ratio is the claim. The second is a
circumstance.

README.md is the source for the recorded class because that is where this
project publishes these measurements. Parsing it means the site restates the
repository rather than remembering it. When a pattern below stops matching,
that is a failure and not a default: a sentence this was written to cover was
reworded, so the site would be quoting something nobody is maintaining. Same
rule `doc_numbers.py` already applies to itself.
"""

from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "bench"))

from doc_numbers import measured  # noqa: E402  the one measurement function


def flat(text: str) -> str:
    """README.md wraps at about 80 columns, so match against one long line."""
    return re.sub(r"\s+", " ", text)


def git(*args: str) -> str:
    """Read the repository's own history. A shallow clone is refused rather
    than counted, because a truncated history would print a smaller number
    with the same confidence as a true one."""
    out = subprocess.run(
        ["git", "-C", str(REPO), *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if out.returncode != 0:
        raise SystemExit(
            f"bench/site_facts.py: `git {' '.join(args)}` failed, so a count "
            f"the site prints has no source:\n{out.stderr.strip()}"
        )
    return out.stdout.strip()


def project() -> dict:
    """Counts about the project itself, for the contribution section.

    Every one is read from the tree or from git, so it is structural: the same
    on any full clone. The fork's own work and the history it inherited are
    counted separately and never added together. iyi is a fork of Crystal, so
    one combined contributor count would credit this fork with Crystal's
    community, which is the single claim this site must not make.
    """
    if git("rev-parse", "--is-shallow-repository") != "false":
        raise SystemExit(
            "bench/site_facts.py: this is a shallow clone, so the history "
            "counts would be wrong. Fetch the full history rather than "
            "publishing a truncated number."
        )

    spec = (REPO / "SPEC.md").read_text()
    proposed = re.findall(r"^#+ .*\bPROPOSED\b.*$", spec, re.M)

    # Appendix B is a table of decisions the specification hands to the reader.
    # Its rows are counted, never estimated.
    appendix = spec.split("## Appendix B: Decisions awaiting your call", 1)
    if len(appendix) != 2:
        raise SystemExit(
            "bench/site_facts.py: SPEC.md no longer has the Appendix B "
            "heading the site counts its open decisions from."
        )
    rows = [
        line for line in appendix[1].splitlines() if re.match(r"^\|\s*\d+\s*\|", line)
    ]
    if not rows:
        raise SystemExit(
            "bench/site_facts.py: Appendix B is present but its decision "
            "table has no numbered rows to count."
        )

    return {
        "spec_proposed": len(proposed),
        "spec_awaiting": len(rows),
        "fork_commits": int(
            git(
                "rev-list",
                "--count",
                "HEAD",
                "--",
                "src/iyi",
                "src/compiler/iyi",
                "SPEC.md",
            )
        ),
        "inherited_commits": int(git("rev-list", "--count", "HEAD")),
        "inherited_authors": len(set(git("log", "--format=%aE").splitlines())),
    }


# (key, pattern, group names). A miss is an error, never a default.
RECORDED_PATTERNS: list[tuple[str, str, tuple[str, ...]]] = [
    ("machine", r"\(([^()]*Ryzen[^()]*)\)", ("name",)),
    (
        "edit_loop",
        r"\| \*\*rebuild after one edit\*\* \| \*\*([\d.]+)\*\* \| ([\d.]+) \| ([\d.]+) \|",
        ("iyi", "crystal", "go"),
    ),
    (
        "edit_loop_sessions",
        r"read (\d+\.\d+ / \d+\.\d+ / \d+\.\d+) and (\d+\.\d+ / \d+\.\d+ / \d+\.\d+) "
        r"on the first row, and a tired session reads (\d+\.\d+ / \d+\.\d+ / \d+\.\d+)",
        ("a", "b", "tired"),
    ),
    ("edit_loop_ratio", r"costs \*\*([\d.]+)x less\*\*", ("times",)),
    (
        "hello_binary",
        r"is a (?:\*\*)?([\d,]+) KB(?:\*\*)? binary that starts in (?:\*\*)?([\d.]+) ms",
        ("kb", "ms"),
    ),
    (
        "crystal_binary",
        r"library is ([\d,]+) KB and ([\d.]+) ms",
        ("kb", "ms"),
    ),
    (
        "full_build",
        r"\| generated pair, ([\d,]+) lines \| ([\d.]+) s \| \*\*([\d.]+) s\*\* \|",
        ("lines", "iyi", "go"),
    ),
    (
        "hello_build",
        r"\| `hello` \(([\d,]+) lines\) \| \*\*([\d.]+) s\*\* \| ([\d.]+) s \|",
        ("lines", "iyi", "go"),
    ),
    ("front_end", r"answers `hello` in \*\*([\d.]+) s\*\*", ("seconds",)),
    (
        "runtime_string",
        r"\| string building \| ([\d.]+)x \| \*\*([\d.]+)x\*\* \|",
        ("as_it_runs", "gc_off"),
    ),
    (
        "runtime_hash",
        r"\| hash insert and read \| ([\d.]+)x \| ([\d.]+)x \|",
        ("as_it_runs", "gc_off"),
    ),
    (
        "runtime_array",
        r"\| array append and read \| ([\d.]+)x \| ([\d.]+)x \|",
        ("as_it_runs", "gc_off"),
    ),
    (
        "runtime_arithmetic",
        r"\| arithmetic \| ([\d.]+)x \| ([\d.]+)x \|",
        ("as_it_runs", "gc_off"),
    ),
    (
        "prelude_vs_crystal",
        r"([\d,]+) lines of Crystal's standard library instead of ([\d,]+)",
        ("crystal", "iyi"),
    ),
]

# Which command prints each recorded group, quoted from README.md's own
# attribution of it. The site shows this beside the number.
COMMANDS: dict[str, str] = {
    "edit_loop": "python3 bench/incremental.py",
    "edit_loop_sessions": "python3 bench/incremental.py",
    "edit_loop_ratio": "python3 bench/incremental.py",
    "hello_binary": "python3 bench/machine_probe.py",
    "crystal_binary": "python3 bench/machine_probe.py",
    "full_build": "python3 bench/build_speed.py",
    "hello_build": "python3 bench/build_speed.py",
    "front_end": "python3 bench/build_speed.py",
    "runtime_string": "python3 bench/runtime.py",
    "runtime_hash": "python3 bench/runtime.py",
    "runtime_array": "python3 bench/runtime.py",
    "runtime_arithmetic": "python3 bench/runtime.py",
}

# Binary sizes and start times are quoted against a different machine from the
# edit loop, and README.md says which: "a plain `iyi build`, no flags, on macOS
# arm64 with LLVM 22". Attaching the wrong box to a number would be worse than
# attaching none, so the two are kept apart.
MACHINES: dict[str, str] = {
    "hello_binary": "macOS arm64, LLVM 22",
    "crystal_binary": "macOS arm64, LLVM 22",
}


def recorded(readme: str) -> tuple[dict, list[str]]:
    text = flat(readme)
    out: dict = {}
    missing: list[str] = []
    for key, pattern, names in RECORDED_PATTERNS:
        m = re.search(pattern, text)
        if not m:
            missing.append(
                f"{key}: /{pattern}/ no longer matches README.md. The sentence "
                f"this quoted was reworded or removed, so the site would be "
                f"publishing a number nobody is maintaining"
            )
            continue
        out[key] = dict(zip(names, m.groups()))
    return out, missing


def sessions(raw: dict) -> list[dict[str, float]]:
    """Every session README.md publishes for the edit loop, not just the best.

    The spread is the point. README.md prints three readings and says to read
    the columns against each other because they pay the same machine together,
    so the site draws all three and leads with the ratio they agree on.
    """
    rows = []
    for slot in ("a", "b", "tired"):
        iyi, crystal, go = (float(v) for v in raw[slot].split(" / "))
        rows.append({"iyi": iyi, "crystal": crystal, "go": go})
    return rows


def build() -> tuple[dict, list[str]]:
    readme = (REPO / "README.md").read_text()
    raw, missing = recorded(readme)
    if missing:
        return {}, missing

    default_machine = raw["machine"]["name"]
    loop = sessions(raw["edit_loop_sessions"])
    ratios = [round(s["crystal"] / s["iyi"], 2) for s in loop]

    facts = {
        # Both are counted, both are the same on any full clone, so both are
        # structural and render flat. `project()` refuses a shallow clone.
        "structural": {**measured(), **project()},
        "recorded": {
            "edit_loop": {
                # The claim, which is machine-independent and held across every
                # session README.md publishes.
                "claim": {
                    "kind": "ratio",
                    "value": float(raw["edit_loop_ratio"]["times"]),
                    "unit": "x",
                    "against": "crystal",
                    "sense": "less",
                },
                "best": {k: float(v) for k, v in raw["edit_loop"].items()},
                "sessions": loop,
                "ratios": ratios,
                # The commands as bench/incremental.py runs them, so the chart
                # labels its rows from the same record as its bars. `…` is
                # `--use-iyimod mods --emit-iyimod mods`, elided the way the
                # bench elides it rather than dropped, because a picture that
                # hid the flags would claim an ergonomics this does not have.
                "series": [
                    {"key": "iyi", "label": "iyi build … -o app main.iyi"},
                    {"key": "crystal", "label": "crystal build -o app main.cr"},
                    {"key": "go", "label": "go build -o app ."},
                ],
                "unit": "s",
                "machine": default_machine,
                "command": COMMANDS["edit_loop"],
                "subject": "one line changed in one of 30 modules",
            },
            "hello_binary": {
                "iyi": {
                    "kb": int(raw["hello_binary"]["kb"].replace(",", "")),
                    "ms": float(raw["hello_binary"]["ms"]),
                },
                "crystal": {
                    "kb": int(raw["crystal_binary"]["kb"].replace(",", "")),
                    "ms": float(raw["crystal_binary"]["ms"]),
                },
                "machine": MACHINES["hello_binary"],
                "command": COMMANDS["hello_binary"],
                "subject": 'puts "hello"',
            },
            "full_build": {
                "lines": int(raw["full_build"]["lines"].replace(",", "")),
                "iyi": float(raw["full_build"]["iyi"]),
                "go": float(raw["full_build"]["go"]),
                "unit": "s",
                "machine": default_machine,
                "command": COMMANDS["full_build"],
                "subject": "a full build from scratch, the row iyi loses",
            },
            "runtime": {
                "rows": [
                    {
                        "workload": label,
                        "as_it_runs": float(raw[key]["as_it_runs"]),
                        "gc_off": float(raw[key]["gc_off"]),
                    }
                    for label, key in (
                        ("arithmetic", "runtime_arithmetic"),
                        ("array append and read", "runtime_array"),
                        ("hash insert and read", "runtime_hash"),
                        ("string building", "runtime_string"),
                    )
                ],
                "unit": "x",
                "note": "under 1.00 is iyi ahead",
                "machine": default_machine,
                "command": COMMANDS["runtime_string"],
                "subject": "the same program under both libraries",
            },
            "library_size": {
                "iyi": int(raw["prelude_vs_crystal"]["iyi"].replace(",", "")),
                "crystal": int(raw["prelude_vs_crystal"]["crystal"].replace(",", "")),
                "unit": "lines",
                "machine": None,
                "command": "python3 bench/doc_numbers.py",
                "subject": "what a program has",
            },
        },
        "provenance": {
            "structural_source": "bench/doc_numbers.py measured(), and git",
            "recorded_source": "README.md, parsed",
            "generator": "bench/site_facts.py",
        },
    }
    return facts, []


def main() -> int:
    facts, missing = build()
    if missing:
        print("bench/site_facts.py: the site's numbers lost their source\n")
        for line in missing:
            print(f"  {line}")
        print(
            "\nFix the pattern or the sentence. Do not type the number into the "
            "site: a transcribed figure is the artifact this project argues "
            "against, and two of them were already stale when this was written."
        )
        return 1

    if "--check" in sys.argv:
        n = len(facts["structural"]) + len(facts["recorded"])
        print(f"bench/site_facts.py: {n} fact groups, every pattern still matching")
        return 0

    print(json.dumps(facts, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
