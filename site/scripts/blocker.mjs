#!/usr/bin/env node
// The gate over the playground's own reason to exist.
//
// THE PROBLEM THIS SOLVES, and it is the gap the site had. Every number on this
// site is generated from the tree, and `bench/doc_numbers.py` already fails CI
// when a figure in the prose drifts from what the tree measures. Prose CLAIMS
// had no such gate. The playground is parked on exactly one of them:
//
//     On wasm32, raise prints and exits instead of unwinding. iyi's compiler
//     reports every error by raising, so a compiler compiled for a browser
//     cannot hand a diagnostic back to whatever called it. It can only die.
//
// That sentence is the entire justification for a coming-soon page where an
// interactive playground should be. The moment it stops being true, the site is
// publishing a blocker that does not exist, which is the drift the whole
// publication is arranged to refuse and would be its first false sentence.
//
// So the claim is gated against its own falsifier. `bench/wasm_exceptions.sh`
// compiles `begin`/`rescue` for wasm32-wasi, runs it under `node:wasi` on V8,
// and compares what it prints with a native run. If that script says rescue
// works, the sentence above is wrong.
//
// ============================================================================
// WHAT THIS GATE SEES, AND WHAT IT DOES NOT. Read this before trusting it.
//
// IT DOES NOT READ AN EXIT STATUS, and that is the most important line in this
// file. `bench/wasm_exceptions.sh` exits 0 in two completely different cases:
// when rescue works, and when the toolchain is absent so it could not answer at
// all. It says which in its output, printing `skipped:` for the second. A gate
// that read the status would treat "we could not check" as "the blocker is
// cleared" on every machine without wasi-sdk, which is every machine that
// builds this site. So this reads the output and treats a skip as no answer.
//
// IT CANNOT RUN THE SCRIPT IN CI. The Pages build has node and python and no
// compiler and no wasi sysroot, so the script can only ever skip there. That is
// why the presence of the script is itself a trigger: when the falsifier lands
// in the tree, this build demands an answer rather than assuming one.
//
// IT DOES NOT VERIFY THE COMPILER. It verifies what the tree says about the
// compiler. A record whose provenance is a lie would pass, exactly as every
// other record on this site would.
//
// IT DOES NOT CHECK THAT THE REWRITTEN COPY IS ANY GOOD. It checks that the
// stale sentence is gone. Whoever clears the blocker still has to write the
// page, and this only stops them forgetting.
// ============================================================================

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");
const repo = resolve(site, "..");

/** The falsifier. Its presence in the tree is the trigger for this gate. */
const FALSIFIER = "bench/wasm_exceptions.sh";

/**
 * The record a machine with the toolchain writes so a machine without one can
 * still be held to the answer.
 *
 * Shaped like every other record under `site/records/`: a `recorded` block
 * naming the compiler, the commit, the box and the command, and the result. The
 * compiler workstream emits it; this build only ever verifies it.
 *
 *   {
 *     "recorded": { "compiler": "...", "commit": "...", "machine": "...",
 *                   "command": "bash bench/wasm_exceptions.sh", "when": "..." },
 *     "rescueWorks": true,
 *     "nativeStdout": "before\nrescued: boom\nafter\n",
 *     "wasmStdout": "before\nrescued: boom\nafter\n",
 *     "imports": ["wasi_snapshot_preview1"]
 *   }
 */
const RECORD = "site/records/wasm-exceptions.json";

/**
 * The claim, as the pages actually write it.
 *
 * Several phrasings because the same fact is stated in a page's voice, in an
 * engine's caveat list and in a document's prose, and a gate that knew only one
 * of them would go quiet the first time somebody rewrote a sentence. Each entry
 * is a substring with the markup taken out, so a `<code>` wrapper around
 * `wasm32` does not hide the claim from the check.
 */
const CLAIM = [
  "prints and exits instead of unwinding",
  "does not unwind",
  "raise on wasm32 does not unwind",
  "could only die",
  "It can only die",
  "it could only die",
];

