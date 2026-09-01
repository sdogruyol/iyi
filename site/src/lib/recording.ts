/**
 * How a recording is set on the page.
 *
 * Two components render one: `Quote`, which quotes a session out of README.md,
 * and `BreakRule`, which renders a compiler verdict out of
 * `site/records/diagnostics.json`. They are two sources of the same kind of
 * evidence, so they share this one classifier rather than each carrying its own
 * idea of what a caret line looks like.
 *
 * A recording is classified, never rewritten. Every character of the recording
 * reaches the page, and the only decision made here is which span each line
 * sits in, which is what lets the caret line stay exactly as the compiler
 * printed it while still being coloured with the signal.
 *
 * The two faces are styled in styles/code.css:
 *
 *   console     a real run. The prompt and the command are marked, output is
 *               not, because nothing highlighted it in the terminal.
 *   diagnostic  a compiler error. iyi's errors name the rule they enforce,
 *               which is a feature, so the rule citation is pulled into a
 *               cited footer by the component and the caret is in signal.
 */

export type RecordingFace = "console" | "diagnostic";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** One line of a recording, wrapped in the span its face gives it. */
export function markLine(line: string, as: RecordingFace): string {
  const text = escapeHtml(line);

  if (as === "console") {
    if (line.startsWith("$")) {
      return `<span class="prompt">$</span><span class="cmd">${escapeHtml(line.slice(1))}</span>`;
    }
    return `<span class="out">${text}</span>`;
  }

  // A diagnostic. `$` is the command that produced it and `In ...` is the
  // compiler naming the file and line, so both are where rather than what.
  if (line.startsWith("$") || line.startsWith("In ")) {
    return `<span class="where">${text}</span>`;
  }
  if (/^\s*\^/.test(line)) {
    return `<span class="caret">${text}</span>`;
  }
  if (line.startsWith("Error:")) {
    return `<span class="verdict">${text}</span>`;
  }
  return text;
}

/**
 * A whole recording, line by line.
 *
 * The single trailing newline a file or a stream ends with is not content, so
 * it is dropped. Nothing else is touched: no trim, no reflow, no collapsing of
 * blank lines, because the caret line's leading spaces are what make it point
 * at anything.
 */
export function renderRecording(text: string, as: RecordingFace): string {
  return text
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => markLine(line, as))
    .join("\n");
}
