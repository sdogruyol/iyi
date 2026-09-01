/**
 * The token stream, and everything the site does to one.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `highlight.ts`. There are now two places
 * a token stream can come from, and they have to be painted by the same code.
 *
 *   1. The recording. `site/records/highlight.json` holds one HTML string per
 *      file, produced by `Crystal::SyntaxHighlighter::HTML` running inside the
 *      iyi fork's own compiler. `highlight.ts` owns that file.
 *   2. A live lexer. When iyi's own compiler runs as wasm in the page it can
 *      lex what somebody is typing, with no network involved and nothing
 *      leaving the machine, and this module is the receiving end of that
 *      stream.
 *
 * If the reflow and the rule-word emphasis lived inside `highlight.ts`, the
 * live path could not use them: that module imports the whole recording at
 * module scope, and pulling a recording of every listing on the site into a
 * browser to paint six lines of someone's own program is not a tradeoff, it is
 * a mistake. Splitting them would have been worse. The same page would then
 * emphasise different words depending on where its tokens came from, and the
 * emphasis IS the argument the listings are making, so the page would be making
 * two different arguments at once and nothing would report it.
 *
 * So this module holds the pure half, it imports no recording, and it touches
 * no browser global at import time. Both callers get the identical treatment
 * because there is only one copy of it.
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
 * There is no grammar in here. A hand written scanner would be a second
 * grammar, it would drift from the compiler's silently, and the drift would
 * show up as a keyword the site does not think is a keyword. What this module
 * does is reparse and re emit markup the compiler produced, which is why every
 * function below either asserts a shape or preserves one.
 */
import ruleWords from "./rule-words.json";

/** One lexed token: the class the compiler gave it, and its literal text. */
export interface Token {
  /** The class attribute verbatim, so a `k tok-rule` split survives. Empty
   * for text the lexer did not classify, which is whitespace and punctuation
   * it does not tokenise. */
  cls: string;
  text: string;
}

/**
 * iyi's own keywords, the ones the art direction sets heavier than Crystal's.
 *
 * `site/src/lib/rule-words.json` owns the list for everything in `src`, and its
 * `why` field carries the reasoning, because JSON has nowhere to put a comment.
 * Every path through this module reads it, so the recorded listings and the
 * live editor cannot emphasise different words.
 *
 * KNOWN DUPLICATION, deliberately left for a separate change:
 * `site/scripts/record-highlight.mjs` still declares its own array of the same
 * words, and that copy is the one stamped into `site/records/highlight.json`.
 * Until the recorder is pointed at the JSON, the two lists agree only because
 * someone keeps them in step, and nothing in the build says so. Anyone adding
 * or removing a rule word has to edit both.
 */
export const RULE_WORDS: readonly string[] = ruleWords.words;

/**
 * The list is checked here, once, at first import.
 *
 * Both failures below are silent ones, which is why they are worth a guard. An
 * empty list builds the pattern `<span class="k">()</span>`, whose alternation
 * matches only the empty string, so it matches a keyword span with no text and
 * nothing else: over real markup the pass becomes a no-op and every rule word
 * loses its emphasis with no error anywhere. A word carrying a regexp
 * metacharacter would quietly change what the alternation means. Neither can
 * happen while the words are identifiers and there is at least one of them.
 */
if (RULE_WORDS.length === 0) {
  throw new Error(
    `tokens: site/src/lib/rule-words.json lists no words, so the rule-word ` +
      `emphasis would be applied to nothing. That emphasis is what the site's ` +
      `listings argue with, so an empty list is a build failure rather than a ` +
      `page that quietly stops making the argument.`,
  );
}
for (const word of RULE_WORDS) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(word)) {
    throw new Error(
      `tokens: site/src/lib/rule-words.json lists "${word}", which is not an ` +
        `identifier. The words are joined into a regular expression, so a ` +
        `metacharacter here would change what that expression matches instead ` +
        `of adding a keyword to it.`,
    );
  }
}

const UNESCAPE: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * A keyword span whose text is exactly one of iyi's words.
 *
 * Built from `RULE_WORDS`, so the words are not written out a second time here.
 * Nothing anchors the word because nothing needs to: the pattern already
 * requires the span's entire text to be the word, so `impl` matches and
 * `implementation` cannot. Held at module scope because it never varies, and
 * `String.prototype.replace` resets a global pattern's `lastIndex` itself, so
 * there is no state to carry between calls.
 */
const RULE_SPAN = new RegExp(
  `<span class="k">(${RULE_WORDS.join("|")})</span>`,
  "g",
);

/**
 * Reparse highlighter HTML into tokens.
 *
 * The shape is flat by construction: the highlighter emits
 * `<span class="x">text</span>` and bare text, and never nests one span inside
 * another. This asserts that rather than assuming it, because a nested span
 * would make the reflow below drop a class and the listing would lose emphasis
 * with no error anywhere.
 *
 * `label` names the stream in the three failures. It is a repository relative
 * path when the stream came out of the recording, and it is whatever the
 * playground calls the buffer when the stream came from a live lexer, which is
 * the only reason this takes a label rather than a path.
 */
