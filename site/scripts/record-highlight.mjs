#!/usr/bin/env node
// Records the compiler's own reading of every listing the site prints.
//
// The token classes come from `Crystal::SyntaxHighlighter::HTML`, which is
// driven by the compiler's own lexer, so the site cannot disagree with the
// compiler about what a token is. There is no grammar here, no regular
// expression over source, and no second definition of the language: writing
// one would be writing a thing that can be wrong about iyi, on a site whose
// whole argument is that nothing on it can be.
//
// One thing is applied after the lexer, and deliberately. The lexer answers
// what a token is; it says `pub` and `if` are both keywords, which is true.
// The art direction answers a different question: which tokens are iyi's own
// delta from Crystal, since that keyword set is the entire subject a reader
// came for. So a span the lexer classed `k` whose text is exactly one of
// iyi's ten rule words also gets `tok-rule`, and the site sets that at weight
// 700 against 500 for an ordinary keyword. The two questions are separate, and
// answering the second inside a hand-written grammar would have meant
// answering the first one twice.
//
// Regenerate with: npm run record:highlight

import { execFileSync, spawnSync } from "node:child_process";
import {
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
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");
const repo = resolve(site, "..");
const out = resolve(site, "records", "highlight.json");

// The words that are iyi's and not Crystal's, read from the one place that
// holds them. `site/src/lib/rule-words.json` is imported by the browser's
// renderer and read here by the recorder, so the recorded listings and the
// live editor emphasise the same set by construction rather than by two lists
// agreeing today and drifting later. That file's `why` field owns the
// explanation, including the reason `module` is in the list; it is not
// restated here, because a copy of a reason goes stale the same way a copy of
// a list does.
const ruleWords = JSON.parse(
  readFileSync(resolve(site, "src", "lib", "rule-words.json"), "utf8"),
);

const RULE_WORDS = ruleWords.words;

if (!Array.isArray(RULE_WORDS) || RULE_WORDS.length === 0) {
  throw new Error(
    `site/src/lib/rule-words.json has no "words" array, so this recorder ` +
      `cannot know which spans carry iyi's own keywords. That file is the one ` +
      `list; the browser's renderer reads it too.`,
  );
}

if (typeof ruleWords.why !== "string" || ruleWords.why.trim() === "") {
  throw new Error(
    `site/src/lib/rule-words.json has no "why", and that field is where the ` +
      `reason for this list lives. A list of ten words with no account of ` +
      `why they are the ten is the shape that gets edited by guess.`,
  );
}

// ---------------------------------------------------------------------------
// Toolchain
// ---------------------------------------------------------------------------

const buildDir = process.env.IYI_BUILD
  ? resolve(process.env.IYI_BUILD)
  : resolve(repo, ".build");
const iyi = join(buildDir, "iyi");
const crystal = join(buildDir, "crystal");
for (const binary of [iyi, crystal]) {
  if (!existsSync(binary)) {
    throw new Error(
      `no compiler at ${binary}. Build it, or set IYI_BUILD to the ` +
        `directory holding the iyi and crystal binaries.`,
    );
  }
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
  const cpu = execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], {
    encoding: "utf8",
  }).trim();
  return `${uname}, ${cpu}`;
})();

const recorded = {
  compiler: version,
  commit,
  machine,
  command: "npm run record:highlight",
  when: new Date().toISOString(),
};
for (const [key, value] of Object.entries(recorded)) {
  if (!value) {
    throw new Error(`provenance field "${key}" came out empty`);
  }
}

// ---------------------------------------------------------------------------
// Every listing the site can print
// ---------------------------------------------------------------------------

// The two families scripts/samples.mjs indexes, walked the same way it walks
// them, so a path the site can render is a path this record carries. A listing
// with no entry here is a build error rather than a plain-text render, which
// is only a safe design if this set is the larger one.
function walk(dir) {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (name.endsWith(".iyi")) found.push(full);
  }
  return found;
}

const samplesRoot = resolve(repo, "samples", "iyi");
const breakRoot = resolve(site, "records", "break");
for (const root of [samplesRoot, breakRoot]) {
  if (!existsSync(root)) {
    throw new Error(`${root} is not there, so there is nothing to record`);
  }
}

