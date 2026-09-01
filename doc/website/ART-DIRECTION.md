# iyi website: art direction

These are decisions, not options. Where a decision could reasonably have gone
the other way, the reason it did not is written down. Rendered proof is in
`doc/website/screenshots/`, produced from the running site rather than drawn.

## The concept

**The site is a calibration record, not a brochure.** iyi's defining quality is
not that it is fast, it is that it is *checkable*: `README.md` publishes a
section called "Where it loses", prints the table where it is 3.62x slower,
names the machine behind every second, and names the command that prints every
number. So the site's job is to make evidence and candour read as confidence
rather than as hedging, and the way it does that is by borrowing the visual
language of measurement: paper, hairlines, instrument ticks, a ruler edge, a
specimen stamp naming the machine. Every claim on the page is either counted
from the tree or stamped with the box it was measured on, and the two look
different on purpose. This comes from iyi specifically because iyi already does
it: `doc/assets/edit-loop.anim.svg` is an animated bar chart whose bars run in
real time and which was **drawn by the run that measured it**, and
`bench/doc_numbers.py` already fails CI when a number in the prose drifts from
the tree. The site is those two existing ideas extended to a whole publication,
rather than a look applied on top of them.

Two consequences fall straight out of the concept and they govern everything
below.

**The signal colour marks where iyi loses.** Wins are set in plain ink. This is
the single most important decision in the document, and it is the inversion that
makes the whole thing work: a reader's eye is pulled to the caveat, which is
exactly what the README's prose does. Any site can colour its wins. Colouring
the losses is a claim about character that a competitor cannot copy without
also publishing their losses.

**A measurement cannot be rendered without its machine.** The two are one
component fed from one record, and the build fails if the record has no machine.
See "Measurements and charts".

## Palette

Committed values. Contrast ratios are computed, not estimated, and every one is
recorded in `site/src/styles/tokens.css` beside the value it describes.

### Light

| Token | Value | Contrast on paper | Where it is used |
|---|---|---|---|
| `--paper` | `#f2f3f0` | ground | Page ground. |
| `--raise` | `#fbfbf9` | 1.09:1 | Source blocks, console blocks, measurement cards. |
| `--ink` | `#171a17` | 15.76:1 | Body text, headings, chart bars for a win, structural numbers. |
| `--graphite` | `#5c6159` | 5.70:1 | The evidence rail, captions, console output, secondary prose. |
| `--mute` | `#787d74` | 3.78:1 | Instrument labels, axis ticks, elision marks. Large or non-essential text only. |
| `--hairline` | `#c9ccc4` | 1.46:1 | Every rule and border. Decorative, never text. |
| `--track` | `#e2e4dd` | 1.15:1 | The unfilled part of a chart track. |
| `--signal` | `#a8232b` | 6.41:1 | **Losses and caveats only.** Diagnostics, the loss claim, PROPOSED badges, the tittle, focus rings, link underlines. |
| `--signal-deep` | `#8e1c24` | 8.05:1 | Signal text needing AAA. |

### Dark

`--paper` `#131512`, `--raise` `#1b1e1a`, `--ink` `#e9ebe5` (15.28:1),
`--graphite` `#9aa096` (6.86:1), `--mute` `#767c72` (4.28:1), `--hairline`
`#2f332c`, `--track` `#262a23`, `--signal` `#e4636a` (5.50:1), `--signal-deep`
`#f08a8f` (7.64:1). Dark is designed, not inverted: the signal lightens because
Turkey red at its light-mode value fails contrast on a dark ground.

### Why these values

The ground is a green-grey rag at `#f2f3f0`, not white. White is a screen
default and reads as the absence of a decision; this is drawing paper, which is
what a measurement gets recorded on. The ink is very slightly green-black so it
sits on that paper rather than on top of it.

The accent is **Turkey red**, the madder-root pigment traded through Anatolia,
whose historical selling point was that it was colourfast: it held under test.
*iyi* is Turkish for "good". A colour named for the place the word comes from,
whose virtue is surviving measurement, is the correct accent for this project,
and it is nowhere near the blue-to-purple that developer-tool sites default to.
It is deepened off flag red so it reads as pigment rather than as alarm.

