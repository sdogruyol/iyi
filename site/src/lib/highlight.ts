/**
 * Token classes, from the compiler's own lexer.
 *
 * There is no grammar in this repository's website. `site/records/highlight.json`
 * holds one HTML string per file, produced by
 * `Crystal::SyntaxHighlighter::HTML` running inside the iyi fork's own
 * compiler, which means the tokens on the page are the tokens the compiler saw.
 * A hand written scanner would be a second grammar, it would drift from the
 * first one silently, and the drift would show up as a keyword the site does
 * not think is a keyword. So there is one grammar and it is the compiler's.
 *
 * The lexer's classes, and what each one is:
 *
 *   k  keyword, and `self`
 *   t  a constant or type name
 *   m  an identifier: a method name at its definition or its call
 *   s  a string or a character literal
 *   n  a number, a symbol, or a primitive literal
 *   o  an operator or a delimiter
 *   c  a comment
 *   i  the delimiters of a string interpolation
 *
 * The lexer does not distinguish iyi's keywords from Crystal's, because to the
 * lexer they are all keywords, and that distinction is the whole argument the
 * site's listings are making. So `site/scripts/record-highlight.mjs` adds
 * `tok-rule` to the `k` spans whose text is one of iyi's own keywords, AFTER
 * the lexer has decided where the tokens are. Which words those are is written
 * twice today: `site/src/lib/rule-words.json` is what everything under `src`
 * reads, including the browser side ink in `./tokens.ts`, and the recorder
 * still declares its own copy of the same list, which is the copy this
 * recording was stamped from. Pointing the recorder at the JSON is a separate
 * change. The split is applied to a class attribute, never to a token
 * boundary, so the emphasis cannot invent a token the compiler did not see.
 * `site/src/styles/code.css` carries the weight for both.
 *
 * WHAT THIS MODULE IS FOR: a record is one HTML string per whole file, and a
 * listing on this site is usually a slice of a file. Splitting an HTML string
 * on newlines is only correct if no element crosses one, and elements do cross
 * one: `samples/iyi/calc.iyi` holds a multi line string literal, so the lexer
 * emits a single `s` span containing newlines. Slicing that naively yields
 * unbalanced HTML, which a browser then repairs by guessing, and the guess is
 * a listing that is silently wrong below the cut.
 *
 * So the record is reparsed into tokens and re emitted one line at a time,
 * closing every open element at a line break and reopening it on the next line,
 * which leaves every line independently balanced and any contiguous run of them
 * safe to concatenate. That reparse and reflow no longer live here: they live in
 * `./tokens.ts`, next to the rule-word emphasis, because the playground's live
 * lexer produces the same markup and has to be painted by the same code, and it
 * cannot import this module without importing a recording of every listing on
 * the site into the browser. What is left here is the recording itself, and
 * what makes a recording trustworthy: the provenance has to be there or the
 * first import of it fails, an unrecorded path is a build failure and never a
 * plain text fallback, and the text the markup encodes is handed out so that
 * `Sample.astro` can require it to equal the file the samples index read.
 */
import record from "../../records/highlight.json";
import {
  lexHighlighterHtml,
  reflowLines,
  textOfTokens,
  type Token,
} from "./tokens";

/**
 * Re exported because escaping is a property of the markup these lines are
 * spliced into, so a page that renders recorded HTML beside its own text has
 * always reached for it from here. It moved to `./tokens.ts` with the rest of
 * the pure half; the name stays valid so no caller has to care.
 */
export { escapeCode } from "./tokens";

interface HighlightRecord {
  recorded: {
    compiler: string;
    commit: string;
    machine: string;
    command: string;
    when: string;
  };
  files: Record<string, string>;
}

const highlights = record as HighlightRecord;

/**
 * The provenance of the recording, exported so a page can stamp it. Checked
 * once here rather than at every use, because a record with no provenance is
 * not a record and the build should stop at the first import of it.
 */
export const highlightProvenance = highlights.recorded;

for (const field of ["compiler", "commit", "machine", "command", "when"] as const) {
  if (!highlightProvenance?.[field]) {
    throw new Error(
      `highlight: site/records/highlight.json has no "recorded.${field}". ` +
        `A record without its provenance is an assertion, and this site does ` +
        `not render assertions. Regenerate it with ` +
        `${highlightProvenance?.command ?? "the recorder script"}.`,
    );
  }
}

/**
 * Cached per path, because both questions this module answers are asked about
 * the same file: a listing may be sliced several times on one page, and the
 * page that slices it also asks for its text to prove the record is not stale.
 * Lexing is the expensive half, so the token stream is what gets kept and both
 * answers are derived from it.
 */
const lexed: Record<string, readonly Token[]> = {};
const reflowed: Record<string, string[]> = {};

/**
 * The tokens the record holds for one file.
 *
 * An absent path is a build failure and never a plain text fallback. Falling
 * back would make one listing on the site the only one without the emphasis
 * that carries the argument, and it would do it silently, which is the exact
 * failure mode this site is arranged to prevent.
 */
function tokensFor(path: string): readonly Token[] {
  const cached = lexed[path];
  if (cached !== undefined) return cached;

  const html = highlights.files[path];
  if (html === undefined) {
    const known = Object.keys(highlights.files);
    throw new Error(
      `highlight: site/records/highlight.json has no entry for "${path}". ` +
        `Token classes on this site come from the compiler's own lexer, so a ` +
        `file with no record cannot be rendered as code, and rendering it as ` +
        `plain text would make it the one listing without the emphasis that ` +
        `carries the argument. It records ${known.length} files: ` +
        `${known.slice(0, 8).join(", ")}${known.length > 8 ? ", ..." : ""}. ` +
        `Regenerate with ${highlightProvenance.command}.`,
    );
  }

  const tokens = lexHighlighterHtml(html, path);
  lexed[path] = tokens;
  return tokens;
}

/**
 * The recorded highlighting for one file, one balanced HTML string per line.
 *
 * `path` is the repository relative path, which is exactly the key the recorder
 * writes, so `samples/iyi/hello.iyi` and `site/records/break/r2.iyi` both
 * resolve through this one call.
 */
export function highlightedLines(path: string): string[] {
  const cached = reflowed[path];
  if (cached !== undefined) return cached;

  const lines = reflowLines(tokensFor(path));
  reflowed[path] = lines;
  return lines;
}

/**
 * The text the record encodes, recovered by stripping tags and unescaping.
 *
 * This exists so a caller can prove the record still describes the file it
 * claims to. `Sample.astro` compares it against the file the samples index
 * read, so a record that went stale against an edited sample fails the build
 * instead of highlighting the wrong tokens over the right text.
 */
export function recordedText(path: string): string {
  return textOfTokens(tokensFor(path));
}
