#!/usr/bin/env node
// SPEC.md and CHANGELOG.md are the design record and the release record. They
// are the repository's own words, and the site's job is to serve them, not to
// retell them. So this script does exactly one thing: it cuts SPEC.md at the
// headings SPEC.md itself uses, and writes each piece out byte for byte with a
// note of where it came from.
//
// Nothing here rewrites, reflows, summarises or trims the source. That is
// checked rather than trusted, and checked against the files that will be
// served rather than the strings in this process: everything is written to a
// staging directory, read back, reassembled, and compared to the file it came
// from. One differing byte fails the build and the last good generation stays.
//
// Every failure below is loud and non-zero. A missing SPEC.md must break the
// build, because a specification page with nothing behind it is the exact
// dishonesty this site was built to argue against.

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const out = resolve(here, "..", "src", "generated", "reference");
const GENERATOR = "site/scripts/reference.mjs";

function fail(message) {
  console.error(`reference: ${message}`);
  process.exit(1);
}

function readInput(name) {
  const path = resolve(repo, name);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    fail(
      `cannot read ${path}: ${error.message}\n` +
        `  ${name} is the record the reference pages are generated from. ` +
        `There is no fallback and no placeholder: without the file there is ` +
        `nothing to serve, so the build stops here.`,
    );
  }
  if (text.trim().length === 0) {
    fail(`${path} is empty, so there is no record to generate pages from`);
  }
  return { name, path, text, bytes: Buffer.byteLength(text, "utf8") };
}

// Headings, read the way a markdown parser reads them: a `#` inside a fenced
// block is a comment in someone's code sample, not a section. SPEC.md contains
// three of those, and a naive line scan would cut the document at them.
function headings(text) {
  const lines = text.split("\n");
  const found = [];
  let fence = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);

    if (open) {
      const marker = open[1][0];
      const width = open[1].length;
      if (fence === null) {
        fence = { marker, width };
      } else if (
        marker === fence.marker &&
        width >= fence.width &&
        open[2].trim() === ""
      ) {
        // A closing fence carries no info string, so an opening fence for
        // another language nested inside a block stays content.
        fence = null;
      }
      continue;
    }

    if (fence !== null) continue;

    const head = /^(#{1,6}) +(.*?)\s*$/.exec(line);
    if (head) found.push({ index: i, level: head[1].length, text: head[2] });
  }

  // Returned rather than judged here: an unbalanced fence means something
  // different to the whole file than it does to one section of it.
  return { lines, found, openFence: fence !== null };
}

// A heading of the form `III.9 The dependency floor: **MEASURED; ...**` carries
// its own status. The status is pulled out rather than slugified, so accepting
// a PROPOSED section later changes the badge and not the URL.
const STATUS = /(?::)?\s*\*\*([^*]+)\*\*\s*$/;

function partition(text) {
  const marked = STATUS.exec(text);
  if (!marked) return { title: text, status: null };
  return {
    title: text.slice(0, marked.index).replace(/[:\s]+$/, ""),
    status: marked[1].trim(),
  };
}