There are no chart series colours. A comparator is drawn in `--track` and
hatched `--hairline`; the series under discussion is `--ink`, or `--signal` when
it loses. Giving Crystal and Go brand hues would imply they are teams competing,
when the README's own framing is that all three columns pay the same machine
together.

## Type

Two families and no third. **The serif is the author. The mono is the machine.**
Anything a command printed is set in mono, without exception, and that single
rule does the work a sans-serif would otherwise be hired for.

**Newsreader** (Production Type, OFL, variable, `opsz` and `wght` axes) for
prose and display. Chosen over the obvious alternatives for concrete reasons:
it is a genuine text serif with an optical-size axis, so the same family sets a
70px hero and a 17px paragraph without either looking like the other stretched;
its heavier cuts have enough spine to carry a declarative headline; and it reads
as publication rather than as startup. Inter is prohibited by the brief and
would have been wrong anyway, since a geometric sans is the house style of
exactly the category this project is arguing with. `opsz` is set explicitly per
role, 72 at the hero, 48 to 60 at section heads, standard in body.

**IBM Plex Mono** (OFL) for code, commands, output, labels, numbers and the
evidence rail. Chosen over JetBrains Mono and Fira Code because those carry a
visible programming-ligature signature that would date the site and, more
importantly, because Plex Mono is a genuine text-grade mono: it holds at 13px in
a dense table and at display size in a claim. Ligatures are explicitly disabled
(`font-variant-ligatures: none`), because a site about a language's syntax must
not silently redraw that syntax. It has a true italic, which the evidence rail
and comment tokens use.

Both families ship the `latin-ext` subset, which is a requirement rather than a
nicety: the project's name is Turkish, and `ı İ ş ğ ç ö ü` must render. Both are
vendored into the repository through `@fontsource`, never fetched from a CDN. A
site arguing that a program should link only what it uses does not get to pull
webfonts off a third party.

Numerals are tabular everywhere (`font-variant-numeric: tabular-nums`) so that
figures in a column compare by eye.

Scale, fluid, ratio 1.25 with a deliberate break at the hero:
`--step--2` 0.79rem through `--step-0` 1.0625rem body to `--step-5` up to
4.4rem.

## Grid and layout

One grid, named lines, declared once in `site/src/styles/base.css` as `.spread`:

```
[full-start] minmax(edge,1fr) [main-start] min(66ch,100%) [main-end] gutter
  [rail-start] minmax(0,21ch) [rail-end] minmax(edge,1fr) [full-end]
```

A child defaults to `main`. It opts into `rail`, `wide` (main plus rail) or
`full` by class. Below 62rem the rail collapses onto the main column and content
reflows under its claim rather than beside it.

**The rail is the argument, not decoration.** The README says every number has
the command that prints it named beside it. The rail is that sentence expressed
as a grid: provenance lives at a fixed position on the page, always visible,
never a tooltip and never behind a hover, because a fact whose source you have
to go looking for is being presented as trust rather than as evidence.

The measure is 66ch because the site is mostly argument and argument wants a
book measure. Hairlines separate; shadows do not exist here; border radius is 0
except on a console block, which is 6px because it is a picture of a terminal
and terminals have rounded corners.

## Code display

Code is the product, so this carries more decisions than anything else.

**Highlighting emphasises exactly the tokens that are iyi's and not Crystal's.**
`module`, `import`, `using`, `pub`, `trait`, `impl`, `forall`, `derive`, `type`
and `abstract` get `.tok-rule`, which is weight 700 in ink. Ordinary Crystal
keywords get weight 500. Comments are mute italic. Literals are graphite, which
makes them recede. There is no rainbow and there is no hue in the syntax at all.
The reasoning: the whole delta between the two languages is that keyword set, a
reader is here to see it, and spending colour on syntax that is not the argument
would be spending the reader's attention on the wrong thing. Weight-only also
survives printing and colour-blindness.

