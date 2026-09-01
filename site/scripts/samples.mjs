#!/usr/bin/env node
// Transcludes the repository's own text into JSON the site imports. Nothing a
// lesson shows as code is typed into the lesson. Two kinds of text arrive here:
//
//   1. The sample programs under `samples/iyi`. A lesson names a file, a named
//      top-level declaration in it, or a content-anchored span of it, and the
//      build reads that text out of the file at that moment. A sample that
//      changes in the repository changes on the site. A sample that is renamed
//      or deleted fails the build, naming the lesson that asked for it.
//   2. The console recordings in README.md. A lesson names a block by an anchor
//      string, and that anchor has to appear in exactly one fenced block in the
//      whole README. The block travels with the line numbers it was quoted
//      from, so the page can cite them rather than assert them.
//
// Every failure below is fatal and loud. A page listing code that is not in the
// tree, or a console recording nobody ran, is the exact dishonesty this site
// exists to argue against, and a silent fallback would ship it.

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const lessonsDir = resolve(here, "..", "src", "content", "learn");
const out = resolve(here, "..", "src", "generated");

const die = (message) => {
  throw new Error(message);
};

// Samples ------------------------------------------------------------------

const samplesRoot = resolve(repo, "samples", "iyi");

function walk(dir) {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (name.endsWith(".iyi")) found.push(full);
  }
  return found;
}

// A named top-level declaration is a stable handle into a file: it survives an
// edit above it, where a line number does not. The key drops `pub` and any
// `forall` binder, so `pub impl Show for Box(T) forall T` is `impl Show for
// Box(T)`, which is how a person would refer to it out loud.
const OPENERS = [
  [/^module\s+(\S+)\s*$/, (m) => `module ${m[1]}`, false],
  [/^(?:pub\s+)?(trait|struct|class|enum|lib)\s+([A-Z]\w*)/, (m) => `${m[1]} ${m[2]}`, true],
  [/^(?:pub\s+)?impl\s+(.+?)(?:\s+forall\b.*)?$/, (m) => `impl ${m[1].trim()}`, true],
  [/^(?:pub\s+)?def\s+([a-z_]\w*[?!=]?)/, (m) => `def ${m[1]}`, true],
];

function regionsOf(lines) {
  const found = new Map();
  const ambiguous = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s/.test(line) || line === "") continue;

    for (const [pattern, key, closes] of OPENERS) {
      const m = pattern.exec(line);
      if (!m) continue;

      let end = i + 1;
      if (closes) {
        // Every declaration here is top level, so its `end` is the next one at
        // column zero. Nested ends are indented and cannot be mistaken for it.
        end = -1;
        for (let j = i + 1; j < lines.length; j++) {
          if (/^end\s*$/.test(lines[j])) {
            end = j + 1;
            break;
          }
        }
        if (end === -1) die(`unterminated declaration at line ${i + 1}: ${line}`);
      }

      const name = key(m);
      if (found.has(name)) ambiguous.add(name);
      else found.set(name, { start: i + 1, end });
      break;
    }
  }

  const regions = {};
  for (const [name, span] of found) {
    if (!ambiguous.has(name)) regions[name] = span;
  }
  // An overloaded `def` is genuinely two declarations under one name. Recorded
  // as unusable rather than resolved to whichever came first, so a lesson that
  // names it is told why instead of being shown half of what it asked for.
  return { regions, ambiguous: [...ambiguous].sort() };
}

const samples = {};
for (const file of walk(samplesRoot)) {
  const path = relative(resolve(repo, "samples"), file).split("\\").join("/");
  const text = readFileSync(file, "utf8");
  const lines = text.replace(/\n$/, "").split("\n");
  const { regions, ambiguous } = regionsOf(lines);

  samples[path] = {
    path: `samples/${path}`,
    text,
    lines: lines.length,
    regions,
    ambiguous,
  };
}

if (Object.keys(samples).length === 0) {
  die(`no samples found under ${samplesRoot}`);
}

// The break programs -------------------------------------------------------

// A lesson's break-this-rule exercise shows a program written to be rejected,
// and the compiler's verdict on it is recorded under site/records/. Those
// programs are repository text like any other listing, so they are indexed here
// and render through the same component and the same token pass as the samples.
// The index key is the repository relative path, which is also the key the
// highlight record uses, so one lookup serves both families.
//
// Regions are deliberately not scanned. A program written to be rejected is not
// a source of named declarations, and running the region scanner over code the
// compiler refuses would fail the build for the wrong reason. A lesson shows a
// break program whole, which is the only honest way to show one.
const breakRoot = resolve(here, "..", "records", "break");
let breakPrograms = 0;

if (existsSync(breakRoot)) {
  for (const file of walk(breakRoot)) {
    const path = relative(repo, file).split("\\").join("/");
    const text = readFileSync(file, "utf8");

    samples[path] = {
      path,
      text,
      lines: text.replace(/\n$/, "").split("\n").length,
      regions: {},
      ambiguous: [],
    };
    breakPrograms += 1;
  }
}

// README recordings --------------------------------------------------------