function slugify(text) {
  const slug = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2018\u2019`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") fail(`heading "${text}" does not yield a usable url slug`);
  return slug;
}

const escapeHtml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Headings in SPEC.md carry markdown: `IV.1g `ObjectCode`. The module's own
// machine code` names a section of the artifact in code voice, and a page that
// printed the backticks would be showing the reader the file's punctuation
// instead of its meaning. Two rules, which is everything these headings use.
const inline = (text) =>
  escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

// README.md says why PROPOSED is the one status the site marks in the signal
// colour. The sentence is lifted from the file rather than typed here, so the
// site cannot end up claiming something README.md stopped saying.
function proposedNote(readme) {
  const anchor = "marked PROPOSED are exactly the parts that will move";
  const flat = readme.text.replace(/\s+/g, " ");
  const at = flat.indexOf(anchor);
  if (at === -1) {
    fail(
      `README.md no longer contains the sentence "${anchor}". The site badges ` +
        `PROPOSED sections on README.md's authority, so that sentence is a ` +
        `dependency and not a decoration.`,
    );
  }
  const opened = flat.lastIndexOf(". ", at);
  const closed = flat.indexOf(".", at + anchor.length);
  if (opened === -1 || closed === -1) {
    fail("cannot find the sentence boundaries around README.md's PROPOSED note");
  }
  const sentence = flat.slice(opened + 2, closed + 1).trim();
  return {
    text: sentence,
    html: inline(sentence),
    source: readme.name,
    note: "README.md's own sentence, hard wraps joined the way markdown joins them",
  };
}

// Read and check everything before touching the output directory, so a failure
// leaves the last good generation in place instead of a half-written tree.

const spec = readInput("SPEC.md");
const changelog = readInput("CHANGELOG.md");
const readme = readInput("README.md");

const commit = (() => {
  try {
    return execFileSync("git", ["-C", repo, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch (error) {
    return fail(
      `cannot read the commit this record was generated from: ${error.message}`,
    );
  }
})();

// SPEC.md is one `#` title, `##` parts, and `###` numbered sections such as
// III.10 and IV.1g. Those three levels are the document's own units, so they
// are the pages. A `####` sub-question stays inside the section that owns it.
const CUT_AT = 3;

const scan = headings(spec.text);
const cuts = scan.found.filter((head) => head.level <= CUT_AT);

if (scan.openFence) {
  fail("SPEC.md leaves a fenced code block open, so its headings cannot be read");
}

if (cuts.length === 0) {
  fail(
    `SPEC.md has no headings at level ${CUT_AT} or above, so it cannot be ` +
      `split into sections. The page structure is the document's structure; ` +
      `there is no default to fall back on.`,
  );
}
if (cuts[0].index !== 0) {
  fail(
    `SPEC.md opens with ${cuts[0].index} line(s) before its first heading, ` +
      `and those bytes would not appear on any page`,
  );
}

const sections = cuts.map((head, n) => {
  const stop = n + 1 < cuts.length ? cuts[n + 1].index : scan.lines.length;
  const headingLine = scan.lines[head.index];
  // `0.1.0: what the first release has to prove` is one heading followed by one
  // blank line, so it has a body of no bytes and a body all the same. The two
  // cases have to stay distinguishable or reassembly loses that newline.
  const hasBody = stop > head.index + 1;
  const body = scan.lines.slice(head.index + 1, stop).join("\n");
  const inner = scan.found.filter((x) => x.index > head.index && x.index < stop);
  const { title, status } = partition(head.text);
  const slug = slugify(title);

  // A fenced block cannot contain a heading, so it cannot straddle a cut: every
  // section's fences balance on their own. When they do not, the split cut
  // inside somebody's code sample, which is how a `#` comment in an iyi listing
  // becomes a section of the specification.
  if (headings(body).openFence) {
    fail(
      `the section at SPEC.md line ${head.index + 1} ("${head.text}") ends ` +
        `inside a fenced code block, so the split cut into a code sample ` +
        `rather than between sections`,
    );
  }

  return {
    slug,
    heading: head.text,
    title,
    title_html: inline(title),
    status,
    status_html: status === null ? null : inline(status),
    level: head.level,
    line: head.index + 1,
    bytes: Buffer.byteLength(body, "utf8"),
    // The section's own heading, or any sub-heading it contains: III.1 is
    // DECIDED and its III.1.4 is still PROPOSED, and a reader is owed that.
    proposed: [head, ...inner].some((x) => /\bPROPOSED\b/.test(x.text)),
    file: `spec/${slug}.md`,
    headingLine,
    hasBody,
    body,
  };
});

const collisions = new Map();
for (const section of sections) {
  const first = collisions.get(section.slug);
  if (first) {
    fail(
      `two SPEC.md headings both slug to "${section.slug}", so one section ` +
        `would have no page:\n  line ${first.line}: ${first.heading}\n` +
        `  line ${section.line}: ${section.heading}`,
    );
  }
  collisions.set(section.slug, section);
}

// A parent for each `###`, so the contents page can group by part without
// inventing a hierarchy of its own.
let parent = null;
for (const section of sections) {
  if (section.level <= 2) {
    parent = section.slug;
    section.parent = null;
  } else {
    section.parent = parent;
  }
}

// CHANGELOG.md is one document with one `#` title and a `##` per release. It
// stays one page: the releases read as a sequence, and cutting them apart
// would be a structure the file does not have.
const log = headings(changelog.text);
if (log.openFence) {
  fail("CHANGELOG.md leaves a fenced code block open");
}
const logTitle = log.found.find((head) => head.level === 1);
if (!logTitle || logTitle.index !== 0) {
  fail("CHANGELOG.md does not open with a level 1 heading to take its title from");
}
const logLines = changelog.text.split("\n");
const logBody = logLines.slice(1).join("\n");
if (logLines[0] !== `# ${logTitle.text}`) {
  fail("CHANGELOG.md's title line does not detach cleanly from its body");
}

const releases = log.found
  .filter((head) => head.level === 2)
  .map((head) => ({
    heading: head.text,
    heading_html: inline(head.text),
    line: head.index + 1,
  }));
if (releases.length === 0) {
  fail("CHANGELOG.md records no releases at level 2");
}

const index = {
  generator: GENERATOR,
  commit,
  spec: {
    source: spec.name,
    bytes: spec.bytes,
    title: sections[0].title,
    title_html: sections[0].title_html,
    cut_at: CUT_AT,
    sections: sections.map(
      ({ headingLine, hasBody, body, ...rest }) => rest,
    ),
    proposed: sections.filter((section) => section.proposed).length,
  },
  changelog: {
    source: changelog.name,
    bytes: changelog.bytes,
    title: logTitle.text,
    title_html: inline(logTitle.text),
    body_bytes: Buffer.byteLength(logBody, "utf8"),
    releases,
    file: "changelog.md",
  },
  proposed_note: proposedNote(readme),
};

// The frontmatter is two lines of the generator's own making so that a section
// opening on a `---` rule can never be misread as frontmatter. Everything after
// it is the source.
const FRAME = "---\ngenerated: true\n---\n";

// Written to a staging directory first. The claim on every generated page is
// that its text is the file's own, so the check has to be made against the
// bytes that will be served rather than against the strings in this process,
// and a failed check has to leave the last good generation in place.
const staging = `${out}.staging`;
rmSync(staging, { recursive: true, force: true });
mkdirSync(resolve(staging, "spec"), { recursive: true });

for (const section of sections) {
  writeFileSync(resolve(staging, section.file), FRAME + section.body, "utf8");
}
writeFileSync(resolve(staging, "changelog.md"), FRAME + logBody, "utf8");
writeFileSync(
  resolve(staging, "index.json"),
  `${JSON.stringify(index, null, 2)}\n`,
  "utf8",
);

function served(file) {
  const written = readFileSync(resolve(staging, file), "utf8");
  if (!written.startsWith(FRAME)) {
    fail(`${file} was not written with the generated frontmatter`);
  }
  return written.slice(FRAME.length);
}

const rebuilt = sections
  .map((section) =>
    section.hasBody
      ? `${section.headingLine}\n${served(section.file)}`
      : section.headingLine,
  )
  .join("\n");

if (rebuilt !== spec.text) {
  rmSync(staging, { recursive: true, force: true });
  fail(
    `the ${sections.length} files just written do not reassemble into ` +
      `SPEC.md byte for byte, so a page would carry a generated-from banner ` +
      `over text that is not what that file holds`,
  );
}

if (`${logLines[0]}\n${served("changelog.md")}` !== changelog.text) {
  rmSync(staging, { recursive: true, force: true });
  fail("the changelog file just written is not CHANGELOG.md byte for byte");
}

// Replaced rather than merged: a section renamed upstream must not leave its
// old page behind to be served as current.
rmSync(out, { recursive: true, force: true });
renameSync(staging, out);

console.log(
  `reference: ${sections.length} SPEC.md sections ` +
    `(${index.spec.proposed} proposed), ${releases.length} CHANGELOG.md ` +
    `releases, at ${commit}`,
);
