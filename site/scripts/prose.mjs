#!/usr/bin/env node
// The build-time gate over glued prose.
//
// THE DEFECT THIS EXISTS FOR, because it is invisible in the source and obvious
// on the page. Astro's templates drop the whitespace between a run of text and
// an inline element when the two are separated by a line break, so this, which
// is the natural way to write a paragraph that fits a column:
//
//     This page is the recording behind the
//     <a href="...">playground</a>.
//
// renders as "the recording behind theplayground". The source looks correct, a
// reviewer reads past it, and the words are welded together in the built HTML.
// It happened six times in one pass over three pages, which is what makes it a
// class rather than a typo: the same keystroke habit produces it every time.
//
// So it is gated rather than proofread. This runs over the built HTML, which is
// the only place the defect exists, and it fails the build naming the page and
// the two words it welded.
//
// WHAT IS DELIBERATELY NOT A HIT. Code listings on this site are a token stream
// from the compiler's own lexer, and adjacent tokens legitimately abut with no
// space between their spans: `puts` and `(` are two tokens and one has to
// follow the other. So the contents of a source block, a console block, a
// diagnostic block and the editor's ink layer are cut out before the scan.
// Scanning them would produce a hit on every listing on the site, which is the
// fastest way to make a gate that nobody trusts and everybody disables.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");
const dist = resolve(site, "dist");

// The inline elements prose actually wraps a word in. A block element on its
// own line is not a defect: `</p><p>` has no space between it and that is
// correct, because the two are different paragraphs.
const INLINE = "a|code|strong|em|b|i|span|abbr|kbd|dfn";

// Blocks whose insides are a token stream rather than prose. Matched by class
// because that is what the site's own CSS keys on, so a new block type that
// wants the exemption has to say so in the same vocabulary.
const LISTINGS =
  /<(pre|figure|div)[^>]*class="[^"]*(?:source|console|diagnostic|editor-ink|editor|cases|case|stamped|recording)[^"]*"[\s\S]*?<\/\1>/g;

function htmlFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...htmlFiles(path));
    else if (name.endsWith(".html")) found.push(path);
  }
  return found;
}

// Strip what must not be scanned, replacing each cut with a newline so the
// characters either side of a removed block cannot be read as adjacent.
function proseOnly(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "\n")
    .replace(/<style[\s\S]*?<\/style>/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/<textarea[\s\S]*?<\/textarea>/g, "\n")
    .replace(LISTINGS, "\n");
}

const problems = [];

for (const file of htmlFiles(dist)) {
  const page = relative(dist, file);
  const prose = proseOnly(readFileSync(file, "utf8"));

  // A word, then an inline element opening with no whitespace between them.
  const opening = new RegExp(
    `([A-Za-z\\u00c0-\\u024f]{2,})<(?:${INLINE})\\b[^>]*>([A-Za-z\\u00c0-\\u024f])`,
    "g",
  );
  /* An inline element closing, then a word, with no whitespace between them.
   *
   * A LEGITIMATE CASE THIS DELIBERATELY LETS THROUGH, found by the gate's own
   * first run getting it wrong. English inflects a code identifier by hanging
   * the suffix outside the span: `dlopen`ed, `impl`s, `trait`s. That renders
   * as one word on purpose, the code boundary is where the symbol actually
   * ends, and "fixing" it means either claiming `dlopened` is a symbol or
   * putting a space inside a word. So a run of four or more letters after a
   * closing tag is a welded word, and anything shorter is taken as an
   * inflection and allowed. That draws the line in the wrong place for a real
   * defect whose second word happens to be short, and it is the right trade:
   * this gate exists to catch a keystroke habit, and a gate that fires on
   * correct typography gets edited out of the build.
   */
  const closing = new RegExp(
    `([A-Za-z\\u00c0-\\u024f])<\\/(?:${INLINE})>([A-Za-z\\u00c0-\\u024f]{4,})`,
    "g",
  );

  /* A SECOND LEGITIMATE CASE, found when the site first met the whole
   * CHANGELOG: 0.5.0's lexer entry writes `t`otal on purpose — it is
   * *quoting* the defect where an editor colored one letter of a word.
   * The weld is the sentence's subject, not a typo, and a released
   * changelog entry is not edited to appease a gate. Named exactly, page
   * and pair, so anything new still fires.
   */
  const deliberate = new Set(["changelog/index.html: \"...t\" is welded to \"otal\""]);

  for (const match of prose.matchAll(opening)) {
    problems.push(`${page}: "${match[1]}" is welded to "${match[2]}..."`);
  }
  for (const match of prose.matchAll(closing)) {
    const finding = `${page}: "...${match[1]}" is welded to "${match[2]}"`;
    if (deliberate.has(finding)) continue;
    problems.push(finding);
  }
}

if (problems.length > 0) {
  const shown = problems.slice(0, 40);
  throw new Error(
    `prose: ${problems.length} place${problems.length === 1 ? "" : "s"} in the ` +
      `built HTML weld a word to the next one across an inline element, so the ` +
      `page reads as one run-together word where the source reads correctly:\n\n` +
      shown.map((line) => `  ${line}`).join("\n") +
      (problems.length > shown.length
        ? `\n  ... and ${problems.length - shown.length} more`
        : "") +
      `\n\nAstro drops the whitespace between text and an inline element when a ` +
      `line break separates them. Put the space back explicitly with {" "} ` +
      `before the element, or keep the element on the same line as the word ` +
      `before it.\n`,
  );
}

const pages = htmlFiles(dist).length;
console.log(
  `prose: ${pages} built pages carry no word welded to an inline element`,
);
