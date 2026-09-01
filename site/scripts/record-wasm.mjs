#!/usr/bin/env node
// Records what the real compiler does with every curated sample on
// wasm32-wasi: cross-compile, link with wasi-sdk, run the linked module under
// node:wasi, run the same sample natively, compare the two outputs byte for
// byte.
//
// This runs on a machine with the toolchain, never in the Pages build. The
// build only verifies what this wrote (see records.mjs), because GitHub's
// runner has no iyi compiler and no wasi-sdk, and a page that invents a byte
// count is worse than a page that fails to build.
//
// What each field of a manifest entry means, because two of them could be
// read either way. `bytes` and `sha256` are the linked module beside the
// manifest, not the compiler's unlinked object. `exitCode` is the wasm run's,
// since that is the run the record exists to describe; a sample whose native
// run is not clean fails this script instead of reaching the manifest.
// `sourceSha256` is the other file entirely: the sample's own text at `path`,
// hashed as it sat on disk when this ran.
//
// That last field is here for the playground. The editor has to decide
// whether the text in front of the visitor is still the program that was
// recorded or something they changed, because an unedited curated sample can
// run straight from its recorded module while edited text has to go to the
// compile service. The only copy of the recorded text the client can reach is
// site/records/highlight.json, which is roughly a quarter of a megabyte of
// listings; importing that into an engine to answer one yes-or-no question
// would ship all of it to every visitor. A digest is a few dozen bytes and
// answers the same question. It doubles as a staleness gate: a sample edited
// since this ran no longer matches its own recorded module either, and
// records.mjs says so by name.
//
// Regenerate with: npm run record:wasm

import { execFileSync, spawnSync } from "node:child_process";
import {
  createHash,
} from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");
const repo = resolve(site, "..");
const samplesDir = resolve(repo, "samples", "iyi");
const out = resolve(site, "records", "wasm");

// A sample whose wasm run does not match its native run needs a sentence
// saying why, and the sentence is prose so it is written here rather than
// guessed at. The script fails if a mismatch has no note, and fails if a note
// describes a sample that now matches, so this table cannot go stale quietly.
const NOTES = {
  files:
    "The wasm build refuses File at run time by design: src/iyi/prelude.iyi " +
    "panics with \"File is not available on wasm32-wasi: path_open needs a " +
    "preopened directory fd\", because a WASI module reaches the filesystem " +
    "only through directory handles the host granted it, and this module " +
    "asks for none.",
};

// ---------------------------------------------------------------------------
// Toolchain
// ---------------------------------------------------------------------------

// The compiler that measures this is the one in the tree, or one named
// explicitly. There is no third possibility: a record produced by an unknown
// compiler is not a record.
const buildDir = process.env.IYI_BUILD
  ? resolve(process.env.IYI_BUILD)
  : resolve(repo, ".build");
const iyi = join(buildDir, "iyi");
if (!existsSync(iyi)) {
  throw new Error(
    `no iyi compiler at ${iyi}. Build it, or set IYI_BUILD to the ` +
      `directory holding the iyi and crystal binaries.`,
  );
}

// wasi-sdk provides the only linker that turns the compiler's unlinked module
// into a loadable one, and the one that answered is printed, because a record
// whose linker is unknown is not a record.
//
// An explicit setting is binding rather than preferred. Treating WASI_CLANG as
// the first entry in a search list meant that pointing it at the wrong path
// silently linked with whatever was found next, and the record would then
// attribute its bytes to a linker the operator did not choose. So a setting
// that does not resolve is refused by name, and only the unset case searches.
const clang = (() => {
  if (process.env.WASI_CLANG) {
    const named = process.env.WASI_CLANG;
    if (!existsSync(named)) {
      throw new Error(
        `WASI_CLANG is set to ${named}, which is not there. Fix it or unset ` +
          `it; this script will not quietly link with a different clang than ` +
          `the one you named.`,
      );
    }
    return named;
  }
  if (process.env.WASI_SDK) {
    const named = join(process.env.WASI_SDK, "bin", "clang");
    if (!existsSync(named)) {
      throw new Error(
        `WASI_SDK is set to ${process.env.WASI_SDK}, which has no ` +
          `bin/clang. Fix it or unset it; this script will not quietly link ` +
          `with a different wasi-sdk than the one you named.`,
      );
    }
    return named;
  }
  const searched = [
    "/opt/wasi-sdk/bin/clang",
    "/usr/local/wasi-sdk/bin/clang",
    "/opt/homebrew/opt/wasi-sdk/bin/clang",
    "/tmp/wasi-sdk/bin/clang",
  ];
  const found = searched.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `no wasi-sdk clang found. Looked at:\n  ${searched.join("\n  ")}\n` +
        `Install wasi-sdk and set WASI_SDK to its root, or set WASI_CLANG to ` +
        `the clang binary.`,
    );
  }
  return found;
})();

const env = { ...process.env, IYI_PATH: resolve(repo, "src") };

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