const files = [...walk(samplesRoot), ...walk(breakRoot)].map((file) =>
  relative(repo, file).split("\\").join("/"),
);
if (files.length === 0) {
  throw new Error(
    `found no .iyi files under ${samplesRoot} or ${breakRoot}`,
  );
}

// ---------------------------------------------------------------------------
// Run the compiler's highlighter over all of them, once
// ---------------------------------------------------------------------------

// A Crystal program because the highlighter is a Crystal class in this
// repository's own source tree. It takes the whole list in one invocation, so
// the compile cost is paid once rather than per file.
const PASS = `require "json"
require "crystal/syntax_highlighter/html"

paths = Array(String).from_json(File.read(ARGV[0]))
result = {} of String => String
paths.each do |path|
  result[path] = Crystal::SyntaxHighlighter::HTML.highlight(File.read(path))
end
print result.to_json
`;

const work = mkdtempSync(join(tmpdir(), "iyi-record-highlight-"));
const pass = join(work, "highlight_pass.cr");
const list = join(work, "paths.json");
writeFileSync(pass, PASS, "utf8");
writeFileSync(list, JSON.stringify(files), "utf8");

const run = spawnSync(crystal, ["run", "--no-color", pass, "--", list], {
  cwd: repo,
  encoding: "utf8",
  env,
  maxBuffer: 64 * 1024 * 1024,
});
if (run.status !== 0) {
  throw new Error(
    `the compiler's highlighter did not run (exit ${run.status}):\n` +
      `${run.stderr || run.stdout}`,
  );
}
const highlighted = JSON.parse(run.stdout);
rmSync(work, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// The rule-word split, and the proof that it changed only attributes
// ---------------------------------------------------------------------------

const RULE_SPAN = new RegExp(
  `<span class="k">(${RULE_WORDS.join("|")})</span>`,
  "g",
);

// The record has to encode the file and not merely resemble it, so the text is
// recovered from the markup and compared with the file on disk. This is what
// makes a listing rendered from the record the same listing as the file, and
// it is the check that catches a record written from a since-edited tree.
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

const record = {};
let ruleSpans = 0;

for (const path of files) {
  const html = highlighted[path];
  if (typeof html !== "string") {
    throw new Error(
      `the highlighter returned nothing for ${path}, so the record would ` +
        `have a hole where a listing goes`,
    );
  }
  if (/<span class="[^"]*"><span /.test(html)) {
    throw new Error(
      `${path}: the highlighter nested a span inside a span, which the ` +
        `site's per-line reflow does not expect. Read the output before ` +
        `trusting this record.`,
    );
  }

  const before = textOf(html);
  const source = readFileSync(resolve(repo, path), "utf8");
  if (before !== source) {
    throw new Error(
      `${path}: the highlighter's output does not encode the file. The ` +
        `record would paint the right tokens onto the wrong text.`,
    );
  }

  const split = html.replace(RULE_SPAN, (match, word) => {
    ruleSpans += 1;
    return `<span class="k tok-rule">${word}</span>`;
  });
  if (textOf(split) !== source) {
    throw new Error(
      `${path}: the rule-word split changed the text and not only the class ` +
        `attributes, which it must never do`,
    );
  }

  record[path] = split;
}

// A split that matched nothing means the lexer stopped classing iyi's own
// keywords as keywords, which would silently strip the emphasis the art
// direction is built on rather than break anything visibly.
if (ruleSpans === 0) {
  throw new Error(
    `no span carried one of iyi's rule words (${RULE_WORDS.join(", ")}), so ` +
      `either the lexer no longer classes them as keywords or the corpus no ` +
      `longer contains them`,
  );
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ recorded, files: record }, null, 2)}\n`, "utf8");

const bytes = Object.values(record).reduce(
  (sum, html) => sum + html.length,
  0,
);
console.log(
  `highlight: ${files.length} listings, ${ruleSpans} rule words, ` +
    `${bytes} bytes of markup, at ${commit.slice(0, 9)}`,
);
