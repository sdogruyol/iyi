/**
 * The slot itself. One engine, registered explicitly, resolved in one place.
 *
 * There is no dynamic import, no glob of a directory, and no auto discovery.
 * The shell reads the active engine twice, once in node during the static
 * build to decide which controls to render, and once in the browser to run
 * them, and those two reads have to agree. A conditional or lazily resolved
 * engine would let the built HTML claim capabilities the running page does not
 * have, which is the precise failure this playground is designed not to have.
 * So registration is a plain module scope call, and it is the same on both
 * sides.
 *
 * ===========================================================================
 * TO WIRE A REAL ENGINE IN, do exactly this and nothing else:
 *
 *   1. Add `src/playground/engines/<name>.ts` exporting one object that
 *      implements `PlaygroundEngine` from `../types`. Read the HARD CONSTRAINT
 *      block at the top of `types.ts` first: the page is not cross-origin
 *      isolated, so `SharedArrayBuffer`, wasm threads and `Atomics.wait` are
 *      unavailable, and `capabilities()` must be synchronous, pure, and safe
 *      to call in node with no browser globals. Do not touch `window`,
 *      `document` or `WebAssembly` at import time; do that work in `ready()`.
 *
 *   2. In THIS file, below the marker, import it and call
 *      `registerEngine(yourEngine)`. That is the whole wiring step.
 *
 *   3. Report only what the engine actually does. `capabilities().supported`
 *      is a whitelist, and leaving a capability out is the supported answer:
 *      the shell renders that control disabled with a mono note naming the
 *      missing capability, and the page stays honest. Put every caveat in
 *      `capabilities().notes`, which is rendered verbatim in the rail beside
 *      the playground.
 *
 * Nothing else changes. `src/components/Playground.astro` reads
 * `activeEngine().capabilities()` and shapes itself, and its client script
 * streams `run()` events into the output pane, so a conforming engine lights
 * up the existing UI without a markup change.
 * ===========================================================================
 */
import type { PlaygroundEngine } from "./types";
import { unavailableEngine } from "./engines/unavailable";

let registered: PlaygroundEngine | null = null;

/**
 * Install the engine. Called below for whatever this site ships, and callable
 * by a test or a local harness that wants to drive the shell with its own
 * engine before the shell reads it.
 *
 * Registering a second, different engine throws rather than winning silently:
 * two engines in a one engine slot means somebody did not read this file, and
 * a last write wins would make which one you get depend on import order.
 */
export function registerEngine(engine: PlaygroundEngine): void {
  if (registered !== null && registered !== engine) {
    throw new Error(
      `playground: ${registered.id} is already registered, so ${engine.id} ` +
        `cannot be. There is one slot. Replace the registerEngine call in ` +
        `src/playground/registry.ts rather than adding a second one.`,
    );
  }
  registered = engine;
}

/**
 * The engine the page talks to.
 *
 * Falls back to `unavailableEngine`, which is a real implementation that
 * claims no capabilities and emits one refusal naming what is missing. The
 * fallback is never null and never a stub that pretends: the caller cannot
 * forget to handle the empty case, because the empty case is an engine that
 * answers truthfully.
 */
export function activeEngine(): PlaygroundEngine {
  return registered ?? unavailableEngine;
}

/* ===========================================================================
 * ENGINE REGISTRATION.
 *
 * The engine below runs precompiled wasm32-wasi modules of the curated samples
 * against a WASI preview1 host written in the page. It claims `run` and
 * `diagnostics` and nothing else, so the shell renders build, emit .iyimod,
 * mod dump and format disabled with the missing capability named under each,
 * which is the honest interface rather than a reduced one by accident.
 *
 * WHAT WENT IN THIS SLOT AND WAS TAKEN BACK OUT, recorded because the next
 * person to fill it should not have to rediscover the decision. A `remote`
 * engine was written here that posted source to a compile service and executed
 * the module it returned. It worked, but it answered the wrong question: the
 * point of a playground for this language is that iyi's own compiler runs in
 * the tab, and a service that compiles elsewhere proves nothing about that.
 * So the architecture was overruled in favour of the harder thing, and the
 * engine that fills this slot next is a local wasm build of the compiler with
 * no handoff to a backend of any kind. `doc/website/PLAYGROUND-SERVICE.md` now
 * holds the specification for what the page around it has to be.
 *
 * Until that lands, this slot holds exactly what honestly works, which is why
 * the playground itself is parked at `/playground/` and the routes that really
 * run a program are the sample routes underneath it.
 * ========================================================================= */

import { wasiEngine } from "./engines/wasi";
registerEngine(wasiEngine);
