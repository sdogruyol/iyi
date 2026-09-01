#!/usr/bin/env node
// Runs the repository's own measurement and writes it where the site can import
// it. This is the only way a number reaches a page. If it fails, the site does
// not build, which is deliberate: a page with a missing figure is worse than no
// page, and a page with a stale figure is worse than both.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const out = resolve(here, "..", "src", "generated");

let raw;
try {
  raw = execFileSync("python3", [resolve(repo, "bench", "site_facts.py")], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
} catch (error) {
  const detail = error.stdout || error.stderr || error.message;
  throw new Error(
    `bench/site_facts.py failed, so the site has no numbers to print:\n\n${detail}`,
  );
}

const facts = JSON.parse(raw);

// The site is allowed to print a recorded number only when the record says
// which machine produced it and which command prints it. Enforced here rather
// than trusted, because the whole argument of this site is that a number
// without its provenance is not a number.
for (const [key, group] of Object.entries(facts.recorded)) {
  if (!group.command) {
    throw new Error(`recorded fact "${key}" has no command that prints it`);
  }
  if (!("machine" in group)) {
    throw new Error(
      `recorded fact "${key}" does not say what machine it was measured on. ` +
        `README.md is careful that these seconds are a machine and not a ` +
        `language, and the site has to be too.`,
    );
  }
}

const commit = (() => {
  try {
    return execFileSync("git", ["-C", repo, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    throw new Error("cannot read the commit these numbers were measured at");
  }
})();

facts.provenance.commit = commit;

mkdirSync(out, { recursive: true });
writeFileSync(
  resolve(out, "facts.json"),
  `${JSON.stringify(facts, null, 2)}\n`,
  "utf8",
);

const structural = Object.keys(facts.structural).length;
const recorded = Object.keys(facts.recorded).length;
console.log(
  `facts: ${structural} structural, ${recorded} recorded, at ${commit}`,
);
