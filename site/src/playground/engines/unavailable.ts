/**
 * The honest null object.
 *
 * This is a real implementation of `PlaygroundEngine` that does nothing and
 * says so precisely. It exists because the alternative shapes are all worse:
 *
 *   - A `null` engine forces every caller to branch, and the branch that gets
 *     forgotten is the one that renders an enabled button.
 *   - A stub that echoes the source and prints "exit 0" is a fabricated
 *     result. This site's whole argument is that a claim without a measurement
 *     behind it is worthless, so a playground that fakes a run would be the
 *     one page here that contradicts the rest.
 *   - Hiding the playground would leave the question of whether iyi runs in a
 *     browser unanswered, when the honest answer is known and is that it does
 *     not, here, yet.
 *
 * So this engine claims nothing, accepts no source, and emits exactly one
 * event: a refusal that names what is missing. It contains no `exit` event, no
 * `stdout`, and no path that reports success. That is deliberate and it is the
 * property to preserve if this file is ever edited.
 */
import type {
  Capabilities,
  PlaygroundEngine,
  RunEvent,
  RunOptions,
  SourceFile,
} from "../types";

/**
 * What is actually missing, each line traceable to a file in this repository.
 * These are rendered verbatim in the provenance rail beside the playground, so
 * they are written to be read by a person and to be checkable by a sceptic.
 */
const MISSING: string[] = [
  "no engine registered in src/playground/registry.ts",
  "the compiler is a native program: building it needs LLVM 19 and a Crystal compiler to bootstrap from (README.md)",
  "wasm32-wasi is a supported target, and one of the four that CI runs every build, under wasmtime (README.md)",
  "but a wasm32-wasi module becomes a program only once wasi-libc's entry stub is linked in, and this fork prints cc --target=wasm32-wasi for that target rather than wasm-ld (README.md)",
  "so a browser engine needs a link step and a wasi host in the page, not only a compiler",
  "and the page cannot be cross-origin isolated on GitHub Pages, so no SharedArrayBuffer, no wasm threads, no synchronous stdin (see src/playground/types.ts)",
];

/**
 * The refusal, assembled from the same list. Written once here rather than
 * typed twice, because two copies of a caveat drift and the stale one is the
 * one that gets read.
 */
const REASON = [
  "No playground engine is wired up, so nothing compiled and nothing ran.",
  "What is missing:",
  ...MISSING.map((line) => `  - ${line}`),
].join("\n");

const CAPABILITIES: Capabilities = {
  /** Claims nothing. Every control in the shell therefore renders disabled,
   * each one naming its own missing capability. */
  supported: [],
  /** Zero, because no source is accepted. A nonzero budget would imply an
   * input is being read, and the shell turns the source pane read only on
   * exactly this number. */
  maxSourceBytes: 0,
  notes: MISSING,
};

export const unavailableEngine: PlaygroundEngine = {
  id: "unavailable",
  label: "no engine",

  /**
   * Resolves. Nothing is broken: an engine with no capabilities is ready, it
   * is simply honest. Rejecting would make the page show a fault, and there is
   * no fault to show.
   */
  async ready(): Promise<void> {},

  capabilities(): Capabilities {
    return CAPABILITIES;
  },

  /**
   * `_files` is unread, and that is the point: this engine never looks at the
   * source, so it cannot accidentally report anything about it. The refusal
   * names the capability that was asked for, and defaults to `compile` since
   * that is the first stage it cannot reach.
   *
   * One event, then the stream ends. No `exit` is emitted, because no program
   * ran and there is no status to report.
   */
  async *run(_files: SourceFile[], opts: RunOptions): AsyncIterable<RunEvent> {
    yield {
      kind: "unsupported",
      capability: opts.want ?? "compile",
      reason: `${REASON}\n\nasked for: ${opts.want ?? "compile"}`,
    };
  },

  /** Nothing runs, so there is nothing to abandon. */
  cancel(): void {},

  /** Nothing was loaded, so there is nothing to release. */
  dispose(): void {},
};
