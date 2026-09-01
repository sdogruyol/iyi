# The playground: what it has to be, and why the obvious shortcut was refused

The playground shipped as an evidence page: curated listings, recorded
diagnostics, a card proving a module printed what the native binary printed.
That material is good and it stays, but it is not a playground. A playground is
an editor you can type anything into, a control that runs it, and output.

This document specifies the thing to build. It is written before the engine so
that whoever fills the slot builds the right shape rather than rediscovering it.

## What was tried, and why it is not here

A compile service was designed here, agreed with a second worker, and half
built: `POST /v1/compile` taking source and returning a `wasm32-wasi` module,
`GET /v1/health` carrying the compiler's version and a sentence about
containment, a `POST /v1/lex` for live colouring, an engine that verified the
returned module's digest before instantiating it, and a stub serving the whole
wire so the engine could be driven through eighteen branches. It worked.

It was thrown away on purpose. The owner's words:

> the playground can only be feasible if you can do this on wasm, which requires
> the updates to the language to make it possible. This means the compiler itself
> has to run on wasm. No handoff to a backend of any kind. That's the proof we
> need.

The reasoning is worth keeping because it is the same reasoning the rest of this
site runs on. Compiling on a server and calling the result a playground for a
language proves that the server has a compiler. It proves nothing about the
claim being made, which is that this language and this compiler can go where a
browser goes. A page that looked like a playground while quietly posting source
to a machine in a datacentre would have been the one dishonest page on a site
whose whole argument is that its claims are checkable, and it would have removed
the pressure to do the hard thing.

One finding from that work outlives it and is repeated below, because it is
about the language rather than about the service: compiling untrusted iyi is
code execution.

## Why the browser cannot do it yet, and it is not the errors

A browser has no iyi compiler and no linker, and that is the whole of it.
Running a program a visitor typed means producing a module and then producing a
program out of it, and the second step shells out to a linker driver
(`src/compiler/iyi/compiler.cr`, the `wasm32` branch, which names the driver
rather than `wasm-ld` because a wasi program is more than the module). There
are no subprocesses in a page, so the link cannot happen there. That reason is
independent of anything the compiler's exception handling does, and it is why
the playground is parked rather than shipped. It is emphatically NOT an argument
for a service: a backend was refused above and stays refused. It is the next
piece of language work, and the shape of the answer is either a linker that runs
as wasm or an interpreter that needs neither it nor LLVM.

**Two measurements arriving on another branch, named here rather than quoted.**
Work on `wasm/compiler-in-browser` has cleared the wasm exception wall, so
`rescue` works on `wasm32` and a front end in the page can report a diagnostic
rather than dying. The same work measured the only interpreter that needs no
LLVM and no linker, and found that it runs iyi's macro language rather than the
language: it refuses every program in `samples/iyi/`, each one on its module
header. Neither the falsifier nor its record is in this tree yet, so neither is
cited here as a path and neither number is repeated: this document states them
as the reason the split below did not move, and gains their citations when that
branch lands. `site/scripts/blocker.mjs` is the gate that will demand the
update, because it fails the build the moment the record says the wall is down
while the prose still says it stands.

What that changes is one half and not the other. Type checking in the page
becomes reachable; executing a visitor's program does not, because the linker
reason above is untouched by it. Those were one question and they are now two,
which is why this document rests on the linker rather than on the way errors
are reported.

## Compiling untrusted iyi is code execution, and that does not go away

This was measured in the tree rather than assumed, and it survives the change of
architecture, because it is a property of the language's macros rather than of
where they run.

`src/compiler/iyi/macros/methods.cr` dispatches these at **compile time**:

- `when "system", "`"`, reaching `interpret_system`, whose body is
  `` result = `#{cmd}` ``. A shell command, run by the compiler.
- `read_file` and `read_file?`. Any path the compiler can read.
- `env`. The compiler's own environment.
- `run`, reaching `interpret_run`, which calls `@program.macro_run` and so
  **compiles and executes another program**, substituting its standard output
  into the source being compiled.

For a service this meant a sandbox was mandatory. For a compiler running as wasm
in a tab it means something better and worth stating on the page: the browser
already is the sandbox, and it is one the visitor owns. A wasm module has no
subprocess, no ambient filesystem and no network except what the host grants it.
`system` and `run` cannot work there at all, `read_file` sees only what the host
preopens, and `env` sees only what the host passes. So the honest page says that
a macro reaching the host behaves differently here than in a local build, and
says it in the same voice as the rest of the site's "what is not here" material.

That is a real difference and it belongs on the page, not buried. The
feasibility report reached `interpret_system` from the other direction and names
it as blocker 4.

## The shape: trycrystal.org, in this site's art direction

The reference is `trycrystal.org`, structurally and almost exactly. What it
does, read rather than remembered: three panes side by side, a lesson pane on
the left, the editor in the middle, the output on the right; one primary
control, `Run`, whose keyboard hint is `Cmd or Ctrl + Enter`; both program
output and compiler diagnostics arriving in the output pane; and a sentence in
the output pane on load saying what happens to what you type.

**Take the structure and the interaction model. Do not take the look.** This
site has an art direction, `doc/website/ART-DIRECTION.md`, and it binds: paper
ground, two families and no third, weight-only syntax emphasis with no hue, the
signal colour reserved for losses and caveats, hairlines rather than shadows,
and no sans-serif anywhere. A playground that arrived in another site's visual
language would be the first page here that did not belong to the publication.