export function lexHighlighterHtml(html: string, label: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /<span class="([^"]*)">|<\/span>/g;
  let at = 0;
  let open: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const text = html.slice(at, match.index);
    if (text.length > 0) tokens.push({ cls: open ?? "", text });
    at = match.index + match[0].length;

    if (match[0] === "</span>") {
      if (open === null) {
        throw new Error(
          `highlight: the record for ${label} closes a span that was never ` +
            `opened, at character ${match.index}. The record is malformed.`,
        );
      }
      open = null;
    } else {
      if (open !== null) {
        throw new Error(
          `highlight: the record for ${label} nests a "${match[1]}" span ` +
            `inside an open "${open}" span, at character ${match.index}. This ` +
            `module reflows a flat token stream and would drop the outer ` +
            `class, so a nested record is a build failure rather than a ` +
            `listing that quietly loses its emphasis.`,
        );
      }
      open = match[1];
    }
  }

  if (open !== null) {
    throw new Error(
      `highlight: the record for ${label} ends inside an open "${open}" span. ` +
        `The record is malformed.`,
    );
  }
  const tail = html.slice(at);
  if (tail.length > 0) tokens.push({ cls: "", text: tail });
  return tokens;
}

/**
 * Re emit tokens one line at a time.
 *
 * A token carrying newlines is split at each one and its element is closed and
 * reopened, so every returned line is independently balanced HTML and any run
 * of them concatenates correctly. This is the whole reason this module exists.
 */
export function reflowLines(tokens: readonly Token[]): string[] {
  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    const pieces = token.text.split("\n");
    for (let i = 0; i < pieces.length; i += 1) {
      if (i > 0) {
        lines.push(current);
        current = "";
      }
      const piece = pieces[i];
      if (piece.length === 0) continue;
      current +=
        token.cls === ""
          ? piece
          : `<span class="${token.cls}">${piece}</span>`;
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Escape source text for insertion beside highlighted HTML.
 *
 * Used where a page renders text the token stream does not cover, so both
 * halves are escaped by the same rules and a stray `<` cannot become markup.
 */
export function escapeCode(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPE[char]);
}

/**
 * The text a token stream encodes.
 *
 * Token text is markup, so the entities come back out here. This exists so a
 * caller can prove a stream describes the program it claims to: compare this
 * against the source that was handed to the lexer and a stream that answers
 * about some other text fails loudly instead of painting the right tokens onto
 * the wrong characters. One pass over one pattern, so an `&amp;` cannot be
 * unescaped twice.
 */
export function textOfTokens(tokens: readonly Token[]): string {
  let text = "";
  for (const token of tokens) text += token.text;
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => UNESCAPE[entity]);
}

/**
 * Mark the keyword spans that carry iyi's own words.
 *
 * This runs after the lexer and never instead of it. The lexer answers what a
 * token is, and it is right that `pub` and `if` are both keywords; the art
 * direction answers which tokens are iyi's delta from Crystal, which is the
 * subject a reader came for. Only a class attribute changes, never a token
 * boundary, so the emphasis cannot invent a token the compiler did not see.
 *
 * Idempotent, which matters more than it looks. The recording already carries
 * the split, because the recorder applied it, so a recorded stream passed
 * through here is unchanged: the pattern demands `class="k"` exactly and an
 * already marked span reads `class="k tok-rule"`. That is what lets the live
 * path and the recorded path share one pipeline without the recorded one being
 * marked twice.
 */
export function emphasiseRuleWords(html: string): string {
  return html.replace(
    RULE_SPAN,
    (_match, word) => `<span class="k tok-rule">${word}</span>`,
  );
}

/**
 * The whole treatment for a live token stream, verified against its source.
 *
 * Emphasise, lex, prove, reflow. `expected` is the text the caller handed the
 * lexer, and the proof is the point of the function: a stream is only ink for
 * the program it was lexed from, and the failure it guards against is not a
 * crash but a listing that looks entirely plausible and is wrong. That happens
 * for real, because a live editor sends a request per edit and the answers can
 * arrive out of order or late, so the newest keystrokes and the newest tokens
 * are not automatically about the same characters.
 *
 * The throw is read by a developer, not by a visitor: the playground catches it
 * and paints plain ink instead, which is a listing with no emphasis rather than
 * a listing with wrong emphasis.
 */
export function inkLines(
  html: string,
  label: string,
  expected: string,
): string[] {
  const tokens = lexHighlighterHtml(emphasiseRuleWords(html), label);
  const recovered = textOfTokens(tokens);
  if (recovered !== expected) {
    // Scanned here rather than in a helper so it costs nothing on the path
    // that succeeds, which is every keystroke. When one string is a prefix of
    // the other the divergence is the end of the shorter one, which is the
    // honest answer and what this loop reports.
    const shared = Math.min(recovered.length, expected.length);
    let at = shared;
    for (let i = 0; i < shared; i += 1) {
      if (recovered[i] !== expected[i]) {
        at = i;
        break;
      }
    }
    throw new Error(
      `tokens: the stream named "${label}" encodes text that is not the text ` +
        `it was given, first differing at character ${at} of ` +
        `${recovered.length} recovered against ${expected.length} expected. ` +
        `Painting one program's tokens over another program's characters is ` +
        `the defect this check exists to prevent: it produces a listing that ` +
        `is entirely plausible and entirely wrong, with every keyword in a ` +
        `place no compiler put it. Whoever calls this should ink the text ` +
        `plainly rather than ink it falsely.`,
    );
  }
  return reflowLines(tokens);
}
