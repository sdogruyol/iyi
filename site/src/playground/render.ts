/**
 * One renderer for a diagnostic, used on both sides of the build.
 *
 * The playground's diagnostics pane is rendered during the static build, so a
 * visitor with no JavaScript still gets the real compiler output, and it is
 * re-rendered in the browser from the engine's event stream, so the pane is fed
 * by the path a checking engine would feed rather than by a special case. Those
 * are two different environments: one composes an HTML string, the other writes
 * into a live element. If each had its own renderer the two would drift, and
 * the drift would be a diagnostic that looks different depending on whether
 * scripts ran.
 *
 * So there is one function, it emits a string, and the browser assigns that
 * string. It escapes everything it emits, so assigning it is not a way for
 * compiler output to become markup.
 *
 * The treatment is the one `site/src/styles/code.css` defines for
 * `.diagnostic`, and the classification is the same as `Quote.astro` applies to
 * a diagnostic quoted from README.md, because a compiler error should not look
 * like two different things on two pages of the same site:
 *
 *   .where    the compiler's own `In file:line:column` header
 *   .caret    the caret line, preserved character for character
 *   .verdict  the `Error:` line
 *   .cites    the rule, pulled into a footer under a hairline
 */
import type { RunEvent } from "./types";

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Classify one line of compiler output.
 *
 * Every character of the line reaches the page: the only decision is which span
 * it sits in. Nothing is reflowed, nothing is trimmed, and in particular the
 * caret line keeps its leading spaces, because those spaces are how it points
 * at a column.
 */
function markLine(line: string): string {
  const text = line.replace(/[&<>"']/g, (char) => ESCAPE[char]);
  if (line.startsWith("In ")) return `<span class="where">${text}</span>`;
  if (/^\s*\^/.test(line)) return `<span class="caret">${text}</span>`;
  if (line.startsWith("Error:")) return `<span class="verdict">${text}</span>`;
  return text;
}

/**
 * The inner HTML of a `.diagnostic` block for one diagnostic event.
 *
 * The caller supplies the wrapper, because the build supplies it as markup and
 * the browser supplies it as an element, and both then carry the same class.
 *
 * `cite` is appended to the footer after the rule. The playground uses it to
 * name the command that produced the output, which is the same provenance rule
 * the rest of the site follows: the thing that prints a fact is named beside
 * the fact.
 */
export function diagnosticHtml(
  event: Extract<RunEvent, { kind: "diagnostic" }>,
  cite?: string,
): string {
  const body = event.message.split("\n").map(markLine).join("\n");
  const footer = [
    event.rule === null
      ? "the compiler cited no rule for this one"
      : `rule: ${event.rule}, SPEC.md`,
    cite,
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(". ")
    .replace(/[&<>"']/g, (char) => ESCAPE[char]);

  return `<pre>${body}</pre><span class="cites">${footer}</span>`;
}