**The token stream is the compiler's, and the emphasis is the site's.** Colour,
or rather weight, is decided in two passes that are deliberately separate. The
first pass is `src/crystal/syntax_highlighter/html.cr`, the compiler's own
highlighter, run over every listing at record time, so what counts as a token
is answered by the lexer and never by a grammar this site maintains. The second
pass adds `.tok-rule` to a keyword span whose text is one of the rule words
above. Two of the ten do not get it, and the reason is worth recording rather
than quietly rounding off: `forall` and `derive` are contextual keywords in
iyi's parser, matched on an identifier's value rather than lexed as keywords,
so the highlighter emits them as bare text. Wrapping them would mean deciding
whether a bare occurrence is the keyword or an identifier, which is the second
grammar this rule exists to forbid. Eight of the ten carry the emphasis; the
other two read as ordinary text until the compiler's highlighter learns them.

**The declaration face.** R-1 says a consumer compiles against declarations and
never bodies, so the site reads code the way the compiler does: a module block
can show its declarations with the bodies elided behind a control, and the
elision is *marked* rather than hidden so a reader can see that something was
removed. This is not progressive disclosure for tidiness. It is the governing
rule of the language applied to the interface, and it is the reason
`iyi mod dump` output is a first-class thing the site can render.

**The filename is load-bearing.** In iyi a module's path is its file's path, so
a source block shows its path in a header rather than treating the filename as
chrome.

**Three distinct block types, because they are three distinct kinds of
evidence.** A `.source` block is code you could write: flat, hairline border, no
terminal chrome. A `.console` block is a recording of a real run: it gets the
terminal frame, the `$` prompt in mute, and its output is *never* syntax
highlighted, because nothing highlighted it in the terminal. A `.diagnostic`
block is a compiler error: it keeps the caret line exactly as the compiler
prints it, colours the caret with the signal, and pulls the rule citation
(`SPEC.md R-2b`) into a cited footer, because iyi's errors naming the rule they
enforce is a feature and the design should say so.

## Measurements and charts

**There are two classes of number and they must not look alike.** This is a
design requirement, not an implementation detail, because the two are different
kinds of claim.

A **structural** number is a line count, a target count, a sample count. It is
measured from the tree, exact, identical on every machine, and already gated in
CI. It is rendered flat, inline, mono, ink, with no frame, no ticks and no
stamp. That plainness is the signal: this number is the same on your machine as
on mine.

A **recorded** number is a second, a byte, a millisecond. It is a machine, not a
language. The README is scrupulous about this, names the exact box, and
publishes a tired session reading 0.22 / 1.81 / 0.27 where a good one read
0.13 / 1.17 / 0.16. So a recorded number is never rendered as a bare figure. It
appears only inside a measurement card that carries, in the same frame, the
machine that produced it and the command that prints it. The card's left edge is
a **ruler**: ticks every six pixels with a longer tick every fifth, so the eye
reads "this came off an instrument" before it reads any text. Structural numbers
have no edge, and that absence is the entire distinction, achieved without a
badge or a colour.

**The headline of a measurement card is the ratio, never the absolute.** A ratio
survives the machine; a second does not. The edit-loop card leads with "About 9x
less than Crystal, on the line you just changed", then states the band the claim
held across, "8.06x to 9.00x across 3 published sessions", and only then shows
the seconds. The absolute is demoted to the body, where it sits next to its own
spread.

**Charts draw duration at 1:1 real time.** A bar representing a 1.17 s build
takes 1.17 s to fill. This is inherited from
`doc/assets/edit-loop.anim.svg`, and it is the most distinctive thing about the
visual language, because it refuses to abstract the one quantity the project is
selling. Three rules go with it. The chart runs **once** when scrolled to, with
a "run again" control, rather than looping: the README's SVG loops only because
a static image has no other way to be seen, and an infinite loop turns a
measurement into decoration. Reduced motion shows the settled state
immediately rather than a faster animation, because a shortened animation would
be a false reading. And every bar carries a **hatched whisker** to that series'
slowest published session, so the spread is on the page rather than hidden
behind a best-of.

