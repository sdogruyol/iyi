# iyi website: front end architecture

A static site for GitHub Pages. This document is the architecture: what is
generated, what is authored, how a number reaches a page, and how the playground
is a slot rather than a guess.

## Stack choice

**Astro**, and the argument for it is short. The site is mostly content with
islands of interactivity, which is exactly Astro's model: zero JavaScript by
default, with components that hydrate only where they must. The duration chart
and the playground are the only two things that ship any client code, and Astro
keeps them isolated. Content collections give typed schemas for the lessons.
MDX lets a lesson embed a real component next to prose. And the build output is
plain files, which is all GitHub Pages can serve anyway.

Alternatives considered and rejected, in writing, because the brief asks for it.

- **Next.js or any framework with a server.** Prohibited by the deployment.
  GitHub Pages serves static files with no compute at request time and no
  control over response headers, so a server framework buys nothing and costs a
  platform.
- **Starlight** (Astro's docs theme). It would impose a recognisable look that
  fights the art direction, and the site's content model is not a generic docs
  site. The docs section is generated from the repository's own SPEC.md, which
  no theme assumes.
- **Eleventy or Hugo.** Both are fine static generators, but neither gives typed
  content collections or a component model that can share the measurement
  components between pages and lessons without a build step of its own. Astro
  is the same language as the components.
- **Hand-rolled static HTML.** The generated pipeline would have to be rebuilt
  by hand, and the component reuse that keeps the two number classes consistent
  would disappear.

## Directory layout

```
site/
  astro.config.mjs          base /iyi, static output, trailing slash
  package.json              build chain: facts, reference, samples, then astro
  scripts/
    facts.mjs               runs bench/site_facts.py, writes generated/facts.json
    reference.mjs           splits SPEC.md and CHANGELOG.md into sections
    samples.mjs             copies samples/iyi/*.iyi into generated/samples/
    no-transcription.mjs    build gate: forbids hand-typed recorded numbers
  src/
    styles/                 tokens.css, base.css, code.css
    components/             Measure, Stamped, DurationChart, Sample, Quote, Record
    layouts/Page.astro      masthead, colophon, fonts, styles
    pages/                  index, playground, learn, spec, changelog
    playground/             the slot: types, registry, engines
    generated/              build output, gitignored, never edited
```

## The numbers pipeline

This is the load-bearing part, and it is the reason the site cannot drift.

**No number is ever typed into a page.** Every figure arrives from the
repository through `bench/site_facts.py`, which has two sources. Structural
numbers come from `bench/doc_numbers.py`'s `measured()`, the same function that
already gates `README.md` in CI, so the page and the gate cannot disagree.
Recorded numbers (seconds, bytes, milliseconds) are parsed out of `README.md`,
because that is where this project publishes them, and they are emitted only as
groups carrying the machine that produced them, the command that prints them,
and every session the README publishes. If any pattern stops matching, the
script fails rather than defaulting, which is the same rule
`bench/doc_numbers.py` applies to itself.

The build chain runs `bench/site_facts.py` and writes
`site/src/generated/facts.json`. The components read that file. `Measure`
renders a structural number and throws if the key is absent. `Stamped` renders
a recorded group and throws if it lacks a machine or a command. So a missing
figure fails the build instead of rendering blank, and a hand-typed figure has
no component to live in.

A second gate, `site/scripts/no-transcription.mjs`, scans the authored
directories (pages, content, components) for a recorded value written next to a
time or size unit, and fails the build naming the file. This is belt and
braces: the components already make transcription unnecessary, and this makes
it impossible to do it quietly. It is deliberately narrow, matching a decimal
followed by `s`, `ms`, `KB` or `seconds`, so it does not flag CSS values or
line numbers.

The two classes of number are rendered differently by design; see
`doc/website/ART-DIRECTION.md`. The pipeline is what enforces it.

## What is generated versus authored

- **Generated, verbatim, never edited:** the SPEC sections and the CHANGELOG,
  split from the repository's own files by `site/scripts/reference.mjs`, each
  carrying a generated-from banner with the commit. PROPOSED sections are
  badged in the signal colour because they are exactly the parts that will
  move.
- **Generated, transcluded:** sample code in lessons, copied from
  `samples/iyi/` by `site/scripts/samples.mjs`, so a sample that changes in the
  repository changes on the site. Renaming a sample a lesson names fails the
  build.
- **Generated, measured:** all numbers, via the pipeline above.
- **Authored fresh:** the marketing pages and the lessons. SPEC.md is a design
  record, not teaching material, so the learning path is written by hand but is
  grounded in real samples and real README passages, and every factual claim in
  it cites the file it came from.

## The playground as a slot

The playground is an interface, not an implementation. `site/src/playground/`
defines `PlaygroundEngine` with `ready()`, `capabilities()`, `run()`,
`cancel()` and `dispose()`, and a `Capability` union covering compile, run,
emit-iyimod, mod-dump, format and diagnostics. `capabilities()` drives the UI,
so an engine that cannot compile renders an honestly reduced interface rather
than a broken full one. A registry holds the active engine, and until a real
one is wired in the active engine is `unavailableEngine`, a null object that
reports no capabilities and yields a single `unsupported` event. It never emits
fake output and never emits an exit code, so it cannot pretend to have run
code.

The one hard constraint is documented in `types.ts` and repeated here because
it bounds what any engine can do. GitHub Pages cannot set the
`Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` response
headers, so the page is not cross-origin isolated, so `SharedArrayBuffer` is
unavailable. A wasm engine therefore cannot use threads and cannot do
synchronous standard input via `Atomics.wait`. Any engine implementation must
satisfy that.

## Deployment

GitHub Pages from the `docs/website` branch's `site/dist`, or from a Pages
action that builds and uploads. The base path is `/iyi` and is read from
`import.meta.env.BASE_URL` everywhere a link is built, so the same build can
move to a custom domain by changing two environment variables. The build is
pure static output; there is no server-side step.

## What this architecture refuses

- A number that is not in `facts.json`.
- A recorded number without a machine.
- A hand-edited copy of SPEC.md or CHANGELOG.md.
- A playground that fakes a run.
- Any client JavaScript beyond the chart and the playground.