/** Where the claim is allowed to live, so the scan covers authored copy only. */
const AUTHORED = [
  join(site, "src"),
  join(repo, "doc", "website"),
];

const SKIP_DIRS = new Set(["generated", "node_modules", "screenshots"]);
const READ = /\.(astro|ts|mdx|md)$/;

function authoredFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...authoredFiles(path));
    else if (READ.test(name)) found.push(path);
  }
  return found;
}

/** Every place the claim is currently made, as `path:line`. */
function claimSites() {
  const sites = [];
  for (const root of AUTHORED) {
    if (!existsSync(root)) continue;
    for (const file of authoredFiles(root)) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (const [index, line] of lines.entries()) {
        /* Markup out, so `<code>raise</code> on <code>wasm32</code> does not
         * unwind` reads as one sentence to this check. */
        const plain = line.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
        if (CLAIM.some((phrase) => plain.includes(phrase))) {
          sites.push(`${relative(repo, file)}:${index + 1}`);
        }
      }
    }
  }
  return sites;
}

/**
 * Ask the falsifier, and report which of the three answers it gave.
 *
 * `cleared` means it ran and rescue worked. `stands` means it ran and rescue did
 * not. `unanswered` means it could not run, which is not an answer and must
 * never be read as one.
 */
function askFalsifier() {
  const script = join(repo, FALSIFIER);
  if (!existsSync(script)) return { verdict: "absent", detail: null };

  let output;
  let failed = false;
  try {
    output = execFileSync("bash", [script], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10 * 60 * 1000,
    });
  } catch (error) {
    failed = true;
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }

  /* The skip is the trap. The script exits 0 when it cannot answer, so the
   * word it prints is the only thing that separates "rescue works" from "this
   * machine has no wasi-sdk". */
  if (/^\s*skipped:/m.test(output)) {
    return { verdict: "unanswered", detail: output.trim().split("\n")[0] };
  }
  if (failed) return { verdict: "stands", detail: output.trim().slice(0, 400) };

  /* Both lines, because either alone is a weaker claim than the script makes:
   * one says the two runs agree, the other says the module is self contained. */
  const agrees = /same output natively and on wasm32-wasi/.test(output);
  const selfContained = /imports only wasi_snapshot_preview1/.test(output);
  if (agrees && selfContained) {
    return { verdict: "cleared", detail: output.trim().slice(0, 400) };
  }
  return { verdict: "stands", detail: output.trim().slice(0, 400) };
}

/** The committed record, for a build that cannot run anything. */
function askRecord() {
  const path = join(repo, RECORD);
  if (!existsSync(path)) return { verdict: "absent", detail: null };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `blocker: ${RECORD} is not valid JSON: ${error.message}. This record is ` +
        `how a build with no compiler is held to the answer, so a record that ` +
        `cannot be read is a build failure rather than a shrug.`,
    );
  }
  for (const field of ["compiler", "commit", "machine", "command", "when"]) {
    if (!parsed?.recorded?.[field]) {
      throw new Error(
        `blocker: ${RECORD} has no "recorded.${field}". A claim about a ` +
          `compiler with no record of which compiler, which commit and which ` +
          `box is an assertion, and this site does not render assertions.`,
      );
    }
  }
  return {
    verdict: parsed.rescueWorks === true ? "cleared" : "stands",
    detail: `${RECORD}, recorded at ${parsed.recorded.commit.slice(0, 12)} on ${parsed.recorded.machine}`,
  };
}

// ---------------------------------------------------------------------------

const script = askFalsifier();
/* The record is consulted whenever the script could not answer, which is every
 * CI build, and it is also consulted when the script is absent, because a
 * record could arrive first. */
const record =
  script.verdict === "cleared" || script.verdict === "stands"
    ? { verdict: "not consulted", detail: null }
    : askRecord();