**Comparisons of size are drawn at true area, not true width.** 36 KB against
1,553 KB is a 43x difference; drawn as bar length it would flatter iyi, so it is
drawn as two squares whose areas are in that ratio, which makes the iyi square
nearly invisible. That is the honest picture. The comparator is hatched and
hollow so the ink in the figure is proportional to what iyi actually ships.

## Imagery

**The artifact is the imagery.** There is no photography, no illustration of
people, no 3D, no stock, no gradient, and no decorative abstraction. Every
non-code visual on the site is generated from something the repository can
produce, which is both an aesthetic and a guarantee that a picture cannot drift
from the thing it depicts. The system has four members.

1. **Duration figures**, drawn at 1:1 from the measurement record. The spine.
2. **Mass figures**, true-area squares for binary size and library size.
3. **Structure diagrams**, for the import DAG and the declarations-versus-bodies
   cut. Typographic: boxes set in mono, hairline edges, the "never read by the
   consumer" edge drawn as a dotted hairline exactly as the README's mermaid
   diagram describes it. No rounded gradient nodes.
4. **The tittle.** The only ornament permitted, and it is structural. In Turkish
   orthography the dot on the i is semantic, since `i` and dotless `ı` are
   different letters, so a project whose argument is that a small written mark
   carries the load gets a mark that is only the dots. It appears as the section
   rule's terminal dot, where it marks the grid, and as the favicon. It is never
   scattered as decoration.

Icons, where genuinely needed, come from Font Awesome. An emoji is never an
icon.

## The greats, and what iyi takes from each

The bar for this site is not "a better README". It is Gleam, Elixir, Go and
Ruby. Each was read rather than remembered, and what follows is what each one
actually does, what iyi takes, and what iyi refuses. The refusals matter more
than the borrowings: a site that took every good idea from four other language
sites would be a pastiche, and a pastiche of confident sites reads as a site
with nothing of its own to say.

### Gleam

**What it does.** One line above the fold, in plain language, doing the whole
job: "Gleam is a friendly language for building type-safe systems that scale".
Beside it a hello-world you can read in four seconds, and a single primary
action, "Try Gleam". Further down the page the register turns social:
"Friendly", "Lovely people", a wall of the humans and sponsors behind it, and
an invitation to keep in touch. Its tour is the sharpest thing any of the four
ships: `tour.gleam.run` loads `compiler.js`, which drives the Gleam compiler
built to wasm inside a web worker, exporting `compile_package`,
`read_compiled_javascript` and `reset_filesystem`, so a visitor's own code is
compiled and run on static hosting with no server at all.

**What iyi takes.** The one-line pitch, and the discipline of one primary
action next to it. The tour's structure: a sequence a person is walked through,
not a directory of pages.

**What iyi refuses.** The social wall as Gleam runs it, because iyi does not
have one and a manufactured one is a lie the reader can check in an afternoon.
The emoji in the section heading, per the icon rule. And the claim the tour
makes, because iyi cannot make it: see below.

### Go

**What it does.** Puts an editable playground on the home page, above the
fold, with a real hello-world running against the real toolchain. Its heading
is a promise about systems, not about syntax. Under "Get started with Go" it
offers **tiered** entry: guided learning journeys, courses, books, chosen by
what kind of reader you are rather than by what kind of document it is. Then
use cases, then companies.

**What iyi takes.** Both structural moves. Running code on the home page, and
an entry section that sorts by reader rather than by artifact. This is the
single biggest change to the home page: "Start here" is now three named paths,
each stating who it is for and what it costs the reader in attention.

**What iyi refuses.** The company logo wall. iyi has no users in production
and the honest version of that section is the contribution wall described
below. Also the breadth: Go's four use-case tiles work because Go is used in
four industries; iyi's equivalent would be aspiration set in a grid.

### Elixir

**What it does.** "Simple from zero to scale", then a "Why Elixir?" section
that argues in three named axes, maintenance, scalability, productivity, each
with prose rather than a slogan. Then production case studies, then "Shaped by
many", which credits the foundation and the stewards rather than a logo strip.

