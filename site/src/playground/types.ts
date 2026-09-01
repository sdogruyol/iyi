/**
 * The playground engine contract.
 *
 * This file is a boundary, not an implementation. The shell in
 * `src/components/Playground.astro` is built against this interface. What can
 * actually compile iyi inside a browser is a separate question, it is not
 * settled here, and nothing in this repository answers it yet. So the shell
 * talks to exactly one interface, `PlaygroundEngine`, and the only engine
 * registered today is the honest null object in `engines/unavailable.ts`.
 *
 * THE CENTRAL DESIGN POINT: `capabilities()` drives the UI.
 *
 * The shell reads `capabilities()` at build time and renders every control the
 * interface has. A control whose capability the engine does not claim is
 * rendered genuinely disabled, carrying a mono note naming the capability that
 * is missing. It is not hidden, because hiding it would let the page imply
 * that the playground is whole. It is not left clickable, because a control
 * that does nothing is a lie told by an affordance.
 *
 * So an engine that can type-check but cannot link produces a SMALLER
 * playground rather than a broken one. There is no code path in this directory
 * that renders a result the engine did not produce, no synthetic success, and
 * no placeholder output. That is the argument the rest of this site makes
 * about numbers, applied to an interface: an unmet claim is shown as unmet.
 */

/* ---------------------------------------------------------------------------
 * HARD CONSTRAINT ON EVERY ENGINE: this page is not cross-origin isolated.
 *
 * Hand this section to anyone who starts writing an engine, because it rules
 * out an entire class of implementation and no amount of cleverness inside the
 * engine can recover it.
 *
 * The site deploys to GitHub Pages. Pages serves static files and offers no
 * way to set an HTTP response header, so `Cross-Origin-Opener-Policy` and
 * `Cross-Origin-Embedder-Policy` cannot be sent. The document is therefore
 * never cross-origin isolated and `self.crossOriginIsolated` is false in the
 * page. What follows:
 *
 *   1. `SharedArrayBuffer` is unavailable. The constructor is not exposed.
 *   2. Therefore wasm threads are unavailable. A shared `WebAssembly.Memory`
 *      (`shared: true`) cannot be created, so a module compiled with pthreads
 *      or with the atomics feature enabled will not instantiate. A single
 *      threaded build is the only build that can run here.
 *   3. Therefore `Atomics.wait` is unavailable, and with it the standard trick
 *      for synchronous stdin from a worker. An engine cannot block a wasm call
 *      on a promise. Any input a program needs must be handed over up front as
 *      `SourceFile[]`, or the engine must declare that it does not support
 *      reading input at all.
 *   4. Timers are coarse for the same isolation reason: `performance.now()` is
 *      clamped by the browser. See the note on the `exit` event.
 *
 * A second constraint, from the build rather than the browser: the shell calls
 * `capabilities()` during a static Astro build, in node, where there is no
 * `window`, no `document` and no `WebAssembly` instance. So `capabilities()`
 * MUST be synchronous, pure, and safe to call with no browser present, and an
 * engine module MUST NOT touch browser globals or instantiate anything at
 * import time. Do the loading inside `ready()`, which only ever runs in a
 * browser.
 * ------------------------------------------------------------------------- */

/**
 * One file handed to the engine.
 *
 * `path` is not decoration. In iyi a module names itself and the module's path
 * is its file's path (README.md, the table comparing `require` with `import`:
 * "`import app/foo` names a module, and the module's path is its file's
 * path"). An engine that resolves an `import` has to resolve it against these
 * paths, so the shell always sends a path even when it sends one file.
 */
export interface SourceFile {
  path: string;
  text: string;
}

