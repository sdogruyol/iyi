"""The resident-set probe, driven: `bench/resident_probe.iyi` built once per
prelude tree given, run interleaved and pinned, and read three ways - the
kernel's peak RSS (`wait4`'s `ru_maxrss`, per process, not the cumulative
`RUSAGE_CHILDREN`), the program's own account of the pages its arenas
touched, and the sweep's page counters.

    python3 bench/resident_probe.py                 # this tree
    python3 bench/resident_probe.py --tree /path/to/other/src  --runs 5

With `--tree`, the other prelude is built beside this one (IYI_PATH) and
the two binaries alternate, so a number is a min-of-N against its
neighbour under the same load, not a run of one against a run of the
other an hour apart. Cores: `--cores 0-3,10-13` by default, the fast
ones on the machine the numbers were read on; pass your own.
"""

import argparse
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time

REPO = pathlib.Path(__file__).resolve().parent.parent
IYI = REPO / "bin" / "iyi"
SOURCE = REPO / "bench" / "resident_probe.iyi"


def build(output: pathlib.Path, tree: pathlib.Path | None) -> None:
    env = dict(os.environ)
    if tree is not None:
        env["IYI_PATH"] = f"{tree}:{REPO / 'src'}"
    command = [str(IYI), "build", "--release", "-o", str(output), str(SOURCE)]
    result = subprocess.run(command, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        raise SystemExit(f"build failed for {output.name}:\n{result.stderr[:1200]}")


def run_once(binary: pathlib.Path, cores: str | None) -> tuple[float, int, str]:
    argv = [str(binary)]
    if cores:
        argv = ["taskset", "-c", cores, *argv]
    read_out, write_out = os.pipe()
    start = time.perf_counter()
    pid = os.fork()
    if pid == 0:
        os.dup2(write_out, 1)
        os.close(read_out)
        os.close(write_out)
        os.execvp(argv[0], argv)
    os.close(write_out)
    chunks = []
    while True:
        piece = os.read(read_out, 65536)
        if not piece:
            break
        chunks.append(piece)
    os.close(read_out)
    _, status, rusage = os.wait4(pid, 0)
    elapsed = time.perf_counter() - start
    code = os.waitstatus_to_exitcode(status)
    text = b"".join(chunks).decode()
    if code != 0:
        raise SystemExit(f"{binary.name} exited {code}\n{text}")
    peak = rusage.ru_maxrss
    if sys.platform == "darwin":
        peak //= 1024
    return elapsed, peak, text


def field(text: str, name: str) -> int:
    found = re.search(rf"\b{name}=(\d+)", text)
    if not found:
        raise SystemExit(f"the probe printed no {name}:\n{text}")
    return int(found.group(1))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tree", type=pathlib.Path, help="another prelude tree (its src/) to build beside this one")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--cores", default="0-3,10-13")
    args = parser.parse_args()
    if sys.platform != "linux":
        args.cores = None

    with tempfile.TemporaryDirectory() as work:
        work = pathlib.Path(work)
        binaries = {"this": work / "this"}
        build(binaries["this"], None)
        if args.tree:
            binaries["other"] = work / "other"
            build(binaries["other"], args.tree.resolve())
        rows: dict[str, dict] = {label: {"wall": [], "rss": [], "touched": [], "text": ""} for label in binaries}
        for _ in range(args.runs):
            for label, binary in binaries.items():
                elapsed, peak, text = run_once(binary, args.cores)
                row = rows[label]
                row["wall"].append(elapsed)
                row["rss"].append(peak)
                row["touched"].append(field(text, "touched_bytes"))
                row["text"] = text
        for label, row in rows.items():
            rss = sorted(row["rss"])
            touched = sorted(row["touched"])
            print(f"== {label}: wall {min(row['wall']) * 1000:.0f} ms (min of {args.runs}); "
                  f"peak RSS min {rss[0] / 1024:.0f} / median {rss[len(rss) // 2] / 1024:.0f} / max {rss[-1] / 1024:.0f} MB; "
                  f"touched min {touched[0] / 1048576:.0f} / median {touched[len(touched) // 2] / 1048576:.0f} / max {touched[-1] / 1048576:.0f} MB")
            for line in row["text"].strip().splitlines():
                if "touched_bytes=" not in line and not line.startswith("  arena"):
                    print(f"   {line}")


if __name__ == "__main__":
    main()