**What iyi takes.** The named-axis argument. The site already has a `why` page
and it already argues in axes; the reference confirms the shape rather than
changing it. And "Shaped by many" is the honest ancestor of iyi's contribution
section: credit what you stand on, by name.

**What iyi refuses.** Case studies. There are none, and a section headed
"iyi in production" would be the first false sentence on the site.

### Ruby

**What it does.** Warmth, and it is the only one of the four that leads with
it. "Why Ruby?" answers with Simple, Productivity, Community. Then, unusually,
it puts news and the full CVE list on the front page, and it keeps
"Contribution" in the top-level navigation beside Docs and Community. A
language site that shows you its open security advisories at the top level is
making a character claim, and it is the same claim iyi makes by publishing
"Where it loses".

**What iyi takes.** The warmth in the voice, which the hero already has, and
the decision to put the unflattering material where a visitor meets it rather
than behind a link. Ruby does it with CVEs; iyi does it with the loss cards and
with the specification's undecided sections.

**What iyi refuses.** Community as a headline. Ruby has thirty years of it.

### Where iyi already beats them

Every example on this site executes, and the errors are the compiler's. The
samples are cross-compiled to wasm32-wasi and run in the page under a WASI
shim, printing the same bytes as a native run, and the diagnostics beside the
lessons are the real compiler's output captured verbatim, caret line included.
Go's playground runs on Go's servers. Elixir's and Ruby's home pages do not run
anything. Gleam's tour does compile in the browser, which is the one place iyi
is beaten outright.

### Where iyi loses

No community and no package manager. Gleam ships its whole compiler as wasm and
compiles what you type in the page; iyi cannot yet, so its playground is parked
rather than shipped, because a browser has no linker and producing a program
from a module needs one. A compile service would have closed the gap and was
refused on purpose: compiling elsewhere proves the elsewhere has a compiler and
says nothing about the claim. The gap narrowed while this site was being built:
work on `wasm/compiler-in-browser` cleared the wasm exception wall, so a type
checker in the page is reachable in a way it was not, while executing a
visitor's program there still is not, because the only interpreter that needs no
LLVM runs iyi's macro language and refuses every sample program at its module
header. That branch carries the measurements and this document gains their
citations when it lands. The playground page says which half is which in one
line rather than letting a visitor find out by typing.

### The structural moves this study produced

Recorded so a later reader can tell a decision from a habit.

1. **A one-line pitch, then one primary action.** Gleam's discipline.
2. **Running code where the reader lands.** Go's move, taken literally: the
   hero's sample is a real recorded run, and the playground executes real
   modules.
3. **"Start here" is tiered by reader, not by artifact.** Go's guided journeys.
4. **A contribution wall, not a community wall.** What iyi has is a fork's
   history and a specification with sections still marked PROPOSED and an
   appendix of decisions explicitly awaiting a reader's call. Those counts are
   generated, the inherited history is credited to Crystal by name and never
   added to the fork's own, and the invitation is to decide something rather
   than to join something.

## Rendered proof

From the running site at `site/`, captured in a browser.

| File | What it shows |
|---|---|
| `screenshots/01-home-full.png` | The whole page. |
| `screenshots/02-hero.png` | Hero: display serif, the evidence rail carrying structural counts. |
| `screenshots/03-chart.png` | The measurement card: ratio headline, band, 1:1 chart with spread whiskers, machine and command stamped inside the frame. |
| `screenshots/04-losses.png` | The signal colour doing its only job. |
| `screenshots/05-mass.png` | True-area size comparison. |
| `screenshots/06-dark-full.png` | Dark, designed rather than inverted. |
| `screenshots/07-dark-losses.png` | Signal red lightened for contrast on dark. |
| `screenshots/08-two-classes.png` | Both number classes in one frame: flat inline structural, tick-edged machine-stamped recorded. |

The current set, captured from a clean build served by `astro preview`, every
page in both schemes by emulating `prefers-color-scheme`. The playground frames
are taken after a Run click that actually executed the module, not after a page
load.

