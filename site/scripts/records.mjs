#!/usr/bin/env node
// The build-time gate over the committed records.
//
// The three records under site/records/ are produced by scripts that need the
// iyi compiler and wasi-sdk. The Pages build has neither, so it cannot make
// them and must not pretend to: this script only verifies what is committed,
// and fails the build naming the file when a record is missing, stale by
// checksum, or short of provenance. Then it copies the linked modules into
// site/public/wasm/ so the site can serve them.
//
// Every check here is a check the good records pass and a corrupted record
// fails. A gate that cannot fail is not a gate, and this pipeline is the
// argument that the site cannot drift from the tree.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");
const repo = resolve(site, "..");
const records = resolve(site, "records");
const publicWasm = resolve(site, "public", "wasm");

const PROVENANCE = ["compiler", "commit", "machine", "command", "when"];

const problems = [];
function problem(file, message) {
  problems.push(`${file}: ${message}`);
}

// A record that will not parse cannot be checked field by field, so the whole
// file is one problem and the checks that would have read it are skipped.
function load(file) {
  const path = join(records, file);
  if (!existsSync(path)) {
    problem(
      `site/records/${file}`,
      `is not there. Regenerate it on a machine with the toolchain; the ` +
        `Pages build cannot make it.`,
    );
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    problem(`site/records/${file}`, `is not valid JSON: ${error.message}`);
    return null;
  }
  return parsed;
}