```
  masthead
  ------------------------------------------------------------------
  playground                       [ compiler: running in this tab ]
  Type iyi. It compiles here, in your browser. Nothing is sent anywhere.
  ------------------------------------------------------------------
  [ Run  (Cmd or Ctrl + Enter) ]  [ sample v ]  [ Share ]  [ Reset ]
  ------------------------------------------------------------------
  samples     | editor                        | output
  hello       | main.iyi                      | stdout and stderr as
  basics      |                               | they arrive
  calc        | (colouring from the           |
  collections |  compiler's own lexer,        | exit status and wall
  ...         |  running in this page)        | clock, in a stamped frame
              |                               |-------------------------
              |                               | diagnostics
              |                               | verbatim, caret exact,
              |                               | rule cited
  ------------------------------------------------------------------
  provenance rail: which compiler, which commit, that nothing leaves
  this machine, and a link to the evidence page
```

Rules that fall out of the reference and out of this site's own law:

- **The editor is dominant.** It is the subject of the page, not a panel on it.
  Everything else is sized against it.
- **Three panes above the breakpoint, stacked below it, editor first.** The
  existing breakpoint is 62rem. Stacking order is source order, so the thing the
  page is about is the thing a narrow screen shows first.
- **One primary control.** `Run`, bound to `Cmd or Ctrl + Enter`, with the chord
  printed on the control rather than hidden in a tooltip.
- **Diagnostics under the output, not beside it.** That is the order a person
  reads in: what happened, then why it did not.
- **The samples pane is real links.** A lesson deep links a sample and a real URL
  resolves before any script runs, so the links work with scripts off and survive
  being bookmarked. `/playground/<sample>/` must keep resolving.

## What already exists and must be reused

Not one of these should be rewritten.

| Thing | Where | What it gives you |
|---|---|---|
| The engine slot | `site/src/playground/types.ts`, `registry.ts` | One interface, one registration point, and a `capabilities()` call that shapes the whole UI. Read the HARD CONSTRAINT block at the top of `types.ts` first. |
| The WASI host | `site/src/playground/engines/wasi-preview1.ts` | preview1 in the page, proven on 13 recorded modules. |
| The execution path | `site/src/playground/engines/execute.ts` | Instantiate, argv, trap handling, output ordering, exit accounting. Shared so two engines cannot disagree about what running means. |
| The recorded engine | `site/src/playground/engines/wasi.ts` | What honestly works today: recorded modules, digest checked, really executed. |
| The token renderer | `site/src/lib/tokens.ts` | `inkLines(html, label, expected)` takes a token stream from the compiler's own highlighter and refuses to paint it unless it encodes the exact characters on screen. This is the receiving end for live colouring and it is already gated. |
| The share scheme | `site/src/playground/share.ts` | `#src=` in the fragment, base64url of a self-describing payload, deflate where the browser has it. Written and proven; not yet wired to a control, because there is no editor to share from. |
| The starter program | `site/src/playground/starter.ts` | Five lines carrying R-1 and R-2, run through the real compiler and exited 0. |
| The evidence page | `site/src/pages/playground/evidence.astro` | Where the recordings, the digests and the recorded diagnostics live, with five build-time gates over them. |

## The engine the slot is waiting for

- It is a **local wasm module**. No endpoint, no CORS, no request, nothing
  configured at build time, and nothing that can be down.
- `capabilities()` stays synchronous, pure and node safe, because the static
  build calls it. It grows `compile` when the compiler module can compile, and
  not one moment before.
- It claims what it can back. A front end that type-checks but cannot execute
  claims `compile` and `diagnostics` and not `run`, and the page renders a
  smaller playground rather than a broken one. That is the whole point of the
  slot and it is already proven: the four stage controls render disabled today,
  each naming the capability it is missing.
- Live colouring comes from the same module. Lex what is in the editor, hand the
  highlighter's HTML to `inkLines`, and paint only if it verifies. When the
  engine cannot lex, the page paints plain ink and says so, which is the state it
  is in today.
- **The digest discipline still applies to modules the page did not compile in
  this session.** A recorded module is checked against
  `site/records/wasm/manifest.json` before instantiation. A module the compiler
  in the page just produced needs no digest, because its provenance is that this
  tab made it, and the page should say which of the two it ran.

## What must never appear on this page

Recorded because each one is a way this specific page could fail, and two of
them were nearly built.

- **No control that does nothing.** `registry.ts` states it and it binds: a
  greyed out button beside a greyed out editor is that lie softened rather than
  avoided. While the playground is parked, `/playground/` carries a structure
  diagram of the planned panes, drawn typographically with no `button` and no
  `textarea` element in it, because a diagram is a plan and reads as one.
- **No fabricated output.** No spinner that never resolves, no synthesised exit
  status, no output attributed to a program that did not run.
- **No silent fallback.** Running a recorded module for text the visitor typed,
  without saying so, is the specific dishonesty the staleness treatment exists to
  prevent. Today the run control renames itself, the line under the pane names
  the bytes that will execute, and the recorded colouring is withdrawn. Keep all
  three.
- **No second grammar.** The token stream is the compiler's or there is none.
  A hand written scanner drifts from the compiler's silently and the drift shows
  up as a keyword the site does not think is a keyword.
- **No transcribed number.** `site/scripts/no-transcription.mjs` fails the build
  on one, and every recorded number belongs inside a stamped frame carrying the
  machine that produced it.

## What this does not change

`site/src/playground/types.ts`'s hard constraint block still binds. The page is
not cross-origin isolated, because GitHub Pages cannot set response headers, so
there is no `SharedArrayBuffer`, no wasm threads, and no synchronous standard
input through `Atomics.wait`. A single threaded build of the compiler is the only
build that can run here, and output arrives in the chunks the program wrote but
only once `_start` returns. Every gate already proven stays, and the new paths
are held to the same rule: no transcribed number, no fabricated output, no
control that does nothing.