const readmePath = resolve(repo, "README.md");
const readmeLines = readFileSync(readmePath, "utf8").split("\n");

function fencedBlocks(lines) {
  const blocks = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const fence = /^```(\w*)\s*$/.exec(lines[i]);
    if (open === null) {
      if (fence) open = { lang: fence[1], at: i };
      continue;
    }
    if (/^```\s*$/.test(lines[i])) {
      blocks.push({
        lang: open.lang,
        from: open.at + 2,
        to: i,
        text: lines.slice(open.at + 1, i).join("\n"),
      });
      open = null;
    }
  }
  return blocks;
}

// Each entry is a claim that one block in README.md says this. The anchor is
// matched, never the line number, because a line number is a guess about a file
// nobody edits with the site in mind.
const WANTED = {
  first_run: { lang: "console", anchor: "$ iyi run main.iyi" },
  the_rule: { lang: "console", anchor: "rm -r app" },
  library_deleted: { lang: "console", anchor: "rm -rf samples/iyi/kemal" },
  non_exhaustive: { lang: "console", anchor: "case is not exhaustive" },
  using_missing: { lang: "console", anchor: "this file has not written `using`" },
  import_missing: { lang: "console", anchor: "is not imported here" },
  orphan_rule: { lang: "console", anchor: "an impl must live in the module" },
};

const blocks = fencedBlocks(readmeLines);
const readme = {};

for (const [id, want] of Object.entries(WANTED)) {
  const hits = blocks.filter((b) => b.text.includes(want.anchor));
  if (hits.length === 0) {
    die(
      `README.md has no fenced block containing "${want.anchor}", which the ` +
        `lesson "${id}" quotes. Either the passage moved and the anchor needs ` +
        `updating, or the lesson is claiming something the README no longer says.`,
    );
  }
  if (hits.length > 1) {
    die(
      `"${want.anchor}" matches ${hits.length} blocks in README.md ` +
        `(lines ${hits.map((h) => h.from).join(", ")}), so "${id}" is ambiguous. ` +
        `Narrow the anchor.`,
    );
  }
  const [hit] = hits;
  if (hit.lang !== want.lang) {
    die(
      `"${id}" expected a ${want.lang} block and README.md:${hit.from} is ` +
        `${hit.lang || "unlabelled"}. Output is quoted as output or not at all.`,
    );
  }
  readme[id] = {
    text: hit.text,
    from: hit.from,
    to: hit.to,
    source: "README.md",
    cite: `README.md, ${hit.to > hit.from ? `lines ${hit.from} to ${hit.to}` : `line ${hit.from}`}`,
  };
}

// The rules themselves -----------------------------------------------------

// A lesson says which rule it teaches, and the rail beside it prints that
// rule's premise. The premise is SPEC.md's own sentence, read out of SPEC.md's
// rule table, so a lesson cannot describe a rule the specification does not
// state.
const specLines = readFileSync(resolve(repo, "SPEC.md"), "utf8").split("\n");
const rules = {};
specLines.forEach((line, i) => {
  const m = /^\|\s*(R-\d[a-z]?)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
  if (!m) return;
  if (m[1] in rules) die(`SPEC.md states ${m[1]} twice, at line ${i + 1}`);
  rules[m[1]] = {
    id: m[1],
    premise: m[2],
    cite: `SPEC.md, line ${i + 1}`,
  };
});

if (Object.keys(rules).length === 0) {
  die(
    `SPEC.md no longer carries a table of rows shaped "| R-1 | ... |", so the ` +
      `site cannot quote a rule's premise. Fix the reader here rather than ` +
      `typing the premises into a page.`,
  );
}

// Part I's table states the compilation model. A decision the model does not
// need, but a lesson does, is stated in a section of its own instead, and a
// lesson names such a section the way it names a rule. The premise it gets is
// that section's opening paragraph, read here, so the sentence on the page is
// the specification's sentence and a section that is rewritten changes the page
// or fails the build.
const SECTIONS = ["III.1"];

for (const id of SECTIONS) {
  const escaped = id.replace(/\./g, "\\.");
  const at = specLines.findIndex((line) =>
    new RegExp(`^#+\\s+${escaped}(?:\\s|:)`).test(line),
  );
  if (at === -1) {
    die(
      `SPEC.md has no heading for section ${id}, which a lesson names as the ` +
        `premise it teaches. Either the section was renumbered, or the lesson ` +
        `is teaching something the specification no longer states.`,
    );
  }

  let from = at + 1;
  while (from < specLines.length && specLines[from].trim() === "") from += 1;
  let to = from;
  while (to < specLines.length && specLines[to].trim() !== "") to += 1;

  const premise = specLines.slice(from, to).join(" ").trim();
  if (premise === "" || premise.startsWith("#") || premise.startsWith("```")) {
    die(
      `SPEC.md section ${id} at line ${at + 1} does not open with a paragraph, ` +
        `so there is no sentence to quote for it. It opens with: ` +
        `${specLines[from] ?? "end of file"}`,
    );
  }

  rules[id] = {
    id,
    premise,
    cite: `SPEC.md, ${to - from > 1 ? `lines ${from + 1} to ${to}` : `line ${from + 1}`}`,
  };
}