/**
 * What an engine may be able to do. This union is the vocabulary the UI is
 * built from: every control on the page names exactly one of these, and every
 * refusal names one too.
 *
 *   compile       turn source into an object or a module, front end and back
 *                 end, whatever "compile" means for that engine's pipeline
 *   run           execute the result and stream its output back
 *   emit-iyimod   produce the module artifact iyi type-checks consumers
 *                 against, the thing R-1 makes the unit of compilation
 *   mod-dump      print an artifact as text, what `iyi mod dump` does
 *   format        rewrite source in canonical form, what `iyi tool format` does
 *   diagnostics   report errors with a file, a line, a column and the rule
 *                 they enforce, rather than as opaque failure text
 *
 * `diagnostics` is separate from `compile` on purpose. An engine can plausibly
 * fail a build without being able to say where or why, and a playground that
 * shows a red box with no location is worth less than one that admits it has
 * no locations to show. Claiming `compile` without `diagnostics` is a real and
 * legitimate answer.
 */
export type Capability =
  | "compile"
  | "run"
  | "emit-iyimod"
  | "mod-dump"
  | "format"
  | "diagnostics";

/**
 * The engine's own account of itself, and the only input to how the UI is
 * shaped.
 *
 * `supported` is a whitelist. Absence is not an error state, it is the normal
 * case: this contract expects engines that do part of the job.
 *
 * `maxSourceBytes` is a budget, not advice. The shell shows it, refuses to
 * send more than it, and renders the source pane read only when it is 0, which
 * is how an engine says "I accept no source at all". An engine that will
 * happily take anything should still publish a number, because a browser tab
 * has a memory ceiling and a playground that dies silently on a large paste is
 * a worse answer than one that says no.
 *
 * `notes` is the caveat channel, in the engine's own words, rendered verbatim
 * in the provenance rail beside the playground. Anything true and awkward goes
 * here: what it cannot link, what it stubs, what it needs and has not got.
 * The site publishes where it loses, and an engine is held to the same rule.
 */
export interface Capabilities {
  supported: Capability[];
  maxSourceBytes: number;
  notes: string[];
}

/**
 * Everything an engine can tell the page, as a stream.
 *
 * A stream rather than a returned result because compiling is not
 * instantaneous and a page that goes blank while it waits has to invent
 * something to show. Discriminated on `kind` so the renderer switches on one
 * field and a new event kind cannot be quietly ignored: adding a member here
 * makes the shell's switch fail to typecheck until it is handled.
 */
export type RunEvent =
  /** A chunk of the program's standard output, exactly as it was written. */
  | { kind: "stdout"; text: string }
  /** A chunk of standard error. Kept separate because a program that writes
   * to both has said something about which is which, and merging the two
   * would throw that away. */
  | { kind: "stderr"; text: string }
  /**
   * A structured compiler message.
   *
   * iyi's diagnostics name the rule they enforce, and README.md treats that as
   * a feature of the language rather than a nicety of the tooling, so the rule
   * travels in the event instead of being buried in the message text. `rule`
   * is `string | null` rather than optional: an engine must say explicitly
   * that a diagnostic cited no rule, so that "this compiler does not report
   * rules" and "this diagnostic has no rule" stay distinguishable.
   */
  | {
      kind: "diagnostic";
      file: string;
      line: number;
      column: number;
      message: string;
      rule: string | null;
    }
  /**
   * A build product: an object, a binary, a `.iyimod`.
   *
   * `bytes` is the artifact's size in bytes. Size is the honest thing to
   * report because it is what this project's efficiency claim is made of, and
   * a size the reader cannot check is only an assertion, so `data` carries the
   * artifact itself when the engine has it in hand and is `null` when it does
   * not. An engine that has the bytes hands them over.
   */
  | { kind: "artifact"; name: string; bytes: number; data: Uint8Array | null }
  /**
   * The program ended. `code` is its real exit status and `ms` is wall clock
   * for the run.
   *
   * `ms` is a RECORDED number in this site's terms: it is a property of the
   * visitor's machine and browser, not of the language, and browsers clamp the
   * clock besides. So the shell never renders it as a bare figure. It goes
   * inside a frame that names what produced it, the same way every recorded
   * number on this site carries its machine and its command.
   *
   * An engine MUST NOT emit this event unless a program actually ran to
   * completion. A synthesised exit 0 is the exact dishonesty this whole
   * directory is arranged to prevent.
   */
  | { kind: "exit"; code: number; ms: number }
  /**
   * The engine was asked for something it cannot do, and says so.
   *
   * `run()` is the only entry point, so an engine performs as much of the
   * pipeline as its capabilities allow and yields this for the first
   * capability it cannot honour. `capability` is that capability, which lets
   * the shell attribute the refusal to a specific control instead of showing
   * an undifferentiated failure. `reason` is prose for a human, and it is
   * expected to name what is missing rather than apologise.
   *
   * This event is not an error. It is the engine being accurate, and it is the
   * one thing `unavailableEngine` ever emits.
   */
  | { kind: "unsupported"; capability: Capability; reason: string };

