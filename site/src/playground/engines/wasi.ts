/**
 * The engine that runs iyi in the page, and the precise account of what that
 * sentence does and does not mean.
 *
 * WHAT IT DOES. Every curated sample in `site/records/wasm/manifest.json` was
 * compiled by the iyi compiler for `wasm32-wasi` and linked by wasi-sdk on the
 * machine the record names. Those modules ship with the site. This engine
 * fetches the one the visitor selected, checks its SHA-256 against the record,
 * instantiates it against the WASI preview1 host in `wasi-preview1.ts`, calls
 * `_start`, and reports what the program wrote, the status it really exited
 * with, and the wall clock the run took in this tab. That is a real execution
 * of real compiler output, not a recording played back. The execution itself,
 * once the bytes are here and shown to be the recorded ones, is `execute.ts`,
 * shared with the engine that will run a local wasm build of iyi's own
 * compiler and execute what it compiled in the tab: two engines that could
 * disagree about what running means would be a defect no visitor is in a
 * position to see.
 *
 * WHAT IT DOES NOT DO, and this is the part the interface exists to keep
 * honest: it does not compile. There is no iyi compiler in this page. So the
 * text in the editor is not the program that runs, and the moment those two
 * differ the engine says so before it runs anything, in a refusal naming the
 * `compile` capability it does not have. It never edits, ignores, or pretends
 * to have used what the visitor typed.
 *
 * WHY IT CANNOT CHECK WHAT YOU TYPE. Because it is not a compiler and never
 * calls one: it fetches a module somebody else compiled and runs it. That is
 * the whole reason, and it is a property of this engine rather than of the
 * target. The engine that will check what you type is the compiler itself
 * running as wasm in this page, which is what
 * `doc/website/PLAYGROUND-SERVICE.md` specifies and why the playground is
 * parked rather than shipped. Sending source to a backend was refused on
 * purpose: it would prove a machine somewhere has a compiler, which is not
 * the claim this site is making.
 *
 * An earlier version of this comment gave a different reason, that a compiler
 * built for `wasm32` could not report a diagnostic at all. That was true when
 * it was written and is not now: the exception wall is cleared, `rescue` works
 * on `wasm32`, and section 11 of `doc/website/PLAYGROUND-FEASIBILITY.md` has
 * the measurement. Left recorded rather than quietly deleted, because a
 * comment that was load bearing and stopped being true is worth one sentence
 * of history.
 *
 * WHY THAT COSTS NOTHING WHEN IT IS FIXED. Diagnostics leave this engine as
 * `diagnostic` events on the same stream as everything else, so the pane that
 * renders them is fed by the event path a checking engine would use. Wiring one
 * in replaces this file and touches nothing else, which is the property the
 * whole `playground/` directory is arranged to have.
 */
import type {
  Capabilities,
  PlaygroundEngine,
  RunEvent,
  RunOptions,
  SourceFile,
} from "../types";
import { curatedSamples, findSample, wasmProvenance } from "../samples";
import { recordedDiagnostics } from "../diagnostics";
import { executeWasm, sha256Hex } from "./execute";

/**
 * The editor's budget.
 *
 * Nonzero because the pane is editable: a visitor should be able to read the
 * program, move around in it, and see for themselves that changing it changes
 * what the page says about the run. 64 KiB because a tab has a memory ceiling
 * and the largest curated sample is a fraction of it, so this is a real limit
 * that no honest use reaches rather than a number chosen to look generous.
 */
const MAX_SOURCE_BYTES = 64 * 1024;

/**
 * The caveats, verbatim in the rail beside the playground. Each one is a thing
 * a sceptic would otherwise have to discover by testing.
 */
const NOTES: string[] = [
  "this engine runs precompiled modules and does not compile: there is no iyi compiler in this page, so the text in the editor is never the program that runs",
  `each module was compiled and linked on ${wasmProvenance.machine} by ${wasmProvenance.compiler} at commit ${wasmProvenance.commit.slice(0, 12)}, and its sha256 is checked against site/records/wasm/manifest.json before it is instantiated`,
  "diagnostics here are recorded, not live: this engine runs modules the compiler already produced and never compiles anything, so the only compiler output it can show is output that was captured when they were produced (doc/website/PLAYGROUND-SERVICE.md)",
  "stdout arrives in the exact chunks fd_write produced, in that order, but after _start returns: suspending a wasm call needs Atomics.wait on a SharedArrayBuffer, and GitHub Pages cannot send the headers that would make this document cross-origin isolated",
  "there is no stdin: reads from fd 0 succeed and report end of file, which is what a program sees when it is run with its input redirected from nothing",
  "there is no filesystem: no directory is preopened, so every path call fails the way it would under a real host with no capabilities granted",
  "the wall clock of a run is a property of your browser on your machine, coarsened by the same isolation rule, and is never a benchmark: the project's measurements live in bench/",
];

