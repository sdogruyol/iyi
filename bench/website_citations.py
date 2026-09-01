#!/usr/bin/env python3
"""Every repository path the website documents cite has to resolve.

    python3 bench/website_citations.py            # check
    python3 bench/website_citations.py --list     # every citation found

The website documents are an argument made out of citations: the art
direction points at the stylesheet that carries a colour, the stack document
points at the script that generates a number, and the feasibility report points
at the compiler line that stops a browser from type checking. A path that does
not resolve is the same defect as a transcribed number. It reads as evidence,
it is checkable, and it is wrong, and the reader who checks it is exactly the
reader this project is written for.

This gate is deliberately narrow, for the reason doc_numbers.py states about
itself: a check that flags everything gets disabled, and a disabled check is
worse than none. A token is treated as a repository path only when it is
unambiguous:

  * it has a slash, its first segment is a real top-level entry of this
    repository, and its last segment carries a file extension, or
  * it is one of the repository's root documents, named without a slash.

That leaves module names like `samples/hello`, C symbols like
`wasi_snapshot_preview1.fd_write`, artifacts like `crt1-command.o` and
hostnames like `tour.gleam.run` alone, because none of them is a claim about
a file in this tree.

A citation may carry a line number (`src/raise.cr:240`) or a range
(`src/raise.cr:240-245`), and it may end in a glob (`src/compiler/iyi/*`).
Both are resolved to the thing on disk that has to exist.
"""

from __future__ import annotations

import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
DOCS = sorted((REPO / "doc" / "website").glob("*.md"))

# Root documents that are cited by name, with no directory in front of them.
ROOT_DOCS = {
    "README.md",
    "SPEC.md",
    "CHANGELOG.md",
    "GC_DESIGN.md",
    "Makefile",
}

EXTENSIONS = {
    ".md", ".cr", ".iyi", ".iyimod", ".py", ".sh", ".json", ".mjs", ".ts",
    ".astro", ".mdx", ".css", ".yml", ".yaml", ".svg", ".png", ".txt", ".toml",
    ".lock", ".wasm", ".html", ".o",
}

# A candidate inside backticks, inside a markdown link, or bare in prose.
CANDIDATE = re.compile(r"`([^`\n]+)`|\]\(([^)\s]+)\)")

# Trailing punctuation a sentence leaves on a path.
TRAILING = ".,;:!?)"


def top_level() -> set[str]:
    return {p.name for p in REPO.iterdir() if not p.name.startswith(".git")}


TOPS = top_level()


def candidates(text: str):
    for match in CANDIDATE.finditer(text):
        raw = match.group(1) or match.group(2) or ""
        for token in raw.split():
            yield token.strip(TRAILING)


def as_path(token: str) -> str | None:
    """The repository path this token claims, or None if it claims none."""
    if token.startswith(("http://", "https://", "#", "mailto:")):
        return None

    # `src/raise.cr:240` and `src/raise.cr:240-245` cite lines in a file.
    token = re.sub(r":\d+(-\d+)?$", "", token)
    if not token or token.startswith("-"):
        return None

    # A glob cites whatever the tree holds under it, so it resolves when the
    # pattern matches at least one file. `src/compiler/iyi/*` and
    # `src/iyi/*.iyi` are both citations a reader can check.
    if "*" in token:
        return token if token.split("/")[0] in TOPS else None

    if "/" not in token:
        return token if token in ROOT_DOCS else None

    if token.split("/")[0] not in TOPS:
        return None
    if pathlib.PurePosixPath(token).suffix not in EXTENSIONS:
        # A directory citation resolves only if the directory is really there;
        # anything else with no extension is a module name, not a path.
        return token if (REPO / token).is_dir() else None
    return token


def main() -> int:
    show_all = "--list" in sys.argv
    if not DOCS:
        print("bench/website_citations.py: no documents under doc/website")
        return 1

    seen: dict[str, list[tuple[str, int]]] = {}
    for doc in DOCS:
        rel_doc = doc.relative_to(REPO).as_posix()
        for n, line in enumerate(doc.read_text().splitlines(), 1):
            for token in candidates(line):
                path = as_path(token)
                if path:
                    seen.setdefault(path, []).append((rel_doc, n))

    def ignored(path: str) -> bool:
        """Is this path declared build output?

        A citation can name something the build writes rather than something
        the tree carries, and `site/src/generated/facts.json` is the case that
        found this: it exists on a machine that has built the site and nowhere
        else, so checking for the file passed locally and failed in CI. A
        `.gitignore` entry is a committed, reviewed declaration that a path is
        output, so that is what the citation is resolved against instead.
        """
        return (
            subprocess.run(
                ["git", "-c", "safe.directory=*", "check-ignore", "-q", path],
                cwd=REPO,
                capture_output=True,
            ).returncode
            == 0
        )

    def resolves(path: str) -> bool:
        if "*" in path:
            return any(REPO.glob(path))
        return (REPO / path).exists() or ignored(path)

    missing = {p: w for p, w in seen.items() if not resolves(p)}

    if show_all:
        for path in sorted(seen):
            where = ", ".join(f"{d}:{n}" for d, n in seen[path][:3])
            mark = "GONE" if path in missing else "ok  "
            print(f"{mark}  {path}  ({where})")
        print()

    if missing:
        print("A WEBSITE DOCUMENT CITES SOMETHING THAT IS NOT THERE")
        print()
        for path in sorted(missing):
            for doc, n in missing[path]:
                print(f"  {doc}:{n}  cites  {path}")
        print()
        print(
            "These documents argue by citation, so a path that does not resolve\n"
            "is a claim with no evidence behind it, which is the same defect as\n"
            "a transcribed number. Follow the file if it moved, or drop the\n"
            "citation if the claim no longer stands."
        )
        return 1

    print(
        f"website citations: {len(seen)} paths cited across {len(DOCS)} documents, "
        "every one resolves"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