/**
 * What the shell hands to `run`.
 *
 * `entry` is a path, and it must be one of the `path` values in `files`. The
 * shell does not infer an entry point from ordering, because a module's
 * identity is its path and guessing would be the one place this interface
 * pretended to know something about the language.
 *
 * `flags` are compiler flags, passed through untouched. An engine that does
 * not understand a flag should say so in an `unsupported` event rather than
 * ignore it, because silently dropping `--release` and then reporting a
 * duration would be a measurement lie.
 *
 * `want` names which capability the page is asking for, so that one entry
 * point serves every control: run with no `want` asks for `run`, the emit
 * control passes `"emit-iyimod"`, and so on. An engine that cannot reach that
 * stage yields an `unsupported` event whose `capability` names the stage that
 * stopped it, so the refusal carries a capability back the same way the
 * request carried one. It is optional only because `run` is the default,
 * never because the field is decorative.
 */
export interface RunOptions {
  entry: string;
  flags?: string[];
  want?: Capability;
}

/**
 * The slot.
 *
 * One engine is active at a time, registered in `registry.ts`. Everything the
 * page knows about compiling iyi arrives through these six members.
 */
export interface PlaygroundEngine {
  /** Stable machine name, used in markup and in a refusal. */
  readonly id: string;
  /** Human name, shown on the page. */
  readonly label: string;
  /**
   * Load whatever the engine needs, in the browser.
   *
   * Resolves when the engine is usable, rejects when it is genuinely broken.
   * It must NOT reject merely because the engine can do nothing: an engine
   * with no capabilities is ready, it is just honest, and a rejection would
   * make the page show a fault where there is none.
   *
   * This is never called during the static build. `capabilities()` is.
   */
  ready(): Promise<void>;
  /**
   * The engine's account of itself. Synchronous, pure, safe in node with no
   * browser globals, and safe to call before `ready()`, because the shell
   * calls it at build time to decide what to render.
   */
  capabilities(): Capabilities;
  /**
   * Do the work, streaming events as they happen.
   *
   * Must not throw for anything it can express as an event: an unsupported
   * capability is an `unsupported` event, a broken program is `diagnostic` and
   * `stderr`. A thrown error means the engine itself failed, and the shell
   * reports it as such rather than as the program's fault.
   */
  run(files: SourceFile[], opts: RunOptions): AsyncIterable<RunEvent>;
  /**
   * Abandon the current run. The iterable returned by `run` must then
   * complete. If a program was actually running and was actually killed, the
   * engine may emit its real `exit`; if nothing ran, it must emit no `exit` at
   * all, because there is no status to report.
   */
  cancel(): void;
  /** Release the engine's resources. After this, `ready()` must be called
   * again before another `run`. */
  dispose(): void;
}

/**
 * The label the UI puts on a capability. It lives beside the union so that a
 * new capability cannot be added without naming it, and so the shell and any
 * engine's refusal text use the same words for the same thing.
 */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  compile: "build",
  run: "run",
  "emit-iyimod": "emit .iyimod",
  "mod-dump": "mod dump",
  format: "format",
  diagnostics: "diagnostics",
};