const version = execFileSync(iyi, ["--version"], { encoding: "utf8" })
  .split("\n")[0]
  .trim();
if (!version) {
  throw new Error(`${iyi} --version printed nothing, so the record cannot say`
    + ` which compiler made it`);
}

const commit = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();

const machine = (() => {
  const uname = execFileSync("uname", ["-srm"], { encoding: "utf8" }).trim();
  // The CPU's name, asked of the platform that knows it: sysctl is darwin's
  // spelling and /proc/cpuinfo is Linux's. A record is made on either.
  const cpu = process.platform === "darwin"
    ? execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], {
        encoding: "utf8",
      }).trim()
    : readFileSync("/proc/cpuinfo", "utf8")
        .split("\n")
        .find((line) => line.startsWith("model name"))
        .split(":")[1]
        .trim();
  return `${uname}, ${cpu}`;
})();

const recorded = {
  compiler: version,
  commit,
  machine,
  command: "npm run record:wasm",
  when: new Date().toISOString(),
};
for (const [key, value] of Object.entries(recorded)) {
  if (!value) {
    throw new Error(`provenance field "${key}" came out empty`);
  }
}

// ---------------------------------------------------------------------------
// The curated set
// ---------------------------------------------------------------------------

// Discovered, not listed, so adding a sample to the repository adds it to the
// record. `hello` leads because it is the one a reader meets first; the rest
// sort so the manifest has a stable order.
const ids = readdirSync(samplesDir)
  .filter((name) => name.endsWith(".iyi"))
  .map((name) => name.slice(0, -".iyi".length))
  .sort();
if (!ids.includes("hello")) {
  throw new Error(`${samplesDir} has no hello.iyi, so the set is not the`
    + ` curated set`);
}
const order = ["hello", ...ids.filter((id) => id !== "hello")];

// ---------------------------------------------------------------------------
// The runner, written where it runs
// ---------------------------------------------------------------------------

// node:wasi writes through real file descriptors, so the module's output has
// to be captured from a child process rather than from inside this one. The
// child writes the exit code to a sidecar file, which keeps stdout exactly
// what the module printed and nothing else. node's own ExperimentalWarning
// goes to stderr and is therefore never mistaken for program output.
const RUNNER = `import { WASI } from "node:wasi";
import { readFileSync, writeFileSync } from "node:fs";

const [, , modulePath, name, codePath] = process.argv;
const wasi = new WASI({
  version: "preview1",
  args: [name],
  env: {},
  returnOnExit: true,
});
const module = await WebAssembly.compile(readFileSync(modulePath));
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
const code = wasi.start(instance);
writeFileSync(codePath, String(code));
`;

const work = mkdtempSync(join(tmpdir(), "iyi-record-wasm-"));
const runner = join(work, "run-wasi.mjs");
writeFileSync(runner, RUNNER, "utf8");

// ---------------------------------------------------------------------------
// Record each sample
// ---------------------------------------------------------------------------

const samples = [];

