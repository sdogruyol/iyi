/**
 * Recorded compiler diagnostics, turned into engine events.
 *
 * WHY THESE ARE RECORDED. They are not a substitute for a checker that could
 * not exist. They are the evidence page's material: real programs that are
 * really wrong, and the real compiler's refusal of each one, kept beside the
 * rule it enforces.
 *
 * The reason a page cannot compile for itself is the linker. Producing a
 * program from a module shells out to a linker driver, and a page has no
 * subprocesses, so the playground is parked rather than shipped. Sending the
 * source to a service instead was refused on purpose, because compiling
 * elsewhere proves the elsewhere has a compiler.
 * `doc/website/PLAYGROUND-SERVICE.md` carries the specification and the
 * refusal.
 *
 * The older reason, that the compiler could not report a diagnostic from wasm
 * at all, no longer holds: the exception wall is cleared and `rescue` works on
 * `wasm32`, which is section 11 of
 * `doc/website/PLAYGROUND-FEASIBILITY.md`. A checker in the page is reachable
 * now, and when one lands it feeds this same event path.
 *
 * WHAT IS HERE INSTEAD. `site/records/break/*.iyi` are real programs that are
 * really wrong, committed to this repository. The recorder runs the real
 * compiler on each one and stores the exit status and the standard error
 * verbatim in `site/records/diagnostics.json`. This module reads that record
 * and emits it as `diagnostic` events on the engine's normal stream, so the
 * pane that renders them is fed by the same path a checking engine would feed,
 * and wiring one in replaces the engine and nothing else.
 *
 * WHAT IS NOT DONE TO THE TEXT. Nothing. `message` is the compiler's standard
 * error exactly as it was captured, caret line and all, including the frame
 * note it prints first. The file, line and column are PARSED OUT of it so that
 * a consumer has them structurally, and they are not removed from it, because
 * a diagnostic on this site is shown as the compiler prints it and a renderer
 * that reflowed the caret line would break the one thing the caret is for.
 */
import type { RunEvent } from "./types";
import type { Provenance } from "./samples";
import record from "../../records/diagnostics.json";

/** One recorded case, exactly as the recorder wrote it. */
export interface DiagnosticCase {
  /** Stable id, used in markup. */
  id: string;
  /** The rule the compiler enforced, for example `R-2`. iyi's errors naming
   * the rule they enforce is a feature of the language, so it travels
   * structurally rather than being left inside the message text. */
  rule: string;
  /** A short human title for the case, written by the recorder. Not part of
   * the compiler's output and never rendered as if it were. */
  title: string;
  /** Repository relative path of the program that is wrong. */
  path: string;
  /** The exact command the recorder ran. */
  command: string;
  /** The status the compiler really exited with. */
  exitCode: number;
  /** Standard error, verbatim, unmodified. */
  stderr: string;
}

interface DiagnosticsRecord {
  recorded: Provenance;
  cases: DiagnosticCase[];
}

const diagnostics = record as DiagnosticsRecord;

export const diagnosticsProvenance: Provenance = diagnostics.recorded;

for (const field of [
  "compiler",
  "commit",
  "machine",
  "command",
  "when",
] as const) {
  if (!diagnosticsProvenance?.[field]) {
    throw new Error(
      `playground: site/records/diagnostics.json has no ` +
        `"recorded.${field}". Compiler output with no record of which ` +
        `compiler produced it is an anecdote. Regenerate the record.`,
    );
  }
}

if (!Array.isArray(diagnostics.cases) || diagnostics.cases.length === 0) {
  throw new Error(
    "playground: site/records/diagnostics.json records no cases, so the " +
      "diagnostics pane would render empty and the page would imply that " +
      "nothing in samples/ can be got wrong.",
  );
}

/** The cases, in the recorder's order. */
export const diagnosticCases: readonly DiagnosticCase[] = diagnostics.cases;

/**
 * The compiler's location header, which it prints as `In path:line:column`.
 *
 * Anchored to the start of a line so a path appearing in prose cannot be read
 * as the location. A case whose output has no such header is a build failure
 * rather than a diagnostic with a guessed position, because a fabricated line
 * number in a diagnostic is worse than no diagnostic.
 */
const LOCATION = /^In (.+):(\d+):(\d+)\s*$/m;

/**
 * Every recorded case as a `diagnostic` event, in the record's order.
 *
 * Pure and safe in node, because the shell renders this pane during the static
 * build as well as in the browser.
 */
export function recordedDiagnostics(): RunEvent[] {
  return diagnosticCases.map((entry) => {
    if (!entry.stderr) {
      throw new Error(
        `playground: recorded case "${entry.id}" has no stderr, so there is ` +
          `nothing the compiler said. A case with no output is a recorder ` +
          `failure and not an empty diagnostic.`,
      );
    }
    const found = LOCATION.exec(entry.stderr);
    if (found === null) {
      throw new Error(
        `playground: recorded case "${entry.id}" has compiler output with no ` +
          `"In file:line:column" header, so this module cannot say where the ` +
          `error is. Guessing a position would put a made up line number in ` +
          `front of a real error. The output was:\n${entry.stderr}`,
      );
    }
    return {
      kind: "diagnostic",
      file: found[1],
      line: Number(found[2]),
      column: Number(found[3]),
      /* Verbatim. The location is parsed out above and left in, because the
       * caret line below it counts columns from the text as printed. */
      message: entry.stderr.replace(/\n+$/, ""),
      rule: entry.rule || null,
    };
  });
}