// What the lessons ask for ------------------------------------------------

// The guard that makes renaming a sample a build failure rather than a blank.
// Both the `sample:` field in a lesson's frontmatter and every `<Sample
// path="..."/>` in its body are resolved here, against the tree, by name.
let lessonFiles = [];
try {
  lessonFiles = readdirSync(lessonsDir)
    .filter((n) => n.endsWith(".mdx") || n.endsWith(".md"))
    .sort();
} catch {
  lessonFiles = [];
}

const asked = new Map();
const note = (path, where) => {
  if (!asked.has(path)) asked.set(path, new Set());
  asked.get(path).add(where);
};

const claimedRules = new Map();
const claimedQuotes = new Map();
const claimedSources = new Map();
const claim = (into, key, where) => {
  if (!into.has(key)) into.set(key, new Set());
  into.get(key).add(where);
};

for (const name of lessonFiles) {
  const body = readFileSync(join(lessonsDir, name), "utf8");
  const front = /^---\n([\s\S]*?)\n---/.exec(body);
  if (front) {
    const named = /^sample:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(front[1]);
    if (named) note(named[1].trim(), `${name} frontmatter`);

    const teaches = /^rule:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(front[1]);
    if (teaches) {
      for (const id of teaches[1].trim().split(/\s+/)) {
        claim(claimedRules, id, `${name} frontmatter`);
      }
    }

    for (const m of front[1].matchAll(/^\s*-?\s*file:\s*["']?([^"'\n]+?)["']?\s*$/gm)) {
      claim(claimedSources, m[1].trim(), `${name} frontmatter`);
    }
  }
  for (const m of body.matchAll(/<Sample\b[^>]*?\bpath=["']([^"']+)["']/g)) {
    note(m[1], `${name} body`);
  }
  for (const m of body.matchAll(/<Quote\b[^>]*?\bid=["']([^"']+)["']/g)) {
    claim(claimedQuotes, m[1], `${name} body`);
  }
}

const missing = [];
for (const [path, where] of asked) {
  const key = path.replace(/^samples\//, "");
  if (!(key in samples)) missing.push(`${path} (asked for by ${[...where].join(", ")})`);
}
if (missing.length > 0) {
  die(
    `these lessons name sample files that are not in samples/iyi:\n  ` +
      missing.join("\n  ") +
      `\n\nThe tree has:\n  ${Object.keys(samples).join("\n  ")}`,
  );
}

const absentSources = [...claimedSources]
  .filter(([path]) => !existsSync(resolve(repo, path)))
  .map(([path, where]) => `${path} (cited by ${[...where].join(", ")})`);
if (absentSources.length > 0) {
  die(
    `these lessons cite a source that is not in the repository:\n  ` +
      absentSources.join("\n  ") +
      `\n\nA citation to a file that does not exist is worse than no citation, ` +
      `because it reads as provenance.`,
  );
}

const unknownRules = [...claimedRules]
  .filter(([id]) => !(id in rules))
  .map(([id, where]) => `${id} (claimed by ${[...where].join(", ")})`);
if (unknownRules.length > 0) {
  die(
    `these lessons say they teach a rule SPEC.md does not state:\n  ` +
      unknownRules.join("\n  ") +
      `\n\nSPEC.md states: ${Object.keys(rules).join(", ")}`,
  );
}

const unknownQuotes = [...claimedQuotes]
  .filter(([id]) => !(id in readme))
  .map(([id, where]) => `${id} (quoted by ${[...where].join(", ")})`);
if (unknownQuotes.length > 0) {
  die(
    `these lessons quote a README recording this script does not extract:\n  ` +
      unknownQuotes.join("\n  ") +
      `\n\nExtracted: ${Object.keys(readme).join(", ")}. Add an anchor to ` +
      `WANTED above rather than typing the output into a lesson.`,
  );
}

// Write --------------------------------------------------------------------

const samplesOut = resolve(out, "samples");
for (const [path, sample] of Object.entries(samples)) {
  const file = resolve(samplesOut, `${path}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(sample, null, 2)}\n`, "utf8");
}

mkdirSync(out, { recursive: true });
writeFileSync(
  resolve(samplesOut, "index.json"),
  `${JSON.stringify(samples, null, 2)}\n`,
  "utf8",
);
writeFileSync(
  resolve(out, "readme.json"),
  `${JSON.stringify(readme, null, 2)}\n`,
  "utf8",
);
writeFileSync(
  resolve(out, "rules.json"),
  `${JSON.stringify(rules, null, 2)}\n`,
  "utf8",
);

const totalLines = Object.values(samples).reduce((n, s) => n + s.lines, 0);
console.log(
  `samples: ${Object.keys(samples).length - breakPrograms} programs plus ` +
    `${breakPrograms} break programs, ${totalLines} lines, ` +
    `${Object.keys(readme).length} README recordings, ` +
    `${Object.keys(rules).length} premises, ` +
    `${asked.size} referenced by ${lessonFiles.length} lessons`,
);