for (const id of order) {
  const relative = `samples/iyi/${id}.iyi`;
  const source = resolve(repo, relative);
  const dir = join(work, id);
  mkdirSync(dir, { recursive: true });

  // Step 1: cross-compile. The compiler writes an unlinked module and prints
  // the link command it would have run, which is the command this script then
  // runs with wasi-sdk's clang in place of `cc`. Taking the command from the
  // compiler rather than composing one means the flags cannot drift.
  const cross = spawnSync(
    iyi,
    [
      "build",
      "--cross-compile",
      "--target",
      "wasm32-wasi",
      "-o",
      `${id}.obj`,
      source,
    ],
    { cwd: dir, encoding: "utf8", env, maxBuffer: 32 * 1024 * 1024 },
  );
  if (cross.status !== 0) {
    throw new Error(
      `${relative} does not cross-compile for wasm32-wasi (exit ` +
        `${cross.status}):\n${cross.stderr || cross.stdout}`,
    );
  }
  const printed = cross.stdout.trim();
  if (!printed) {
    throw new Error(
      `${relative} cross-compiled without printing a link command, so there ` +
        `is nothing to link it with`,
    );
  }

  // Step 2: link, with the compiler's own argument list.
  const tokens = printed.split(/\s+/);
  if (tokens[0] !== "cc") {
    throw new Error(
      `${relative}: the compiler's link command no longer starts with "cc", ` +
        `it starts with "${tokens[0]}". Read it before trusting this script:` +
        `\n${printed}`,
    );
  }
  const dashO = tokens.indexOf("-o");
  if (dashO === -1 || !tokens[dashO + 1]) {
    throw new Error(
      `${relative}: the compiler's link command names no output:\n${printed}`,
    );
  }
  const object = tokens[1];
  if (!existsSync(join(dir, object))) {
    throw new Error(
      `${relative}: the compiler's link command reads ${object}, which it ` +
        `did not write`,
    );
  }
  const linkArgs = tokens.slice(1);
  // The linked module's own name is the only thing about it that depends on
  // where it was built, so it is linked straight to the name the record uses
  // and the recorded bytes are the bytes on disk.
  linkArgs[dashO] = `${id}.wasm`;
  const link = spawnSync(clang, linkArgs, {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (link.status !== 0) {
    throw new Error(
      `${relative} does not link for wasm32-wasi with ${clang} (exit ` +
        `${link.status}):\n${link.stderr || link.stdout}`,
    );
  }
  const linked = join(dir, `${id}.wasm`);
  if (!existsSync(linked)) {
    throw new Error(`${relative} linked without producing ${id}.wasm`);
  }

  // Step 3: run the module. A run that never reached the module at all, a
  // broken runner or a module the engine refuses, is a failure of this script
  // and is reported as one.
  //
  // `input` is empty on purpose and on both runs below. Twelve of the linked
  // modules import four WASI functions and `calc.wasm` imports a fifth,
  // `fd_read`, so stdin is reachable from the prelude and a recorder invoked
  // from a terminal would otherwise hand the two runs different input.
  const codePath = join(dir, "exit-code");
  const wasmRun = spawnSync(
    process.execPath,
    [runner, linked, id, codePath],
    {
      cwd: dir,
      encoding: "utf8",
      input: "",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (wasmRun.status !== 0) {
    throw new Error(
      `${relative}: node could not run ${id}.wasm under node:wasi (exit ` +
        `${wasmRun.status}):\n${wasmRun.stderr}`,
    );
  }
  if (!existsSync(codePath)) {
    throw new Error(
      `${relative}: the wasm run left no exit code, so it did not finish`,
    );
  }
  const exitCode = Number(readFileSync(codePath, "utf8"));
  if (!Number.isInteger(exitCode)) {
    throw new Error(
      `${relative}: the wasm run recorded "${readFileSync(codePath, "utf8")}"` +
        ` as its exit code, which is not a number`,
    );
  }
  const wasmStdout = wasmRun.stdout;

  // Step 4: run it natively, for something to compare against. Both runs
  // happen in the same directory, so a sample that touches the filesystem
  // touches the same place either way.
  const native = spawnSync(iyi, ["run", source], {
    cwd: dir,
    encoding: "utf8",
    env,
    input: "",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (native.status !== 0) {
    throw new Error(
      `${relative} does not run natively (exit ${native.status}), so there ` +
        `is nothing to compare the wasm run against:\n${native.stderr}`,
    );
  }
  const nativeStdout = native.stdout;

  const identical = wasmStdout === nativeStdout;
  const note = NOTES[id] ?? null;
  if (!identical && !note) {
    throw new Error(
      `${relative}: the wasm run and the native run print different things ` +
        `and nothing in this script says why. Add the sentence to NOTES, or ` +
        `fix the difference.`,
    );
  }
  if (identical && note) {
    throw new Error(
      `${relative}: NOTES explains a difference that no longer exists. ` +
        `Remove the note.`,
    );
  }

  const bytes = readFileSync(linked);
  // The sample's own bytes, not its text: hashing the file rather than a
  // decoded string keeps the digest identical to what `shasum -a 256` on the
  // sample prints, and to what a browser gets from hashing the editor's
  // contents encoded as UTF-8.
  const sourceBytes = readFileSync(source);
  samples.push({
    id,
    path: relative,
    sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
    wasm: `${id}.wasm`,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    exitCode,
    nativeStdout,
    wasmStdout,
    identical,
    note,
  });
}

if (samples.length !== order.length) {
  throw new Error(
    `recorded ${samples.length} samples of ${order.length}, which cannot ` +
      `happen without a hole in this script`,
  );
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

mkdirSync(out, { recursive: true });

// A module left behind by a sample that no longer exists would still verify,
// which is exactly the kind of stale evidence this pipeline exists to refuse.
const keep = new Set(samples.map((sample) => sample.wasm));
for (const name of readdirSync(out)) {
  if (name.endsWith(".wasm") && !keep.has(name)) {
    rmSync(join(out, name));
  }
}

for (const sample of samples) {
  const from = join(work, sample.id, sample.wasm);
  copyFileSync(from, join(out, sample.wasm));
  const written = statSync(join(out, sample.wasm)).size;
  if (written !== sample.bytes) {
    throw new Error(
      `${sample.wasm} is ${written} bytes where the record says ` +
        `${sample.bytes}`,
    );
  }
}

writeFileSync(
  join(out, "manifest.json"),
  `${JSON.stringify({ recorded, samples }, null, 2)}\n`,
  "utf8",
);

rmSync(work, { recursive: true, force: true });

const differing = samples.filter((sample) => !sample.identical);
const total = samples.reduce((sum, sample) => sum + sample.bytes, 0);
console.log(
  `wasm: ${samples.length} samples, ${total} bytes linked, ` +
    `${differing.length} differing from native` +
    (differing.length
      ? ` (${differing.map((sample) => sample.id).join(", ")})`
      : "") +
    `, ${clang}, at ${commit.slice(0, 9)}`,
);