const answer =
  script.verdict === "cleared" || script.verdict === "stands"
    ? script
    : record;
const source =
  answer === script ? `${FALSIFIER}, run just now` : `${RECORD}, committed`;

const sites = claimSites();

if (answer.verdict === "cleared") {
  if (sites.length === 0) {
    console.log(
      `blocker: wasm32 exception handling works and no page claims otherwise, ` +
        `per ${source}. The playground's copy has been rewritten.`,
    );
  } else {
    throw new Error(
      `blocker: THE PLAYGROUND CLAIMS A BLOCKER THAT HAS BEEN CLEARED.\n\n` +
        `  ${source} says rescue works on wasm32-wasi:\n` +
        `${(answer.detail ?? "")
          .split("\n")
          .map((line) => `      ${line}`)
          .join("\n")}\n\n` +
        `  and ${sites.length} place${sites.length === 1 ? "" : "s"} in this ` +
        `tree still say it does not:\n` +
        sites.map((at) => `      ${at}`).join("\n") +
        `\n\nThat sentence is the whole reason /playground/ is a coming-soon ` +
        `page rather than an editor, so it is not a copy edit: the parked page ` +
        `has to be rewritten or replaced, and this build will not publish a ` +
        `blocker that no longer exists. This site fails a build when a NUMBER ` +
        `drifts from the tree; a claim gets the same treatment.\n`,
    );
  }
} else if (answer.verdict === "stands") {
  /* Deliberately does not say "rescue does not work". The falsifier answers a
   * narrower question than that: it either shows a full pass, both runs
   * agreeing AND the module importing nothing but WASI, or it does not. A
   * partial pass is not a cleared blocker and it is also not proof of the
   * cause, so this reports the falsifier's verdict rather than a diagnosis it
   * did not make. */
  console.log(
    `blocker: ${source} does not show rescue working on wasm32, so the ` +
      `playground's ${sites.length} statement${sites.length === 1 ? "" : "s"} ` +
      `of the blocker still stand`,
  );
} else if (script.verdict === "absent") {
  /* No falsifier in the tree and no record. The claim's citation is
   * `doc/website/PLAYGROUND-FEASIBILITY.md` and there is nothing here that can
   * check it, which the gate says rather than passing quietly. */
  console.log(
    `blocker: ${FALSIFIER} is not in this tree and ${RECORD} is not either, so ` +
      `nothing here can check the playground's ${sites.length} statements ` +
      `that raise does not unwind on wasm32. They stand on ` +
      `doc/website/PLAYGROUND-FEASIBILITY.md. This gate starts answering the ` +
      `moment either one lands.`,
  );
} else {
  /* The falsifier is here and could not run, and no record answered for it.
   * This is the state that must fail, because it is the state a merge of the
   * compiler work produces: the falsifier arrives, this build cannot run it,
   * and nobody has committed the answer. Passing here would let the drift
   * through on exactly the build that was meant to catch it. */
  throw new Error(
    `blocker: ${FALSIFIER} IS IN THIS TREE AND NOTHING HAS ANSWERED IT.\n\n` +
      `  This build cannot run it: ${script.detail ?? "no reason given"}\n` +
      `  and ${RECORD} is not committed.\n\n` +
      `  That script is the falsifier for the sentence the parked playground ` +
      `is built on, and it is in the tree, which means the work to clear the ` +
      `blocker has landed. ${sites.length} place${sites.length === 1 ? "" : "s"} ` +
      `in this tree still state the blocker:\n` +
      sites.map((at) => `      ${at}`).join("\n") +
      `\n\n  Do one of two things. Run \`bash ${FALSIFIER}\` on a machine with ` +
      `a built compiler and a wasi-sdk sysroot and commit its answer as ` +
      `${RECORD}, or rewrite the pages so they no longer make the claim. ` +
      `Passing this build without either would publish a blocker nobody ` +
      `checked, on the one page whose entire purpose is that blocker.\n`,
  );
}
