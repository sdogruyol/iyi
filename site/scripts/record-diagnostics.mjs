#!/usr/bin/env node
// Records what the real compiler says when a real program breaks a real rule.
//
// The programs under site/records/break/ are committed, deliberately broken,
// and minimal: each one breaks exactly one rule so the message it draws is
// about that rule and nothing else. This script compiles each of them and
// records the compiler's output byte for byte, with the command and the exit
// code beside it.
//
// Nothing here is written by hand. A diagnostic on the site is the compiler's
// own sentence or it is not on the site, because a paraphrased error message
// is a claim about a compiler rather than a reading of one.
//
// Regenerate with: npm run record:diagnostics

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync, readFileSync} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");
const repo = resolve(site, "..");
const breakDir = resolve(site, "records", "break");
const out = resolve(site, "records", "diagnostics.json");

// Every case, in the order a reader should meet them. `rule` is the SPEC.md
// citation the site prints in the diagnostic's footer. `expect` never reaches
// the record: it is the substring that proves the compiler drew the diagnostic
// this case claims, so a compiler whose message moves fails this script rather
// than quietly changing what the site teaches.
//
// The rule each case is filed under is the rule the compiler itself cites.
// Where the compiler names no rule, the citation is the section of SPEC.md the
// check comes from, and `expect` pins the sentence.
const CASES = [
  {
    id: "r1-import-cycle",
    rule: "R-1",
    title: "two modules that import each other",
    file: "r1_import_cycle.iyi",
    expect: "`import` forms a DAG (R-1)",
  },
  {
    id: "r2-not-exported",
    rule: "R-2",
    title: "a name the module never exported",
    file: "r2_not_exported.iyi",
    expect: "does not export 'greeting'",
  },
  {
    id: "r2-missing-return-type",
    rule: "R-2",
    title: "an exported def that does not say what it returns",
    file: "r2_missing_return_type.iyi",
    expect: "is exported and does not say what it returns",
  },
  {
    id: "r2-wrong-return-type",
    rule: "R-2",
    title: "a body that does not honour its written return type",
    file: "r2_wrong_return_type.iyi",
    expect: "must return Int32 but it is returning String",
  },
  {
    id: "r2b-using-missing",
    rule: "R-2b",
    title: "an unqualified name with no using to bring it in",
    file: "r2b_using_missing.iyi",
    expect: "this file has not written `using`",
  },
  {
    id: "r3-orphan-impl",
    rule: "R-3",
    title: "an impl in a module that owns neither the trait nor the type",
    file: "r3_orphan_impl.iyi",
    expect: "an impl must live in the module that defines the trait",
  },
  {
    id: "r3-unmet-trait-bound",
    rule: "R-3",
    title: "a type that does not implement a required trait",
    file: "r3_unmet_trait_bound.iyi",
    expect: "does not implement",
  },
  {
    id: "errors-non-exhaustive",
    rule: "III.1",
    title: "an error member left unhandled",
    file: "errors_non_exhaustive.iyi",
    expect: "case is not exhaustive",
  },
];

// ---------------------------------------------------------------------------
// Toolchain
// ---------------------------------------------------------------------------

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
  command: "npm run record:diagnostics",
  when: new Date().toISOString(),
};
for (const [key, value] of Object.entries(recorded)) {
  if (!value) {
    throw new Error(`provenance field "${key}" came out empty`);
  }
}

// ---------------------------------------------------------------------------
// Every break program is a case, and every case is a break program
// ---------------------------------------------------------------------------

// A program sitting in the directory with no case would be a broken program
// nothing renders and nothing checks, which is how a directory of dead code
// starts. The helper modules the break programs import live in break/dep/ and
// are not cases: they compile.
const programs = readdirSync(breakDir)
  .filter((name) => name.endsWith(".iyi"))
  .sort();
const claimed = new Set(CASES.map((entry) => entry.file));
for (const name of programs) {
  if (!claimed.has(name)) {
    throw new Error(
      `site/records/break/${name} is a broken program with no case in this ` +
        `script, so nothing renders it and nothing checks it`,
    );
  }
}
for (const entry of CASES) {
  if (!programs.includes(entry.file)) {
    throw new Error(
      `case "${entry.id}" names site/records/break/${entry.file}, which is ` +
        `not there`,
    );
  }
}
const ids = new Set();
for (const entry of CASES) {
  if (ids.has(entry.id)) {
    throw new Error(`two cases share the id "${entry.id}"`);
  }
  ids.add(entry.id);
}

// ---------------------------------------------------------------------------
// Compile each one and keep what the compiler said
// ---------------------------------------------------------------------------

const cases = [];

for (const entry of CASES) {
  const relative = `site/records/break/${entry.file}`;
  const args = ["build", "--no-codegen", "--no-color", relative];

  // The compiler is written by name rather than by path: the path is per
  // machine and `recorded.compiler` already pins the exact build. Everything
  // else in this string is the argument list that ran, in order.
  const command = `IYI_PATH=src iyi ${args.join(" ")}`;

  const run = spawnSync(iyi, args, {
    cwd: repo,
    encoding: "utf8",
    env,
    maxBuffer: 32 * 1024 * 1024,
  });

  if (run.error) {
    throw new Error(`could not run the compiler on ${relative}: `
      + `${run.error.message}`);
  }
  if (run.status === 0) {
    throw new Error(
      `${relative} compiles. It is supposed to break ${entry.rule}, so ` +
        `either the program is wrong or the rule is no longer enforced. ` +
        `There is no third answer and this script will not record a case ` +
        `with no diagnostic in it.`,
    );
  }
  if (run.status === null) {
    throw new Error(
      `the compiler was killed by ${run.signal} on ${relative}, so its ` +
        `output is not a diagnostic`,
    );
  }
  const stderr = run.stderr;
  if (!stderr) {
    throw new Error(
      `${relative} failed with exit ${run.status} and printed nothing to ` +
        `stderr, so there is no diagnostic to record`,
    );
  }
  if (!stderr.includes(entry.expect)) {
    throw new Error(
      `${relative} does not draw the diagnostic case "${entry.id}" claims. ` +
        `Expected the message to contain:\n  ${entry.expect}\nIt said:\n` +
        `${stderr}`,
    );
  }
  if (!stderr.includes("^")) {
    throw new Error(
      `${relative}: the compiler's output has no caret line, so the site ` +
        `would be rendering a diagnostic with the part that points at the ` +
        `mistake missing:\n${stderr}`,
    );
  }

  cases.push({
    id: entry.id,
    rule: entry.rule,
    title: entry.title,
    path: relative,
    command,
    exitCode: run.status,
    stderr,
  });
}

if (cases.length !== CASES.length) {
  throw new Error(
    `recorded ${cases.length} cases of ${CASES.length}, which cannot happen ` +
      `without a hole in this script`,
  );
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ recorded, cases }, null, 2)}\n`, "utf8");

const rules = [...new Set(cases.map((entry) => entry.rule))].join(", ");
console.log(
  `diagnostics: ${cases.length} cases over ${rules}, at ` +
    `${commit.slice(0, 9)}`,
);