// Provenance is the whole reason a recorded number is allowed on a page: it
// says which compiler, which commit, which box, and which command. A record
// missing any of the five is a number without a machine.
function checkProvenance(file, record) {
  const recorded = record.recorded;
  if (!recorded || typeof recorded !== "object") {
    problem(`site/records/${file}`, `has no "recorded" provenance object`);
    return;
  }
  for (const field of PROVENANCE) {
    const value = recorded[field];
    if (typeof value !== "string" || value.trim() === "") {
      problem(
        `site/records/${file}`,
        `provenance field "${field}" is empty, so the record cannot say ` +
          `where it came from`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// wasm/manifest.json
// ---------------------------------------------------------------------------

const manifest = load(join("wasm", "manifest.json"));
const wasmFiles = [];

if (manifest) {
  const file = "site/records/wasm/manifest.json";
  checkProvenance(join("wasm", "manifest.json"), manifest);

  if (!Array.isArray(manifest.samples) || manifest.samples.length === 0) {
    problem(file, `lists no samples`);
  } else {
    const seen = new Set();
    for (const sample of manifest.samples) {
      const id = sample.id;
      if (typeof id !== "string" || id === "") {
        problem(file, `has a sample with no id`);
        continue;
      }
      if (seen.has(id)) {
        problem(file, `lists "${id}" twice`);
      }
      seen.add(id);

      for (const field of ["path", "wasm"]) {
        if (typeof sample[field] !== "string" || sample[field] === "") {
          problem(file, `sample "${id}" has no ${field}`);
        }
      }
      if (typeof sample.exitCode !== "number") {
        problem(file, `sample "${id}" records no exit code`);
      }
      if (typeof sample.identical !== "boolean") {
        problem(
          file,
          `sample "${id}" does not say whether the two runs agreed`,
        );
      }
      for (const field of ["nativeStdout", "wasmStdout"]) {
        if (typeof sample[field] !== "string") {
          problem(file, `sample "${id}" has no ${field}`);
        }
      }
      // A difference between the two runs has to be explained in the record,
      // because the site renders the difference and a reader is owed the
      // reason. An explanation for a difference that no longer exists is the
      // same defect from the other side.
      if (sample.identical === false && !sample.note) {
        problem(
          file,
          `sample "${id}" differs from its native run and the record does ` +
            `not say why`,
        );
      }
      if (sample.identical === true && sample.note) {
        problem(
          file,
          `sample "${id}" matches its native run and still carries a note ` +
            `explaining a difference`,
        );
      }

      // The sample the record measured must still be in the tree under the
      // name the record gives it, or the page would cite a file nobody can
      // open.
      if (typeof sample.path === "string" && sample.path !== "") {
        if (!existsSync(resolve(repo, sample.path))) {
          problem(file, `sample "${id}" cites ${sample.path}, which is gone`);
        }
      }

      // The digest of the sample's own source. The playground compares it
      // against a hash of the editor's text to tell an unedited curated
      // sample, which can run from its recorded module, from text the visitor
      // changed, which has to go to the compile service. Checking it against
      // the file on disk is therefore a staleness gate and not a formality: a
      // sample edited since the recording no longer matches its recorded
      // module either, so the page would hand a visitor bytes compiled from
      // text that is no longer in the tree.
      if (
        typeof sample.sourceSha256 !== "string" ||
        sample.sourceSha256 === ""
      ) {
        problem(file, `sample "${id}" records no sourceSha256`);
      } else if (!/^[0-9a-f]{64}$/.test(sample.sourceSha256)) {
        problem(
          file,
          `sample "${id}" records "${sample.sourceSha256}" as its ` +
            `sourceSha256, which is not a 64 character lowercase hex digest`,
        );
      } else if (
        typeof sample.path === "string" &&
        sample.path !== "" &&
        existsSync(resolve(repo, sample.path))
      ) {
        const source = readFileSync(resolve(repo, sample.path));
        const digest = createHash("sha256").update(source).digest("hex");
        if (digest !== sample.sourceSha256) {
          problem(
            file,
            `sample "${id}" is stale: ${sample.path} hashes to ${digest} ` +
              `where the manifest says ${sample.sourceSha256}, so the ` +
              `recorded module was compiled from text that is no longer in ` +
              `the tree. Regenerate with: npm run record:wasm`,
          );
        }
      }

      if (typeof sample.wasm !== "string" || sample.wasm === "") continue;
      const module = join(records, "wasm", sample.wasm);
      if (!existsSync(module)) {
        problem(
          `site/records/wasm/${sample.wasm}`,
          `is named by the manifest and is not there`,
        );
        continue;
      }
      const bytes = readFileSync(module);
      if (bytes.length !== sample.bytes) {
        problem(
          `site/records/wasm/${sample.wasm}`,
          `is ${bytes.length} bytes where the manifest says ${sample.bytes}`,
        );
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== sample.sha256) {
        problem(
          `site/records/wasm/${sample.wasm}`,
          `hashes to ${sha256} where the manifest says ${sample.sha256}`,
        );
      }
      wasmFiles.push(sample.wasm);
    }

    // A module the manifest does not name is a leftover from a sample that
    // was renamed or removed, and serving it would be serving evidence for a
    // claim nothing on the site makes.
    const named = new Set(manifest.samples.map((sample) => sample.wasm));
    for (const name of readdirSync(join(records, "wasm"))) {
      if (name.endsWith(".wasm") && !named.has(name)) {
        problem(
          `site/records/wasm/${name}`,
          `is not named by the manifest, so nothing recorded it`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// diagnostics.json
// ---------------------------------------------------------------------------

const diagnostics = load("diagnostics.json");

if (diagnostics) {
  const file = "site/records/diagnostics.json";
  checkProvenance("diagnostics.json", diagnostics);

  if (!Array.isArray(diagnostics.cases) || diagnostics.cases.length === 0) {
    problem(file, `lists no cases`);
  } else {
    const seen = new Set();
    for (const entry of diagnostics.cases) {
      const id = entry.id;
      if (typeof id !== "string" || id === "") {
        problem(file, `has a case with no id`);
        continue;
      }
      if (seen.has(id)) {
        problem(file, `lists "${id}" twice`);
      }
      seen.add(id);

      for (const field of ["rule", "title", "path", "command", "stderr"]) {
        if (typeof entry[field] !== "string" || entry[field] === "") {
          problem(file, `case "${id}" has no ${field}`);
        }
      }
      // A case whose program compiles is not a diagnostic, and a zero exit
      // code is how that would look in the record.
      if (typeof entry.exitCode !== "number" || entry.exitCode === 0) {
        problem(
          file,
          `case "${id}" records exit code ${entry.exitCode}, so the ` +
            `compiler did not reject the program`,
        );
      }
      if (typeof entry.stderr === "string" && !entry.stderr.includes("^")) {
        problem(
          file,
          `case "${id}" has no caret line, so the part of the diagnostic ` +
            `that points at the mistake is missing`,
        );
      }
      if (typeof entry.path === "string" && entry.path !== "") {
        if (!existsSync(resolve(repo, entry.path))) {
          problem(file, `case "${id}" cites ${entry.path}, which is gone`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// highlight.json
// ---------------------------------------------------------------------------

// The markup has to encode the file rather than merely resemble it. Recovering
// the text and comparing it with the tree is what catches a record written
// before a listing was edited, which is the way this record goes stale: the
// tokens would still be valid markup, painted onto text nobody wrote.
function textOf(html) {
  return html
    .replace(/<span class="[^"]*">/g, "")
    .replace(/<\/span>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

const highlight = load("highlight.json");

if (highlight) {
  const file = "site/records/highlight.json";
  checkProvenance("highlight.json", highlight);

  const listings = highlight.files;
  if (!listings || typeof listings !== "object") {
    problem(file, `has no "files" map`);
  } else if (Object.keys(listings).length === 0) {
    problem(file, `records no listings`);
  } else {
    for (const [path, html] of Object.entries(listings)) {
      if (typeof html !== "string" || html === "") {
        problem(file, `${path} has no markup`);
        continue;
      }
      const source = resolve(repo, path);
      if (!existsSync(source)) {
        problem(file, `records ${path}, which is gone from the tree`);
        continue;
      }
      if (textOf(html) !== readFileSync(source, "utf8")) {
        problem(
          file,
          `${path} is stale: the recorded markup does not encode the file ` +
            `that is in the tree now`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Fail, or publish
// ---------------------------------------------------------------------------

if (problems.length > 0) {
  throw new Error(
    `the committed records do not check out, so the site will not build:\n\n` +
      problems.map((line) => `  ${line}`).join("\n") +
      `\n\nRegenerate on a machine with the iyi compiler and wasi-sdk:\n` +
      `  npm run record\n`,
  );
}

mkdirSync(publicWasm, { recursive: true });
const publishing = new Set(wasmFiles);
for (const name of readdirSync(publicWasm)) {
  if (!publishing.has(name)) rmSync(join(publicWasm, name));
}
for (const name of wasmFiles) {
  writeFileSync(join(publicWasm, name), readFileSync(join(records, "wasm", name)));
}

const cases = diagnostics.cases.length;
const listings = Object.keys(highlight.files).length;
console.log(
  `records: ${wasmFiles.length} wasm modules verified and published, ` +
    `${cases} diagnostics, ${listings} listings, recorded at ` +
    `${manifest.recorded.commit.slice(0, 9)}`,
);
