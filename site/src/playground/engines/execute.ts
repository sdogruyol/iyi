/**
 * Executing a wasm32-wasi module in the page, which is the one thing every
 * engine does and therefore the one place it is written.
 *
 * `wasi.ts` runs recorded modules the compiler produced elsewhere, and today it
 * is the only engine there is. The engine that fills the `PlaygroundEngine`
 * slot next is a local wasm build of iyi's own compiler, and it will run
 * modules it compiled in the tab from source a visitor typed. Where those two
 * differ is entirely in how the bytes arrive; once the bytes are here, the
 * instantiation, the argv, the trap handling, the output ordering and the exit
 * accounting are identical, and duplicating them would mean a defect could be
 * fixed on one path and live on for the other. A visitor cannot tell which
 * engine produced a run, so the two must not be able to disagree about what
 * running means.
 *
 * Nothing in this file fetches, verifies a digest, or decides whether bytes
 * are trustworthy. That is the caller's job, and keeping it out of here is
 * deliberate: the two callers answer "are these the bytes I think they are"
 * with different evidence, a committed manifest for a recorded module on one
 * side and the fact that this session compiled it for a fresh one on the
 * other, and folding those two claims into one function would blur them.
 */
import type { RunEvent } from "../types";
import { WasiExit, WasiHost, decodeWrites } from "./wasi-preview1";

/** Hex sha256 of exactly these bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  /* A fresh copy, because `crypto.subtle` wants an ArrayBuffer and a subarray
   * view would hash the whole underlying buffer. */
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Yield to the event loop so the page paints one chunk before the next. */
export function nextFrame(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

export interface ExecuteOptions {
  /** The module's bytes, already established as the ones the caller means. */
  bytes: Uint8Array;
  /** What to call the module in an artifact event and in a refusal. */
  name: string;
  /**
   * `argv[0]`, which in iyi is the module's own path, since a module names
   * itself by its file's path. wasi-libc's start stub reads it, so it is a
   * requirement rather than a flourish.
   */
  argv0: string;
  /** Asked between events, so a cancel stops the stream at a boundary. */
  isCancelled: () => boolean;
  /**
   * An already compiled module, when the caller has one cached. Compiling is
   * the expensive half, and a second run of the same sample should measure
   * execution rather than compilation.
   */
  compiled?: WebAssembly.Module;
  /** Handed the compiled module so the caller can cache it. */
  onCompiled?: (module_: WebAssembly.Module) => void;
}

/**
 * Instantiate and run, streaming what the program wrote and what it exited
 * with.
 *
 * The accounting rules here are the ones the contract in `../types.ts` states,
 * and they are the reason this is a generator rather than a function returning
 * a result:
 *
 *   * one event per `fd_write`, in the order the program made them, with
 *     stdout and stderr kept apart, because a program that wrote to both said
 *     something about which was which
 *   * a trap yields `stderr` and NO `exit`, because a trapped program did not
 *     exit and has no status; inventing a code would be a fabrication
 *   * `exit` carries the real status and real wall clock, measured across the
 *     call rather than around the whole run
 */
export async function* executeWasm(
  opts: ExecuteOptions,
): AsyncGenerator<RunEvent> {
  const { bytes, name, argv0, isCancelled } = opts;

  if (isCancelled()) return;

  let module_ = opts.compiled;
  if (module_ === undefined) {
    try {
      module_ = await WebAssembly.compile(bytes.slice().buffer);
    } catch (error) {
      yield {
        kind: "unsupported",
        capability: "run",
        reason:
          `${name} is not a wasm module this browser will accept: ` +
          `${error instanceof Error ? error.message : String(error)}.`,
      };
      return;
    }
    opts.onCompiled?.(module_);
  }

  if (isCancelled()) return;

  /* The bytes about to execute, named and handed over. The page holds the
   * artifact itself, so its size is checkable in this tab rather than taken on
   * trust from whoever supplied it. */
  yield { kind: "artifact", name, bytes: bytes.length, data: bytes };

  const host = new WasiHost({ args: [argv0] });
  let instance: WebAssembly.Instance;
  try {
    instance = await WebAssembly.instantiate(module_, host.imports());
  } catch (error) {
    yield {
      kind: "unsupported",
      capability: "run",
      reason:
        `${name} would not instantiate against a WASI preview1 host in this ` +
        `page: ${error instanceof Error ? error.message : String(error)}. A ` +
        `module built with threads or atomics cannot instantiate here, ` +
        `because this document is not cross-origin isolated and a shared ` +
        `memory cannot be created.`,
    };
    return;
  }
  host.bind(instance);

  const start = instance.exports._start;
  if (typeof start !== "function") {
    yield {
      kind: "unsupported",
      capability: "run",
      reason:
        `${name} exports no _start, so it is a reactor rather than a command ` +
        `module and there is no entry point to call.`,
    };
    return;
  }

  let code: number | null = null;
  let trap: string | null = null;
  const began = performance.now();
  try {
    (start as () => void)();
    /* `_start` returned without calling `proc_exit`. wasi-libc's stub does
     * call it, so this path means the module was linked differently; a command
     * module that returns normally has exited 0 by definition. */
    code = 0;
  } catch (error) {
    if (error instanceof WasiExit) {
      code = error.code;
    } else {
      trap =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
  }
  const elapsed = performance.now() - began;

  for (const write of decodeWrites(host.writes)) {
    if (isCancelled()) return;
    if (write.text.length === 0) continue;
    yield write.fd === 2
      ? { kind: "stderr", text: write.text }
      : { kind: "stdout", text: write.text };
    await nextFrame();
  }

  if (isCancelled()) return;

  if (trap !== null) {
    yield {
      kind: "stderr",
      text:
        `the module trapped and did not exit, so it has no status to report: ` +
        `${trap}\n`,
    };
    return;
  }

  yield { kind: "exit", code: code ?? 0, ms: Math.round(elapsed * 100) / 100 };
}