| File | What it shows |
|---|---|
| `screenshots/20-home-{light,dark}.png` | The home page: one-line pitch, the tiered "Start here", the measurement card, the loss cards, and the contribution wall. |
| `screenshots/21-why-{light,dark}.png` | The argument in named axes, with the true-area mass figure. |
| `screenshots/22-playground-run-{light,dark}.png` | A real run: `hello.wasm` fetched, checksum matched against the manifest, instantiated in the page, printing the same bytes as the native run, exit 0. Below it the recorded diagnostics pane. |
| `screenshots/23-learn-written-types-{light,dark}.png` | One step of the path: the specification's own premise, the sample, the break-this-rule block with the real recorded diagnostic and its cited footer, and the onward nav. |
| `screenshots/24-spec-section-{light,dark}.png` | A generated SPEC section with its generated-from banner. |
| `screenshots/25-changelog-{light,dark}.png` | The changelog, generated verbatim, with its generated-from banner and byte counts. Captured at viewport height rather than full page, because the document is one generated record 48,640 pixels tall: a full-page capture ran to 27 MB per scheme and carried nothing the first screen does not. Pagination was considered and refused; `CHANGELOG.md` holds three releases and splitting it would produce three thin pages and break in-page anchors, which is the opposite of the split `SPEC.md` earns by having 55 sections. |
| `screenshots/26-learn-path-{light,dark}.png` | The path's entrance: five numbered steps, tick rows, one marked start. |
| `screenshots/27-deployed-playground-run.png` | The same run, on the deployed site rather than a local preview: `https://jwaldrip.github.io/iyi/playground/hello/` fetched `/iyi/wasm/hello.wasm` over the network, matched its digest against the manifest, executed it, and printed the sample's own output with exit 0. This is the frame that proves the base path, since a preview and Pages disagree about it and nothing else catches that. |

The playground, parked. Captured from a clean build served by `astro preview`,
driven in a real browser, both schemes by emulating `prefers-color-scheme`. The
specification for the interactive version is
`doc/website/PLAYGROUND-SERVICE.md`.

| File | What it shows |
|---|---|
| `screenshots/30-playground-parked-{light,dark}.png` | `/playground/`, parked. One line on what is coming, two sentences on the blocker with one link to the account, a typographic structure diagram of the planned three panes, and three ways to reach what does run. The diagram is drawn rather than mocked up: the page contains no `button`, no `textarea` and no `input` element at all, which is measured in the browser rather than asserted, because a greyed out control is a lie told by an affordance and this page has none to tell it with. |
| `screenshots/31-sample-run-{light,dark}.png` | A sample route doing the thing the parked page cannot: `hello.wasm` fetched, digest matched against the manifest, instantiated, printing the program's own output with exit 0, and the wall clock inside a stamped frame. |
| `screenshots/32-sample-edited-light.png` | The honest treatment of an edit, in three places at once. The recorded colouring is withdrawn because there is no lexer in the page to replace it, the run control renames itself to `run recorded`, and the line under the pane names the bytes that will actually execute. |
| `screenshots/33-evidence-{light,dark}.png` | `/playground/evidence/`, where the recordings, the digests and the recorded diagnostics moved to. Five build-time gates stand over this page and every one has been broken on purpose to prove it fails. |

## Prohibitions

Recorded because each is a way this specific site could fail.

- No blue-to-purple gradient, no glassmorphism, no floating orbs, no
  three-column round-icon feature strip, no Inter.
- No emoji used as an icon.
- No em-dash and no en-dash, in the site's copy or in this repository's website
  documents. The one exception is a verbatim record: compiler output, README
  quotations and sample source are reproduced exactly, dashes included, because
  editing a recording to satisfy a house style turns it into a paraphrase and
  the whole argument of this site is that its recordings are not paraphrases.
  The rule binds every character anyone here authors.
- No sans-serif family.
- No hue in syntax highlighting.
- No signal colour on a win.
- No chart that loops forever.
- No recorded number outside a measurement card.
- No hand-transcribed number anywhere. See `doc/website/STACK.md`.
- No time estimate in any copy, including anything implying how long learning
  or building takes.