const CAPABILITIES: Capabilities = {
  /**
   * Two, and the two it can actually back.
   *
   * `run` because it really executes a module and reports the real status.
   * `diagnostics` because when it reports a compiler error it reports a file, a
   * line, a column and the rule that was enforced, which is what the capability
   * names. It claims neither `compile` nor `emit-iyimod` nor `mod-dump` nor
   * `format`, because it has no compiler, and the shell therefore renders those
   * four controls disabled with the missing capability named under each. That
   * reduced interface is the correct one.
   */
  supported: ["run", "diagnostics"],
  maxSourceBytes: MAX_SOURCE_BYTES,
  notes: NOTES,
};

/**
 * Where the modules are served from.
 *
 * `site/scripts/records.mjs` copies them out of the record into `public/wasm/`
 * at build time, so they are static assets under the site's base path. The base
 * is read rather than written because it is `/iyi` on Pages and `/` on a custom
 * domain.
 */
function moduleUrl(wasm: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/*$/, "/");
  return `${base}wasm/${wasm}`;
}

/* `sha256Hex` is imported rather than written here. It is the same hash on the
 * same bytes for both engines, and the note about copying before handing the
 * buffer to `crypto.subtle` lives with it in `execute.ts`. */

/** Modules already fetched and verified in this tab, by sample id. */
const loaded: Record<string, WebAssembly.Module> = {};
/** The verified bytes, kept so the run can report the artifact it executed. */
const loadedBytes: Record<string, Uint8Array> = {};

let cancelled = false;

export const wasiEngine: PlaygroundEngine = {
  id: "wasi-preview1",
  label: "precompiled wasm32-wasi, run in this page",

  /**
   * Nothing to preload: which module is needed depends on which sample is
   * selected, and fetching all of them to answer a question nobody asked would
   * spend the visitor's bandwidth on the site's convenience.
   *
   * So this checks the two things whose absence would make every later step
   * fail for a reason the page could not explain, and rejects on either,
   * because both are the engine being genuinely broken rather than honestly
   * limited.
   */
  async ready(): Promise<void> {
    if (typeof WebAssembly?.instantiate !== "function") {
      throw new Error(
        "this browser has no WebAssembly, so a wasm32-wasi module cannot be " +
          "instantiated here at all",
      );
    }
    if (typeof crypto?.subtle?.digest !== "function") {
      throw new Error(
        "this page has no SubtleCrypto, so the module's sha256 cannot be " +
          "checked against the record. The engine will not run bytes it " +
          "cannot verify are the recorded bytes.",
      );
    }
  },

  capabilities(): Capabilities {
    return CAPABILITIES;
  },

  /**
   * `_files` is unread, and the underscore is the point: this engine never
   * looks at the visitor's source, so it cannot accidentally report anything
   * about it. What runs is decided entirely by `opts.entry`, which names a
   * curated sample, and by the recorded module for that sample. An engine that
   * could compile would read this parameter; this one says in the console, on
   * every run, that it did not.
   */
  async *run(
    _files: SourceFile[],
    opts: RunOptions,
  ): AsyncIterable<RunEvent> {
    cancelled = false;
    const want = opts.want ?? "run";

    /* Diagnostics --------------------------------------------------------- */

    if (want === "diagnostics") {
      /* Recorded real compiler output, streamed as structured events on the
       * same path a checking engine would use. The events carry a file, a
       * line, a column and the rule, which is exactly what the capability
       * claims, and the pane states in a sentence that they are recorded. */
      for (const diagnostic of recordedDiagnostics()) {
        if (cancelled) return;
        yield diagnostic;
      }
      return;
    }

    if (want !== "run") {
      yield {
        kind: "unsupported",
        capability: want,
        reason:
          `There is no iyi compiler in this page, so nothing here can ` +
          `${want === "format" ? "format" : "produce that"}. This engine runs ` +
          `modules the compiler already produced, on the machine named in the ` +
          `stamp beside each sample. Every curated sample is a real ` +
          `wasm32-wasi build of a real file in samples/iyi/, and the run ` +
          `below is a real execution of it, but the pipeline that made it ran ` +
          `elsewhere.`,
      };
      return;
    }

    /* Run ----------------------------------------------------------------- */

    const sample = findSample(opts.entry);
    if (sample === null) {
      yield {
        kind: "unsupported",
        capability: "run",
        reason:
          `"${opts.entry}" is not in the recording, so there is no module to ` +
          `run for it. The recording covers ` +
          `${curatedSamples.map((entry) => entry.path).join(", ")}. This ` +
          `engine cannot compile, so a program it has no module for is a ` +
          `program it cannot run.`,
      };
      return;
    }

    /* WHAT THIS ENGINE CANNOT DO, said before every run rather than only when
     * the pane has been edited.
     *
     * It would have been possible to compare the submitted text against the
     * recorded source and speak up only when they differ. Two reasons not to.
     *
     * The first is that the statement is true either way: nothing in this page
     * compiled anything, and a console that only mentions it sometimes invites
     * the reading that on the other runs something did. This site publishes
     * where it loses; it does not publish it conditionally.
     *
     * The second is a cost. The recorded source lives in the highlight record,
     * a quarter of a megabyte of listings, and an engine that imports it ships
     * all of it to every visitor, an order of magnitude more JavaScript than
     * the page's other island. Paying that to make a true
     * sentence conditional is the wrong trade twice over.
     *
     * The page still answers the conditional question, and answers it before
     * the visitor clicks: the shell holds the recorded text already, so it
     * renames the run control, rewrites the line under it, and withdraws the
     * recorded colouring the moment the pane diverges. That is where the
     * question belongs, because it is a question about the page rather than
     * about the engine. */
    yield {
      kind: "unsupported",
      capability: "compile",
      reason:
        `Nothing in this page compiled anything: there is no iyi compiler in ` +
        `a browser. The run below executes the RECORDED module ${sample.wasm}, ` +
        `${sample.bytes} bytes, sha256 ${sample.sha256.slice(0, 16)}, built ` +
        `from ${sample.path} by ${wasmProvenance.compiler} at commit ` +
        `${wasmProvenance.commit.slice(0, 12)}. If the pane no longer holds ` +
        `that file, your edit is not in this run.`,
    };

    /* Fetch and verify. A module is fetched and checked once per tab and then
     * kept, because a visitor pressing run twice should not pay the network
     * twice, and because the second run is then measuring the program rather
     * than the download. */
    const cached = loaded[sample.id];
    let bytes = loadedBytes[sample.id];

    if (cached === undefined) {
      const url = moduleUrl(sample.wasm);
      let response: Response;
      try {
        response = await fetch(url);
      } catch (error) {
        yield {
          kind: "unsupported",
          capability: "run",
          reason:
            `${url} could not be fetched, so there are no bytes to run: ` +
            `${error instanceof Error ? error.message : String(error)}. The ` +
            `modules are copied into public/wasm/ by site/scripts/records.mjs ` +
            `at build time.`,
        };
        return;
      }
      if (!response.ok) {
        yield {
          kind: "unsupported",
          capability: "run",
          reason:
            `${url} answered ${response.status} ${response.statusText}, so ` +
            `there are no bytes to run. The modules are copied into ` +
            `public/wasm/ by site/scripts/records.mjs at build time.`,
        };
        return;
      }

      bytes = new Uint8Array(await response.arrayBuffer());
      const digest = await sha256Hex(bytes);
      if (digest !== sample.sha256) {
        /* Refuse. Running bytes that are not the recorded bytes would make
         * every statement the page then makes about provenance false, and it
         * would do it silently, which is worse than not running. */
        yield {
          kind: "unsupported",
          capability: "run",
          reason:
            `${url} served ${bytes.length} bytes whose sha256 is ` +
            `${digest.slice(0, 16)}, and the record says ${sample.bytes} ` +
            `bytes at ${sample.sha256.slice(0, 16)}. This engine will not run ` +
            `a module it cannot show is the recorded one, because everything ` +
            `the page says about where that module came from would then be ` +
            `unfounded. Regenerate with ${wasmProvenance.command}.`,
        };
        return;
      }

      loadedBytes[sample.id] = bytes;
    }

    /* Instantiate and run, which from here on is `execute.ts`. The
     * instantiation, the argv, the trap handling, the write ordering and the
     * exit accounting are identical for a recorded module and for one the
     * in-browser compiler will produce in the tab, so they are written once
     * there: a visitor cannot tell which engine produced a run, and the two
     * must not be able to disagree about what running means. The reasoning
     * about traps having no status, and about output arriving after `_start`
     * returns, is stated with the code that implements it.
     *
     * `argv[0]` is the sample's own repository relative path, which is both
     * what the program is and, in iyi, the module's own name.
     *
     * `compiled` and `onCompiled` are this tab's cache. A visitor pressing run
     * twice should not pay to compile twice, and the second run then measures
     * execution rather than compilation. The compiled module is only cached
     * once `execute.ts` has it, so a module that will not compile is refetched
     * and reverified next time rather than remembered as unusable. */
    yield* executeWasm({
      bytes,
      name: sample.wasm,
      argv0: sample.path,
      isCancelled: () => cancelled,
      compiled: cached,
      onCompiled: (module_) => {
        loaded[sample.id] = module_;
      },
    });
  },

  /**
   * A wasm call cannot be interrupted from the outside in a page that is not
   * cross-origin isolated: there is no second thread to signal from. So this
   * stops the stream at the next event boundary, which is honest about what it
   * can do, and it deliberately does not emit an `exit`, because a run
   * abandoned between events has no status the engine knows.
   */
  cancel(): void {
    cancelled = true;
  },

  /**
   * Drop the compiled modules. `ready()` is cheap, so the next run refetches,
   * reverifies and recompiles, which is the correct behaviour: after a dispose
   * nothing in this tab has been shown to be the recorded bytes.
   */
  dispose(): void {
    for (const key of Object.keys(loaded)) delete loaded[key];
    for (const key of Object.keys(loadedBytes)) delete loadedBytes[key];
    cancelled = false;
  },
};
