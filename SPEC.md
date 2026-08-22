# iyi Language Specification: Draft 0

**iyi is a language built for Developer & Agentic Experience, Portability,
Performance, and Efficiency.** This document is the design under that sentence:
one rule — a module is compiled against its dependencies' declarations, never
their bodies — and what every other part of a language has to become for it to
hold. iyi is compatible with Crystal — the same compiler builds `.cr` files and
an iyi program can require a shard — and it is its own language, because the
rules below are ones Crystal does not have and cannot have. The compiler being
built on Crystal's is a fact about provenance rather than about the language.

**Status: draft for discussion. Parts of it are built. Each section says which,
and a heading that does not say so is a heading to distrust.** What 0.1.0 needs
of it is scoped below Part I.

This draft deliberately does *not* re-describe the six rules. Each has been
validated on its own: by the Kemal port, by the instantiation census, by the
runtime benchmark. What has never been checked is how they behave **against each
other**, and that is where language projects fail. So Part II, the interaction
matrix, is the substance of this document.

Decisions are marked:

- **SETTLED**: follows from measurement or from a rule already accepted.
- **PROPOSED**: my recommendation, with reasoning; yours to accept or reject.
- **OPEN**: genuinely undecided, needs a call.

---

## Part I: Premises

The compilation model, stated only as far as Part II needs it.

| Rule | Premise |
|---|---|
| R-1 | A module is the unit of compilation. `import` forms a DAG. Compiling a module reads only its dependencies' **export metadata**, never their bodies. |
| R-2 | Everything a module exports (`pub`) carries full parameter and return types. Non-exported code infers. |
| R-2b | `using` brings a module's exported names into unqualified scope, written by the consumer. |
| R-3 | Open classes are gone. `impl Trait for Type` must live in the module defining the trait or the type. |
| R-4 | Generic calls crossing a module boundary pass a dictionary keyed on GC shape. Within a module, monomorphisation. `@[Monomorphize]` forces specialisation across a boundary. |
| R-5 | Macros are derive-scoped: they see the declaration they are attached to, and nothing global. |

Union types, nil-safety flow typing, blocks, local inference and Ruby syntax are
kept unchanged from Crystal. They cost the compiler nothing.

---

## 0.1.0: what the first release has to prove

### What it shipped, in numbers that are current

**Everything else in this document is a record of how these were arrived at,
including tables that were true at the time and are not any more.** When a
figure here disagrees with one further down, this one is the release's.
Measured 2026-08-17 on one Linux box, release compiler, in a state the benches'
own reference accepts.

| | |
|---|---|
| edit one module, rebuild (30 modules, 7,208 lines) | **iyi 0.13 s**, Crystal 1.17 s, `go build` 0.16 s |
| the same edit with no artifacts | 0.23 s, which is what R-1 is worth here |
| warm full build, `hello` / 6,900-line pair | 0.07 s / 0.24 s, against `go build`'s 0.08 s / 0.09 s |
| front end, `hello.iyi` | **0.036 s** against the 0.050 s target: MET |
| starting the compiler and doing nothing | 0.018 s of that |
| prelude | 1,184 lines, ceiling 3,551 |
| compiler | 84,068 lines, none of it written in iyi |
| artifact format | `.iyimod` v19, checksum per section |
| samples | 9, of which 5 rebuild from artifacts with their modules' source deleted |
| what runs in CI | iyi's specs, Crystal's 13,798 compiler examples, the standard library's, the CLI's, the samples, eight cross-compile targets, the tarball |

`python3 bench/incremental.py` and `python3 bench/build_speed.py` print the
first four rows and refuse to time programs that do not agree on their output.

### Scope

Everything below this line is design. This section is scope, and it is here
because the rest of the document is easier to read once it is known which parts
of it the first release is allowed to need.

**0.1.0 is not a usable language.** It is the smallest artifact that lets
somebody who did not write it check the central claim and find it false. Nobody
will write production code with it, there will be no standard library worth the
name, and it will not be self-hosted. Go's first public release was the same
shape.

> **What changed after it shipped, and it changed this paragraph.** A prelude
> is a library and the rules are the language, so a program can keep one and
> change the other: `--crystal` builds against Crystal's standard library, and
> there `require` reaches the ecosystem while every rule stays where it was.
> "No standard library worth the name" is still true of iyi's own 1,184 lines
> and no longer true of what a program can have. Part V item 12a is the
> measurement, nine shards wide.

**The claim under test** is compile speed. The type system is the means, not the
product: open classes go so that a module can be compiled against its
dependencies' metadata instead of their bodies (R-1, R-3), and that is what
makes a build incremental. A release that ships the type system without the
speed has shipped the cost and none of the benefit.

### In scope

**1. `.iyimod`, end to end (IV.1). Built.** Not negotiable. R-1 is the rule the
rest of the document is built on, and without the artifact everything here is a
design document. The container, the `Header`, `Imports` and `Exports` sections,
`--emit-iyimod` and `mod dump` are built, and `--use-iyimod` compiles an
imported module from its artifact: all eight samples compile with the imported
module's source **deleted**.

`ObjectCode` carries a module's own machine code, and **a program built from a
module's artifact with the module's source deleted runs**. The thing here that
produces a program rather than a typecheck.

Of the five samples that import anything, **all five** do: `modules`,
`immutable` (a generic type, a 575-line trait with an associated type, a generic
impl), `collections` (the trait implemented by a type the artifact's module has
never heard of), `init_order` (III.5's ordering, line for line) and `webapp`,
the Kemal port, which took the whole of IV.1g to reach. Each builds, links,
runs, and prints what the build from source prints. IV.1g measures all of it,
and records what was in the way.

**2. The passes that still walk the prelude stop walking it (IV.1d). Measured
away, and what was actually in the way is fixed.** The claim this item was
written on was measured against Crystal's 107,719-line prelude: 0.47 s left
after the artifact, of which class-var initializers and `main` were 90%. Item 3
replaced that prelude with 1,053 lines of iyi, and the number this item exists
to remove does not exist any more. What the item became is the link, and the
link is now 0.026 s of a 0.09 s warm build of `hello.iyi`, against `go build`'s
0.12 s on the same machine. **That is a win at the size of `hello` and the
bench's second pair says so**: at 6,900 lines the same comparison is 0.23 s
against 0.09 s, because what was removed here was fixed cost. From
`bench/build_speed.py` on a release compiler, `hello.iyi`, seconds. The middle
column is where this morning started:

| | before | after |
|---|---|---|
| warm build | 0.26 | **0.09** |
| of what the compiler times in it, the **link** | 0.132 (85%) | **0.026 (45%)** |
| front end alone (`--no-codegen`) | 0.041 | 0.047, of which 0.023 is startup |
| the same front end, no LLVM linked into the binary | 0.02 | 0.03 |
| `go build`, warm | 0.10 | 0.12 |

Two things were in the way and neither was analysis: a search for a linker
nobody installed, and a driver working out the same link command on every
build. Both are below.

Inside that front end the top-level pass is 0.012 s and **the five passes this
item asked to fix cost 0.4 ms between them**: 2% of what is left, where the
item says 90%. That is the compiler's own `--stats`, per pass, on a warm build
of a program that is one `puts`, which is the measurement the item is about: it
asked those passes to stop walking *the prelude*. They cost more on a program
with something in it: `main` is 4.6 ms on `hello.iyi`, and that difference is
the user's own code being typed, which no cache of anything removes.

**What replaced it is the link, and a third of what looked like the link was
not the link.** Nearly everything a warm build spends is inside the linking
stage, on a program whose object files were every one of them reused and whose
own code is three lines. The first reading of that was wrong, and the way it was
wrong is worth the space: the stage measured 0.29 s by default and 0.18 s with
`--link-flags=-fuse-ld=gold`, which says the default linker is the slow one.
Running the compiler's own link command by hand takes **0.13 s with either
linker**. The flag was not choosing a faster linker. It was skipping a search.

Before linking, `use_modern_linker` looks for `mold`, then for `ld.lld`, and
prefers whichever it finds, and it returns without looking if the flags already
name a linker, which is what `-fuse-ld=gold` did. `Process.find_executable`
walks `PATH`, and a name that is *not* on `PATH` costs a stat in every entry of
it. That is a millisecond on an ordinary Linux box. Under WSL, where `PATH`
carries nineteen Windows directories on a filesystem that answers a stat in
about 6 ms, it is **0.062 s per search, twice per build**. A third of every
build was the compiler looking for two linkers that were not installed, and the
flag that appeared to fix it only skipped the looking.

**Fixed, and the fix is a cache rather than a policy.** The answer is written
next to the object cache and read back while the `PATH` it was found under is
unchanged; changing `PATH` asks again. The default build and the
`-fuse-ld=gold` build now measure the same, which is the result that says the
linker was never the difference. A warm build of `hello.iyi` went from 0.26 s to
**0.17 s** for twenty lines of caching, against Go's 0.10 s: the gap this
project exists to close is 1.7× where it was 2.9× this morning, and none of it
came from compiling anything faster.

What is left of the link is `ld` doing its job on eleven objects and libgc:
0.132 s, and still 85% of what the compiler times.

**And that part was not the linker at all.** Linking a one-object C program on
the same machine cost the same figure, so it was never about iyi's eleven
objects, but it was not about `ld` either. Measured on the same objects in the
same minute: `cc` takes **0.129 s**, and the command `cc` would run, with
`collect2` replaced by the linker itself, takes **0.014 s** with `ld.bfd`,
0.009 s with `ld.gold` and 0.023 s with `ld.lld`. Three linkers within 14 ms of
each other, and a driver worth 0.11 s on top of any of them.

`cc` does not link. It works out how to: the dynamic linker's path, `Scrt1.o`,
`crti.o`, `crtbeginS.o`, the `-L` directories, `-lgcc -lc`, and then it runs
`collect2`, which scans the objects for constructors before running `ld`. All of
that is the same for every build on a machine, and all of it was being redone
on every build.

**So the compiler asks once and links for itself.** `cc -###` prints the command
without running it, including for object files that do not exist, which is what
makes it a template: a placeholder marks where this build's objects go. The
template is cached against the flags it was computed for, the compiler runs `ld`
itself from then on, and a link that fails with it is retried through the driver
with the template marked unusable, so a machine this does not suit pays one
extra link once. `CRYSTAL_LINK_DRIVER=1` forces the old path. `clang` has done
this all along. It has no `collect2` and execs the linker itself, which is why
it measures 0.092 s where `cc` measures 0.129 s.

**What it is worth, on `hello.iyi`, warm:**

| | before | after |
|---|---|---|
| the linking stage | 0.143 | **0.019** |
| the whole build | 0.186 | **0.081** |

The bench's own run, with a debug compiler on a busy machine, puts the warm
build at 0.10 s against `go build`'s 0.13 s. **The gap this project exists to
close is closed on this bench**, and what closed it was not compiling anything
faster: it was not asking a compiler driver to work out the same link command
several times a second.

The front-end target this item was written to protect is met on the same run:
0.041 s against 0.050 s, of which 0.018 s is a process linking LLVM before doing
no codegen.

**And that 0.018 s is measured too, because it is the second-largest thing left
and it is not analysis.** An empty C program starts in 0.002 s. The same empty C
program, linked so that `libLLVM.so.19.1` is *loaded* and nothing in it is
called, starts in **0.025 s**. The compiler starts in 0.031 s and the front end
built without a code generator starts in 0.008 s. Those four figures are one
minute's, and it was a slower minute than the table above. The ratio between
them is the measurement, not the absolute. The dynamic loader is 1 ms of it: `LD_DEBUG=statistics` counts
331,639 relative relocations and 2.9M cycles, so what is left is libLLVM's own
static initialisers, running in every `crystal` process whether or not it will
generate code. `crystal-front` is the standing proof that a build that generates
none need not pay it (IV.1a), and making the ordinary compiler not pay it means
loading the code generator when codegen is asked for rather than when the
process starts.

**Two routes to not paying it were tried, and neither is cheap.**

*Load the library when codegen asks for it.* The bindings are a `lib LibLLVM`,
so the library is a `NEEDED` entry and the loader maps it before `main`: the
question is whether the entry can be dropped and the library `dlopen`ed at the
first call. It cannot, not this way: linking with
`--unresolved-symbols=ignore-all` and `-z lazy` produces a binary the loader
refuses to start at all: *unexpected PLT reloc type 0x00*, because what the
linker leaves behind for an undefined symbol is not something lazy binding can
finish. Deferring it properly means resolving every LLVM function through
`dlsym` into a table of pointers, which is a rewrite of upstream's `lib
LibLLVM` and a permanent divergence from it.

*Link LLVM statically, so that the linker keeps only what is reached.* This one
works, and it is worth less than it looks. `LLVM_LDFLAGS` with
`--link-static` builds a compiler once `-lPolly` (not installed here) is
dropped and `zstd` is named by its soname, and the result is a 129 MB binary
that starts in 0.020 s against the shared build's 0.022 s. The reason so
little moves is that the compiler *reaches* five targets: `to_target_machine`
names x86, aarch64, arm, avr and webassembly, so five targets' initialisers are
linked in and run. Measured on a C program that calls exactly those
initialisers: 0.013 s through the shared monolith, 0.006 s statically with the
five, 0.004 s statically with x86 alone.

So the 0.018 s breaks down as about 0.002 s of Crystal runtime, 0.006 s of
target initialisers the compiler genuinely reaches, and the rest the monolith's
every target LLVM ships, in a process that will use one. **Static linking
takes the last part and leaves the middle**, which is 2-5 ms measured, for 75 MB
of binary. It is not made the default on that trade, and the middle needs the
initialisers to run *later* rather than not at all, which is the `dlsym` table
above, and a larger piece of work than the number it wins.

**3. A deliberately tiny prelude, written in iyi. Done: 1,184 lines,
primitives included.** Not a standard library: integers, booleans, a string,
one sequence, one dictionary, one range, `puts`. **Its scope is set by what the
samples call and by nothing else**. A method enters the prelude because an
existing sample needs it, never because it belongs there.

**The rule held; the samples were the thing that was wrong.** Writing the six
programs a person writes before they write a module found `(1..10).each`
answering "wrong number of arguments for `Range(B, E).new`" — the compiler
expands a range literal to a constructor and the prelude had never defined the
type — along with no `first`, no `select`, no `includes?` on either a string or
an array, and no `sorted`. None of those is a library ambition; each is the
second or third line of somebody's first program. So the answer was a sample
rather than an exception to the rule: `samples/iyi/basics.iyi` is that half
hour, it is in the samples the prelude is measured against, and the prelude
grew 131 lines to run it. The ceiling is unmoved and the trigger is unchanged:
a program in this repository needs it.

The ceiling was not a guess. Crystal's own 0.1.0 shipped 8,161 lines of
library. Its core is **3,551 lines** of that: `object`, `nil`, `bool`, `char`,
`int`, `float`, `number`, `string`, `array`, `hash`, `range`, `enumerable`,
`comparable`, `io`, `pointer`, `exception`, `raise`, `main`, `prelude`. The rest
is `json`, `yaml`, `http` and `option_parser`, which are libraries rather than a
prelude.
3,551 lines was the number to stay under, measured in the same language family
and for the same purpose. `src/iyi/` came in at 833, and **all the samples
run on it with output identical to what they print under Crystal's prelude**,
which is the acceptance test: the samples are the documentation, so a prelude
that changed what they printed would have changed what the documentation says.
A `.iyi` entry file gets it by default; `--prelude` still wins, and a `.cr`
file is untouched.

| | measured |
|---|---|
| front end, `hello.iyi` | 1.41 s → **0.13 s** |
| whole build, `hello.iyi` | 2.10 s → **0.32 s** |
| whole build, `webapp.iyi` | 2.17 s → **0.36 s** |

**And then the same rule applied one level down.** With Crystal's prelude gone,
0.11 s of the remaining 0.17 s front end was `src/primitives.cr`, not its 581
lines but its shape: twelve numeric types crossed with each other is 2,580
`@[Primitive]` definitions macro-expanded on every build. Measured by deleting
the block and building again, which took the front end to 0.02 s.

So iyi has its own. **`src/iyi/primitives.iyi` crosses five types**: `Int32`,
`Int64`, `UInt8`, `UInt64` and `Float64`. The default integer, the one a byte
count grows into, the byte, the one an address and a size are, and a float.
That is 445 definitions, and it took the front end to 0.07 s. `Int8`, `Int16`,
`Int128` and the unsigned middle exist as types and have no arithmetic;
`1_i8 + 1_i8` is an undefined method. **This is a language-visible decision,
not a library one**. It is the same rule as the rest of the prelude (a thing
enters because a sample writes it) applied to the one file where the cost is
quadratic. What it does not decide is implicit promotion: the five types cross
each other exactly as Crystal's twelve do, so `1 + 1_i64` still works. Whether
iyi keeps that or takes Go's line and demands an explicit conversion is open,
and cheaper to answer now that the block is small enough to read.

Three decisions made it that small, and each is a thing 0.1.0 does not have
rather than a trick. **There is no `IO`**: `puts` writes to fd 1 and `to_s`
returns a `String`, which removes buffering, encodings and the class hierarchy
under them. The largest single saving against Crystal's core. **`raise` is a
panic** (III.1.4): it prints and exits, so there is no unwinder, no personality
function and no exception hierarchy, and the three `__crystal_*` symbols that a
program with an `ensure` in it must link are stubs that say they cannot be
reached. **Strings are ASCII** wherever a method has to look inside one,
`upcase`, `starts_with?`, though `size` decodes UTF-8 properly, because a
sample counts the characters of a word with an accent in it.

What it is not: no `Float64#to_s`, no `Range`, no `Set`, no formatting, no
`Comparable`, no deletion from a `Hash`, and `sort` is an insertion sort
because the samples sort five elements. Each of those is absent because no
sample asked, which is the rule doing its job rather than a list of regrets.

**4. IV.6 #6, module naming. Done.** A module is declared `app/greeter` and
reached `App::Greeter`. This appears in every line of user code and could not be
changed once there was user code, so it was settled first. The mismatch stays
and is made reversible instead: a path segment is `[a-z][a-z0-9]*` with single
`_` between groups, so path and type name determine each other. "Lowercase
snake_case" turned out not to be enough: `v_1` and `v1` both give `V1`.

**5. A benchmark that produces the claim, and a check that fails until it
holds. Built.** `bench/` already priced macros and `Share`; build speed was the
one number the project exists for and the one with no committed harness.
`bench/build_speed.py` is it, and its first run is below. Its corpus was one
program, because `hello` is the only pair where "the equivalent Go program" is
unambiguous and because iyi had no other program to offer, which made growing
that corpus a dependency of this item on item 3, not a nicety.

**Grown, and the ambiguity is gone rather than argued away.** The second pair is
generated: `bench/build_speed/generate_pair.py` emits the iyi and the Go halves
from one loop, and the bench runs both and refuses to time them unless they
print the same thing. At 300 types it is about 6,900 lines, which is the size at
which user code is the bill rather than the fixed costs, and the first
measurement of it takes back the warm win the previous run recorded. See "Done
is a number" below.

**Where the five stand.** One is built and the eight samples compile with the
imported module's source deleted. Two is answered: the passes it named cost
0.4 ms, and the two things that did cost. A `PATH` search per build and a
driver rebuilding the same link command: are fixed, which is what took
`hello.iyi`'s warm build to 0.09 s against Go's 0.12 s. Three and four are done;
five is done and its second pair is what says that win is a win at that size,
at 6,900 lines Go is ahead 0.09 s to 0.23 s, and iyi is what grows. **What
remains for a release is not on this list**: III.4's concurrency is specified
and unbuilt, and III.5's "no import for side effects" is the one rule here with
a cost and no measurement. Everything else in this section is a number that has
been taken rather than a thing still to do.

### Out of scope, stated so it is not argued twice

III.4 in its entirety: structured concurrency is specified and it is not on
the critical path of the claim. III.5 rule 5's measurement. Cross-version
`.iyimod` compatibility (IV.5 already says this). A package manager. A standard
library. Self-hosting: the compiler is 87,421 lines and iyi's own library is
722, so this is not a near thing and pretending otherwise sets the wrong
priorities. Of the calls still open in Appendix B, only #1 is a taste decision
that would change what 0.1.0 looks like, and deferring it costs nothing.

### Done is a number

1. `bench/build_speed` prints one table, measured on one machine: iyi cold, iyi
   warm, and `go build` on the equivalent program. **The Go column is measured
   there, not quoted from anywhere**. This document has no Go timing in it and
   is not entitled to one until the bench runs.
2. The front end compiles `hello.iyi` in **0.05 s or less**. This is not an
   aspiration: IV.1a already ran a front end that never walks the prelude at
   0.049 s, and it emitted an object with an identical symbol table. 0.1.0's job
   is to make that configuration the ordinary one rather than an experiment.
   **Met: 0.039 s.** Not by the route IV.1a took. The prelude is small enough
   now that there is little left to cache, and two of the three things that
   closed the gap were the prelude and its primitives. The third was the
   instrument; see below.

   The figure was 0.039 s when this was written and it read **0.063 s, NOT
   MET** twice on one afternoon, on a binary that had changed only by
   deletions. Both readings were the same machine compiling something else at
   the time, and the bench has a guard for exactly that: it divides by what the
   compiler costs to start and does nothing when the machine is too slow to
   answer. The guard could not fire, because the reference it divides by was
   recorded when the compiler still carried the interpreter, the playground and
   the documentation generator. That binary started in 0.040 s and this one
   starts in 0.018 s, so every run looked 0.71x — comfortably faster than the
   machine the target was set on — and the bench went ahead and decided. **A
   stale baseline is worse than no baseline**: it does not report a wrong
   number, it turns off the check that would have refused to report one. It is
   re-recorded, and the comment beside it now says the binary counts as much as
   the machine.
3. The end-to-end `crystal build` time is published in the same table even
   though LLVM and the linker dominate it, so that the claim cannot quietly
   become a front-end-only claim.
4. The check for (2) is the bench's own exit status, not a spec. The release is
   a command that passes, not a judgement call. The same standard as the rest
   of this document. **Built:** `python3 bench/build_speed.py` exits non-zero
   while the target is unmet, and names which scope item closes the gap. It is
   deliberately not a `spec/compiler/…` example: one permanently red assertion
   in that suite would cost it the only thing it is good for, which is that a
   failure there means something broke.

**The first run, recorded because a bench with no baseline is a script.** On one
machine, best of three, seconds:

| program | stage | cold | warm |
|---|---|---|---|
| `hello.iyi` | front end (`--no-codegen`) | 1.32 | — |
| `hello.iyi` | end to end | 2.20 | 1.96 |
| `hello.go` | `go build` | 1.98 | 0.18 |
| `webapp.iyi` | front end, iyi only | 1.31 | — |

Three things fall out of it, and none were stated before it ran.

**The fight is the warm build, and it is 11× not 3×.** Cold, the two are level
2.20 against 1.98, because Go is compiling its own dependencies too. Warm,
Go drops to 0.18 and iyi to 1.96, because Crystal's cache only holds codegen
and the front end is redone in full every time. Warm rebuild is what a person
actually waits for, so **11× is the real gap**, and it is almost exactly the
front end: item 1 plus item 2 are worth 1.32 s of the 1.78 s difference.

**Being level when cold is not a consolation, it is a warning.** It means iyi's
cold build is already as expensive as compiling Go's stdlib from source, on a
program that prints one line.

**`webapp.iyi` costs the same as `hello.iyi`**, 1.31 against 1.32. IV.1d found
this on the previous instrument and it still holds on this one: user code is
nearly free and the fixed prelude cost is the whole bill. It is why the target
is set on a one-line program rather than a large one.

**The second run, after item 3.** Same machine, same command, with iyi's own
prelude (833 lines) in place of Crystal's 107,719:

| program | stage | cold | warm |
|---|---|---|---|
| `hello.iyi` | front end (`--no-codegen`) | **0.17** | — |
| `hello.iyi` | end to end | **0.38** | **0.37** |
| `hello.go` | `go build` | 2.54 | 0.16 |
| `webapp.iyi` | front end, iyi only | **0.18** | — |

**The 11× warm gap is 2.3×**, and it went there by deleting a dependency
rather than by making anything faster: nothing in the compiler changed for this
row. The front end is 7.8× off its own previous number and 3× over the target
rather than 26×.

**Cold, iyi is now 6.7× faster than Go**, 0.38 against 2.54, because Go cold
compiles its standard library and iyi cold compiles 833 lines. That reverses
the first run's warning and replaces it with a smaller one: the comparison is
only fair while iyi's library is this small, and it stops being flattering the
moment iyi has one worth the name.

**What is left is the same shape one order down.** 0.17 s of front end is 833
lines of prelude analysed from source on every build, and the reading here at
the time was that `.iyimod` removes exactly that. It does not: an artifact is
declarations in text, and a consumer parses them and runs the top-level pass
over them the same way. Measured in IV.1a once the artifact existed, on the
largest import graph here, and it is worth nothing at this size. What removes
the prelude's analysis is keeping it rather than serialising it. The daemon.

**The third run, and the target is met.** Two changes, one of them to the
instrument:

| program | stage | cold | warm |
|---|---|---|---|
| `hello.iyi` | front end (`--no-codegen`) | **0.04** | — |
| `hello.iyi` | end to end | **0.25** | **0.25** |
| `hello.go` | `go build` | 2.37 | 0.14 |
| `webapp.iyi` | front end, iyi only | **0.05** | — |

  measured 0.039 s against a 0.05 s target: **MET**.

The first change was iyi's own `primitives.iyi`, above: 0.17 s → 0.07 s. The
second was the instrument, and it has to be said plainly rather than banked.
**The bench used to time `bin/crystal`**, a POSIX-sh wrapper that resolves
symlinks with recursive shell functions, shells out to `uname` and `readlink`,
prints which compiler it found, and then `exec`s the binary. It costs **30 ms**.
`go build` is timed as a bare binary, so half of what was being compared was
this repository's development ergonomics. The bench now asks the wrapper once
for the two paths it knows and times the compiler: 0.07 s → 0.039 s.

**So the honest reading is that the target is met by the compiler and not yet
by `bin/crystal`**, which is still 0.066 s and is what a person in this
checkout actually types. Shipping a binary rather than a shell script is a
packaging job, not a compiler one, and it is not what this document is about,
but it is 45% of the number until it is done.

**Most of it turned out not to need the packaging job.** Alternating the old
script and a new one in the same directory, three rounds: **0.076 s against
0.044 s**. Four processes came out, none of which had to be there. The largest
started the *installed* compiler to read one string: `crystal env
CRYSTAL_LIBRARY_PATH`, 0.020 s, and that answer is now kept in `.build`, keyed
by the compiler that gave it. The others were `tput` deciding whether to colour
a message nobody may be reading, `uname` answering which binary to look for, and
`dirname`/`realpath` doing what `${path%/*}` and `pwd -P` do without forking.
What is left is about 0.018 s of shell over a 0.026 s binary, and *that* is the
packaging job.

**What is left of the front end.** Of 0.039 s: about 0.020 s is the top-level
pass over 1,053 lines of prelude and primitives, about 0.008 s is every other
semantic pass together, and the rest is process startup. Item 1's artifact
would carry the first term and item 2 addresses a term that is now 8 ms. The
gap that made this project has closed to the point where the remaining costs
are the ones every compiler has.

**The Go column, at last, and it is not the one this project was expecting.**
Item 1 of this section says the Go number is measured here or not had at all.
Until now it was not had: `go` was not installed on the machine, and every run
printed so. It is installed now: Go 1.25.2, and the table is complete:

| program | stage | cold | warm |
|---|---|---|---|
| `hello.iyi` | front end (`--no-codegen`) | 0.049 | — |
| `hello.iyi` | front end, no LLVM linked | **0.03** | — |
| `hello.iyi` | end to end | 0.21 | **0.19** |
| `hello.go` | `go build` | 4.62 | **0.08** |

**Warm, Go wins by 2.4×**, and warm is the number a person feels: 0.08 s against
0.19 s. Cold, iyi is fifteen to twenty times faster (0.21 s against 4.6 s) but
that column is Go compiling its standard library into an empty cache, which is
paid once per machine and is not a rebuild. Recording it flattering side up
would be the kind of thing this document exists not to do.

**And the front end is faster than Go's whole build.** 0.03 s of analysis
against 0.08 s for parse, typecheck, codegen and link. So the claim as this
project has been making it is true of *analysis* and false of *producing a
binary*: of iyi's 0.19 s, about 0.14 s is LLVM at `-O0` and `cc`. Item 3 of
this section put the end-to-end row in the table precisely so the claim could
not quietly become a front-end-only claim, and this is that guard firing.

**Which moves the next lever off the front end entirely.** Everything left in
Part IV buys milliseconds of analysis against a 140 ms tail that belongs to a
code generator and a linker. Go's answer to that tail is its own back end and
its own linker; iyi's options are narrower and none of them is `.iyimod`.

**The fourth run found nothing about the compiler and two things about the
gate.** Run on the same checkout minutes apart, `bench/build_speed.py` said both
MET and NOT MET.

**The first was how `.build/crystal` had been built.** The compiler is itself a
Crystal program, and a debug build of it is **1.5× slower**: 0.104 s against
0.068 s, measured by alternating the two binaries so that the machine's state
cancels, which is what the first attempt at this number did not do and why it
read 2.2×. The target is decided by a few percent, so the build mode decides
the gate. `make crystal release=1` does not settle it either: make takes an
existing binary for up to date whatever it was built with, and says nothing.
The bench now asks the compiler how it was built. The compiler already knows,
and `--version` says so: prints the answer above the table, and **refuses to
decide the target from a debug build** rather than reporting the compiler as
too slow.

**The second was the machine, and it is the larger term.** On one binary,
minutes apart, the front end measured **0.048 s, 0.109 s and 0.061 s**. Most of
that turned out to be three samples rather than three machines: fifteen runs put
the floor at 0.048, 0.042 and 0.045 s across three sessions whose medians ranged
0.048 to 0.070. Best-of-N assumes the samples reach the floor, and three did
not. The gated figure now takes fifteen after two discarded warm-up runs, and
prints the slowest beside the fastest.

**What is left of it is written down rather than averaged away.** The first
invocation after the machine has been idle reads about 40% high. Every sample
in it, not a few, and the ones a minute later do not. Two probes were tried
against that swing and neither isolates it: a fixed integer loop held to 4%
across the same period, and startup moves with it only partly. So a single run's
MET is worth more than its NOT MET, and a NOT MET from a machine that has been
asleep is worth running again.

**And measuring startup separately answered a question nobody had asked.**
Starting the compiler and doing nothing (`crystal --version`) costs **0.029 s
against a 0.042 s front end**. Two thirds of the number this target is set on is
a process starting rather than a line being analysed.

**It is not the binary, and it is not the loader. It is linking LLVM.** The
dynamic loader accounts for 3.2M cycles of it (about a millisecond) by its own
statistics. What the rest is took a control: a C program whose `main` returns
zero costs **0.001 s** built plainly and **0.026 s** built with a `NEEDED` entry
on `libLLVM.so` and no call to it. `clang --version` pays the same 0.023 s, and
a small Crystal program with no LLVM pays 0.004 s. So it is libLLVM's own
load-time initialisers, charged to every process that links the library whether
or not it generates code, and `crystal build --no-codegen` is exactly a process
that does not.

**That reorders what is left of this section.** Item 2 was written to remove
passes that re-walk the prelude; those are now about 8 ms together, against 26
ms spent bringing up a code generator the front end never calls.

**So the front end became a binary of its own, and it is built.**
`make crystal-front` produces `.build/crystal-front`: the same parser, the same
semantic passes, no LLVM linked. Measured against `crystal build --no-codegen`
on the same machine, fifteen runs each after two discarded:

| | full compiler | front end only |
|---|---|---|
| `hello.iyi` | 0.059 s | **0.028 s** |
| `webapp.iyi` | 0.045 s | **0.035 s** |
| starting up, doing nothing | 0.023 s | **0.0045 s** |

Startup falls by a factor of five and the gated figure by half. What is left of
`hello.iyi` is about 23 ms of analysis and 4.5 ms of a process starting, which
is the shape the target was written to reach.

**What it cost was smaller than the 64 references suggested.** Outside codegen
the compiler names `LLVM` in four places and three are strings settled when the
binary was built. The LLVM version, the host triple, and normalising a triple
a user typed, so `llvm_shim.cr` bakes them in. The fourth is a target machine,
wanted by one AVR flag. Two other things had to be absent rather than shimmed,
and both say so when reached: `sizeof` and its neighbours, which are answered
from LLVM's data layout, and `macro_run`, which compiles a program and runs it.
Nothing in iyi's prelude or samples writes either. Two plain types had to move
out of files that speak LLVM: `Compiler::OptimizationMode` into its own file,
and `Const#initializer` behind the same flag.

**And what it does not do is the rest of a build.** It parses, analyses,
reports and exits; there is no object file, no linker and no cache, because
those belong to the half that is missing. `crystal build` is unchanged.

Two things could take the remaining 26 ms off a full build as well, and neither
is this: **an LLVM built without its option registry**, which is not iyi's to
build, and **not paying it per build**, which is IV.1d's daemon. A process
that starts once amortises the fixed cost over every compile after the first.
The daemon was proposed to keep the prelude analysed; the larger thing it keeps
is the code generator loaded.

**The fifth run, and the warm column changed hands.** The 140 ms tail that the
Go comparison above assigned to "a code generator and a linker" was neither: it
was `cc` working out how to link, on every build. The compiler asks the driver
once now and runs `ld` itself (0.1.0 item 2), and the same bench on a release
compiler says:

| program | stage | cold | warm |
|---|---|---|---|
| `hello.iyi` | front end (`--no-codegen`) | 0.05 | — |
| `hello.iyi` | front end, no LLVM linked | 0.03 | — |
| `hello.iyi` | end to end | 0.24 | **0.09** |
| `hello.go` | `go build` | 4.15 | 0.12 |
| `webapp.iyi` | front end, iyi only | 0.06 | — |

  measured 0.047 s against a 0.05 s target: **MET**.

**Warm, iyi is now ahead**: 0.09 s against 0.12 s, where the run before this one
had it 0.19 s against 0.08 s. Nothing in the front end moved to do it. Of what
the compiler times in that warm build, the link is 0.026 s of 0.058 s: 45%,
where it was 93% this morning.

**And the gate is inside this machine's noise, which is worth saying rather than
picking the run that flatters.** Two release runs minutes apart measured 0.047 s
and 0.052 s against a 0.050 s target: MET and NOT MET on one binary. The
paragraph above about a machine that has been idle reading high is the same
observation, and the same conclusion follows. A NOT MET from a machine that
has just finished a compile is worth running again, and a target decided by 4%
is a target the next machine will decide differently.

**The sixth run had a second program in it, and it takes the previous
paragraph's headline back.** Item 5 said the corpus was one program because
`hello` is the only pair whose Go equivalent is unarguable, and that growing it
waited on item 3. `bench/build_speed/generate_pair.py` grows it without the
argument: both halves come out of one loop: 300 structs with two fields, an
arithmetic method, a method taking another of its kind, a name, and a main that
adds up what they answer, so they are the same shape by construction, and the
bench builds and runs both and drops the rows unless they print the same thing.
About 6,900 lines of iyi, 6,000 of Go. On a release compiler:

| program | stage | cold | warm |
|---|---|---|---|
| `hello.iyi` | end to end | 0.18 | **0.07** |
| `hello.go` | `go build` | 3.30 | 0.10 |
| `medium.iyi` (6,900 lines) | front end (`--no-codegen`) | 0.10 | — |
| `medium.iyi` | end to end | 0.58 | **0.23** |
| `medium.go` | `go build` | 3.66 | **0.09** |

**Go's warm build does not move and iyi's does.** Across a 6,900-line
difference Go went 0.10 s → 0.09 s; iyi went 0.07 s → 0.23 s, and at 13,800
lines it is 0.42 s against Go's 0.087 s. So the warm win recorded above is a
win at the size of `hello` and nothing more: it came from removing fixed costs,
and fixed costs are the whole bill only while the program is one line. Per
thousand lines of this program iyi costs about 25 ms and Go costs nothing
anyone here can measure.

Where those milliseconds go, at 300 types and warm: parse 55 ms, semantic 87 ms
across every pass, codegen 115 ms, link 55 ms. Nothing in that list is the
prelude, the artifact or the driver. It is the compiler compiling, which is the
first time in this document that has been the answer.

**And one of those terms is paid for work that is then thrown away.** After a
one-line edit at 300 types the compiler reports `305/306 .o files were reused`
the per-unit cache doing exactly what it is for, and still spends 87 ms in
`Codegen (crystal)`, which is building the LLVM IR for all 306 units. The IR is
what the hash is taken *from*, so every unit is generated in order to discover
that 305 of them did not need to be. What the cache saves is the back end after
that point: `bc+obj` falls to 42 ms, of which most is bookkeeping over 306
units, and the link is 60 ms for 306 objects.

The obvious alternative is one module, and it is not better: measured both ways,
unchanged source favours `--single-module` (0.257 s against 0.316 s, fewer files
to check and one object to link) and **a real one-line edit favours the unit per
type** (0.390 s against 0.505 s), which is the case that matters and the reason
the default is what it is. The first attempt at this comparison said the
opposite, because its "edit" for the first iteration rewrote the file with the
text it already had; the number that came out was a warm build with nothing to
do, and `min` picked it.

So the work worth removing is generating IR for a unit whose object is going to
be reused, and that needs a unit's *inputs* fingerprinted rather than its
output. A dependency-tracking problem, not an optimisation. It is written down
here rather than started.

**The front end was asked the same question and answered that there is nothing
wrong with it.** At 150, 300, 600 and 1,200 types (3,462 to 27,612 lines) parse
goes 0.026, 0.048, 0.092, 0.165 s and `main` goes 0.029, 0.056, 0.114, 0.236 s:
linear in both, with the top-level pass flat at 0.026–0.041 s because what it
walks is the prelude rather than the program. About 6 µs a line to parse and
8.5 µs a line to type, on a debug compiler. There is no quadratic hiding in
there and so nothing to remove; what is left is the cost of the implementation,
which is a project rather than a fix, and this document would rather say so than
imply a bug it has not found.

### What Crystal's own 0.1.0 looked like

The scope above was drawn before checking it against the one release most
comparable to it. The same language family, the same first-release question.
Checking it moved two things and left the shape alone.

| | Crystal 0.1.0 (2014-06-18) | iyi today |
|---|---|---|
| Compiler | 24,984 lines, **written in Crystal** | 87,421 lines, Crystal, forked |
| Library | 8,161 lines (3,551 of it core) | 1,184 prelude + 722 in samples |
| Specs | 21,146 lines | ~3,400 for iyi |
| Samples | 24 **programs** | 8 **explanations** |
| History | 3,165 commits over 21 months | 75 |
| Own status line | *"pre-alpha: we are still designing the language"* | design largely settled, building not started |

**It shipped admitting the language was undesigned.** No binaries, clone and
run `bin/crystal --setup`, OSX and 32/64-bit Linux. That is permission rather
than a rebuke: the scope above is *more* conservative than the release it is
being measured against, and iyi is further along in design at this point than
Crystal was at its first release. It is behind on building and ahead on
deciding.

**Its samples were programs.** mandelbrot, binary-trees, brainfuck,
`http_server`, sudoku, a red-black tree, n-bodies, SDL and Cocoa bindings. iyi's
samples are better in one respect. Every claim in them is compiled, which
Crystal's were not, and they have a gap Crystal's did not: **no iyi program
does any work.** A build-speed claim needs programs to build, and the benchmark
in item 5 therefore starts with almost nothing to measure. Growing that corpus
is a dependency of item 5, not a nicety, and it is bounded by item 3: a program
can only be written once the prelude carries it.

**And self-hosting was already behind it.** Crystal's compiler was written in
Crystal before 0.1.0, at 24,984 lines against an 8,161-line library. That is
the cheapest such a move is ever going to be, and the cost only rises. See
Appendix B #10. The fork means iyi has already passed that point, and this
document has been silent about it.

### The item that decides the schedule

Item 3. "Tiny prelude" sounds small and is not: writing a string and a
dictionary under iyi's own rules (no open classes, `Share`, `sorted`) is the
first real library ever designed against them, and the whole of the evidence
that this is possible is one ported `Enumerable` and 722 lines of samples. The
bound is the rule stated above: the samples decide what goes in. If that bound
slips, 0.1.0 becomes a standard-library project and the claim goes unmeasured
for a year.

---

## Part II: Interactions

### II.1 Union types × traits: **SETTLED**

The question: can you write `impl Greet for String | Int32`?

**No. Union impls are not writable. A union implements a trait if and only if
every member implements it.**

```
impl Greet for String    # ok
impl Greet for Int32     # ok
# String | Int32 now implements Greet, automatically.

impl Greet for String | Int32   # ERROR: cannot impl a trait for a union
```

Why this and not explicit union impls:

- **No new coherence rule is needed.** If unions were implementable, you would
  have to decide what happens when both `String` and `String | Int32` have an
  impl, and every answer is a footgun.
- **Dispatch already exists.** A union value carries a type id; calling a trait
  method on it compiles to the switch Crystal already generates. No new
  machinery.
- **It composes.** `Array(String | Int32)` works with any trait both members
  implement, without anyone writing anything.

A consequence worth noticing, because it is a feature rather than an accident:
`T?` is `T | Nil`, so **`T?` implements a trait only if `Nil` does too.** In the
Kemal port `Nil` implements `IntoBody` (returning `""`), so `String?` is
returnable from a route. Where `Nil` does not implement a trait, the nilable
type is rejected at compile time: nil-handling is forced at exactly the point
it matters.

### II.2 Union types × dictionaries: **SETTLED**

The question: a union is already a boxed (type id, payload). Is that a
dictionary? Do the two dispatch mechanisms collide?

**They are orthogonal, and the rule is: a union is one type with one shape.**

|  | Union | Dictionary |
|---|---|---|
| What varies | the **value**'s runtime type | the **type parameter**, erased to a shape |
| What is fixed | the code | the value's layout |
| Dispatch | switch on type id carried by the value | indirect call through ops passed alongside |

So `T = String | Int32` receives **one** dictionary, not two. The union is a
single type whose shape is `UNION(PTR|SCALAR4)`. Inside the shared body, a trait
call on a `T` value still switches on the union's type id exactly as it would in
monomorphic code.

This is worth stating explicitly because the intuition "unions are already
dynamic, so they must be dictionaries" is wrong and would lead someone to build
two parallel dispatch systems.

### II.3 `using` × everything: **BUILT, one sub-question open**

The Kemal port proved `using` is required: without it, Kemal's DSL is
unwritable, because Crystal achieves it by injecting top-level methods into the
importing program's global namespace. But the port did not say what `using`
*is*. Proposed rules:

**1. `using` affects unqualified calls only. It never affects method resolution
on a receiver.**

```
using kemal::dsl

get "/" do |env| ... end     # unqualified -> resolved via `using`
user.greet                   # receiver call -> resolved via User's traits only
```

This single rule dissolves the `using` × traits question entirely: they operate
in disjoint namespaces and cannot interact. Trait method resolution is always
and only a function of the receiver's type and its impls.

**2. Local definitions beat imported ones. Always.**

Defining your own `get` shadows an imported `get`, with no ambiguity error. A
library can never break your code by adding an export that collides with
something you already had.

**3. Ambiguity is an error at the point of *use*, not the point of import.**

```
using a          # exports get, post
using b          # exports get, delete

post "/x" do ... end     # fine
get  "/x" do ... end     # ERROR: `get` is ambiguous (a::get, b::get): qualify it
```

Resolvable from export metadata alone, so it costs nothing. And it means adding
an export to a library only breaks consumers that actually call the colliding
name.

**4. File-scoped, declared at the top. No block-scoped `using`.**

Block-scoped imports are Ruby's `instance_eval` in a new hat: they make the
meaning of a bare name depend on where you are in a file. Not worth it.

**5. Selective form available and encouraged:**

```
using kemal::dsl                    # everything exported
using kemal::dsl::{get, post}       # just these
```

**Enforced.** `pub` is what a module's surface is, and both halves are closed:
`using` reaches only exported names. The selective form reports at the
directive which of the names it asked for the module does not export, and a
qualified `App::Greeter.helper` or `App::Greeter::Closed` is refused too.

The second half is not decoration. `.iyimod` carries a module's exports and
nothing else (IV.2), so if another module could reach an unmarked name, that
metadata would not be enough to compile against and R-1 would not hold.

Only a `module app/greeter` compilation unit has a surface, and only its own
body carries it: a `def` inside a `pub trait` or a `pub struct` belongs to the
trait or the struct. `Enumerable#to_a` writes no `pub` and stays callable on
every implementer. A Crystal module never wrote `pub` and is untouched.

**OPEN:** whether `using` may be re-exported (`pub using`), so a facade module
can pass a DSL through. Convenient for `import kemal` giving you the DSL without
a second line, and a way to reintroduce exactly the implicitness R-3 removed.
Recommend **no** for Draft 0.

### II.4 Derive macros × separate compilation: **SETTLED**

This is the interaction that decides whether R-5 delivers the caching it
promises.

**A derive runs once, in the module that declares the type. Its output is part
of that module's export metadata. Consumers never re-run it.**

```
# module app/user : the derive expands HERE, once
pub struct User
  derive JSON
  getter name : String
end

# module app/api
import app/user
user.to_json      # reads export metadata; no macro expansion happens here
```

Coherence holds automatically: `derive JSON` generates `impl ToJSON for User`,
which lives in `User`'s own module: legal under R-3. And you cannot derive a
trait for a type you do not own, which is the orphan rule again, consistently.

**What a macro may read. The precise version of R-5:**

> A macro may read the declaration it is attached to, and the **export metadata**
> (never the bodies) of imported modules. It may not enumerate types it was
> not given.

This is more permissive than "module-local" and still separately compilable.
It matters for the realistic case:

```
pub struct Order
  derive JSON
  getter customer : Customer     # imported from another module
end
```

Expanding `derive JSON` here needs to know only whether `Customer` implements
`ToJSON`. A fact in `Customer`'s export metadata. It never needs
`Customer`'s method bodies. Bounded, cacheable, correct.

What this forbids, and should: `all_subclasses`, program-wide `macro finished`,
and `macro_run`. The last of which costs a fixed **+7.4 s per distinct script**
on a cold build, remeasured in II.10.

### II.5 Dictionaries × the garbage collector: **SETTLED, and a dependency**

This one only became visible while writing the spec, and it removes a choice I
had previously presented as free.

Shape-based stenciling means one compiled body serves many types. That body must
still tell the collector which words in a value are pointers. **The pointer map
therefore has to travel with the shape**, which is exactly why Go calls it a
*GC shape* rather than a memory layout.

Consequences:

- **R-4 requires a precise collector.** Crystal's Boehm GC is conservative: it
  guesses at pointers by scanning. That works without shape information, but it
  cannot supply the per-shape pointer maps stenciling needs.
- So "replace Boehm with a precise GC" is **not** an independent runtime
  decision to be taken later. It is a prerequisite of R-4, and it constrains
  object layout from day one.
- Recommended: precise, generational, **non-moving** for Draft 0. Moving
  collection requires interior-pointer discipline throughout, and Crystal's
  `to_unsafe`/`Pointer` idioms are pervasive. Defer.

### II.6 Traits × the standard library: **SETTLED by porting `Enumerable`**

`Enumerable` is the load-bearing abstraction of Crystal's stdlib: 2,350 lines,
**130 methods built on a single `abstract def each`**, included by 17 types.
`Comparable` reaches 21 more. If traits cannot express that shape, the library
cannot be written in Crystal's idiom and the ergonomics half of the pitch fails.

It ports. But it required three things Draft 0 did not have, and exposed one
genuine conflict.

**It now ports in the compiler, not on paper.**
`samples/iyi/std/enumerable.iyi` carries **57 of Crystal's 71 distinct method
names** (58 defs against Crystal's 117, which counts overloads), all written
against one `abstract def each`. `samples/iyi/collections.iyi` implements it for
two types that answer `Elem` differently and calls every one of them. A default
method that is never called is never typed, so a trait that merely compiles
proves nothing. What is left out is listed at the foot of the port, and is
mostly the nilable-variant family (`minmax?`, `max_by?`) and methods that
destructure the element (`to_h`, `chunks`). It needed the
three things below and nothing else. Three findings came out of the port that
this section had wrong or had not reached:

- **The block must not be captured.** The sketch below writes
  `abstract def each(&block : Elem -> Nil)`. That form captures the block into
  a `Proc`, and a captured block cannot `return` from the enclosing method,
  which removes early exit from `find`, `any?`, `all?`, `none?`, `first`,
  `take`, `take_while`, `empty?`, `index` and `find_value`. It has to be typed
  without being captured, `& : Elem -> Nil`, and yielded. Corrected below.
- **Dropping `!` made the library more consistent.** Crystal spells two of
  these `find!` and `index!`, against its own `max?`/`max` and `first?`/`first`
  convention, only because plain `find` was already taken by the nilable one.
  With `!` gone (III.1.7) the port uses `find?`/`find` and `index?`/`index`
  throughout. The naming decision paid here rather than cost.
- **A trait needs to require class-level methods, and now can.** `sum` and
  `product` with no argument need an additive and a multiplicative identity,
  and an identity belongs to the type: an empty collection has no element to
  ask. So `Num` declares `abstract def self.zero : self`, an impl answers it
  with `def self.zero`, and `sum` reaches it as `Elem.zero` through the
  associated type. The requirement is checked at the impl like every other,
  and reported as `self.zero`. What has to be written to fix it. It stays
  refused outside a trait, where an abstract class method would oblige nobody:
  only a trait has implementers whose class methods anything checks.

  This is checked separately from the instance requirements, because `include`
  carries instance methods only. The trait's metaclass defs never reach the
  target's, so there is nothing for the impl to have inherited. It has to have
  written them.

Finding 6 below is realised too: `zip` is `forall O : Enumerable`, and `O::Elem`
names what the other collection yields without the caller stating it.

**1. Traits need associated types as well as parameters.**

```
pub trait Enumerable
  type Elem                                     # an output of the impl
  abstract def each(& : Elem -> Nil) : Nil      # required, and not captured
  def to_a : Array(Elem)                        # default, has a body
    # ...
  end
end
```

**`abstract def` marks a requirement, and this was corrected by writing the
parser.** The first draft used a bare `def each(...) : Nil` with no body. That is
ambiguous in a language with no statement terminator: after the signature, the
parser cannot tell a requirement from a default whose body starts on the next
line without unbounded lookahead. Rust avoids this with `;`. `abstract` is
already a Crystal keyword meaning exactly this, so it costs nothing and reads as
expected.

A collection iterates one way, so the element type is not something the caller
picks: making it a parameter would leave `arr.map` ambiguous about which impl
it means. But parameters are still needed where several impls are the whole
point (`Into(T)`, `From(T)`). **Both forms exist.** Draft 0 assumed only
parameters.

**Both are built.** An impl answers an associated type in its body, and names a
trait's parameters where it names the trait:

```
impl Container for Names          impl Into(String) for User
  type Elem = String                def into : String
  def first : String                  "u"
    "ada"                           end
  end                             end
end
```

Both are carried as type vars of the trait. What a trait's signatures and
default bodies need from them is identical, and an included generic module is
already how Crystal resolves such a name. They differ in exactly one checked
rule, which is the whole reason the distinction exists: **a trait that declares
associated types can be implemented only once for a given type.** A second impl
answering `Elem` differently would make a call on that type ambiguous, which is
the cost that ruled out making the element type a parameter. A trait with
parameters has no such rule, because several impls are the point of it.

One gap the implementation found, and it is on the parameter side: two impls of
the same parameterised trait for one type **collide when their methods take the
same arguments**. `impl Into(String) for U` and `impl Into(Int32) for U` both
define `into`, and the second silently wins. That is the shape parameters exist
for, so it needs an answer; Rust's is to select the impl from the type the call
site expects, which this design does not yet have anywhere else.

**2. Default methods need their own type parameters.**

```
def map(&block : Elem -> U) : Array(U) forall U
```

`U` belongs to the method, not the trait. Unavoidable: `map`, `flat_map`,
`group_by`, `min_by` and `to_a(&)` all need it.

**3. Default methods need conditional bounds.**

```
def max  : Elem            where Elem : Comparable
def sum  : Elem            where Elem : Numeric
def tally : Hash(Elem, Int32) where Elem : Hashable
```

About a quarter of `Enumerable` is only valid for some element types. Crystal
duck-types these and fails at instantiation with a confusing message; a closed
method set forces the bound to be written. More work for the library author, a
much better error for the caller.

**Built.** `where` bounds a name the method did not introduce, which is what
separates it from `forall`: `forall` introduces a name and may bound it, `where`
bounds an associated type the enclosing trait already introduced. The check runs
where the call is matched, because by then the associated type is a type, and it
reports `Int32 does not implement Comparable, required by `where Elem :
Comparable` in `max``. The unbounded methods of the same trait stay available
whatever the element type is; only the bounded one is withheld.

**3a. A trait needs to require another trait.** `Comparable` reaching 21 more
methods is only sound if an implementer of the trait that uses them has them.

```
trait Ord : Cmp
  def beats(other : self) : Bool
    cmp(other) > 0        # Ord never declared `cmp`
  end
end
```

**A requirement, not an inclusion.** Were `Ord` to include `Cmp`, every
implementer of `Ord` would satisfy `Cmp` with no `impl Cmp for` it anywhere,
the open-class hole R-3 exists to close. So `impl Ord for X` is refused unless
an `impl Cmp for X` already exists, and `Ord`'s default bodies still reach
`cmp` because a module's body resolves against the type it is included in.
Transitivity is free: if `Cmp` required `Show`, the `impl Cmp for X` this one
insists on was checked the same way.

The price is that impls have to be written in dependency order. The check needs
this impl and the trait's declaration and nothing else, which is what R-1 asks
of it, and nothing has run that would know about an impl written later.

**4. The conflict: where default bodies are compiled.**

R-1 says compiling a module reads only export metadata, never bodies. But a
default method's body must be compiled for each implementing type, and the
implementer is in another module. This is the Go/Rust fork a second time:

- **(a)** Stencil the body once per GC shape in the trait's module, reaching
  element operations through a dictionary. Pure R-1, cheap to compile, and it
  pays the cost measured at **4.3× on reference field access**, which is exactly
  the shape of `arr.map(&.name)`, the most idiomatic line in Crystal.
- **(b)** Ship default bodies in export metadata so the implementing module
  monomorphises them. Fast at runtime; precisely why Rust compiles slowly.

**Resolution: (a) by default, `@[Monomorphize]` opting a method into (b).** The
hot handful (`each`, `map`, `select`, `reduce`) are marked in the stdlib; the
other ~120 stay stencilled.

The price is real and belongs on the record: **the library author now makes a
per-method performance decision and has to get it right.** Crystal's author
never faced that choice, because everything monomorphises. This is the clearest
place where iyi asks the stdlib to absorb complexity so that user builds stay
fast.

**5. Dictionaries carry a type descriptor, not just a pointer map.**
`select(type : U.class)` filters by runtime type, so dictionaries need type
identity. II.5 had claimed only pointer maps; Go's dictionaries carry both.

**6. One simplification found.** Crystal's
`zip(*others : Indexable | Iterable | Iterator)` is duck typing left over from
having no traits. In iyi it is `forall O : Enumerable`. A union-of-traits bound
would mean "implements at least one of", which no body could rely on. It should
not exist in the language.

### II.7 Generic impls: **SETTLED**

`impl Enumerable for Array(T) forall T`. Four decisions, each taken from the
language that already paid for the mistake.

**1. The binder is required (Rust).** `impl Show for Box(T)` with no `forall T`
is refused. Without the binder, whether `T` is a new parameter or a type
already in scope depends on what happens to be imported, so a library could
change the meaning of a consumer's impl by adding an export. Rust requires
`impl<T>` for exactly this reason. The cost is four characters; the error names
them.

**2. Parameter names are the impl's own, bound positionally (Rust and Java,
not Crystal).** `impl Show for Pair(X, Y) forall X, Y` works on a `Pair(A, B)`.
Crystal requires a reopened generic to repeat the declared names, which leaks a
type's private naming into every impl of it. An impl states arity, not
vocabulary.

**3. A bound is a trait, and nothing else (Go).** `forall T : Show`. There is no
separate constraint language: what you can bound by is what you can implement.
This matters more here than in Go, because under R-4 a bound is not only a
check. It is what gets passed, as the dictionary.

**4. No specialisation and no blanket impls (Java's position; Rust's unfinished
business).**

- `impl Show for Box(Int32)` alongside `impl Show for Box(T) forall T` is
  refused. Overlapping impls need a rule for which one wins, and that rule has
  to stay sound when the two live in different modules compiled separately.
  Rust has wanted specialisation for a decade and it is still unstable. Java
  cannot express it at all. Refusing it is what keeps `Box(T)`'s method set
  knowable without knowing `T`. The same property R-3 exists to protect.
- `impl Show for T forall T : Debug`. A blanket impl: is refused for the same
  reason open classes are: it lets a distant module add methods to every type.

**What it costs.** Nothing extra at build time. Under R-4 an impl on a generic
type is compiled once per GC shape, not once per instantiation, so a generic
impl is one body and not N.

**A bound on a method and a bound on an impl are two different features.** The
draft treated `forall T : Show` as one thing. Implementing it showed the two
places it can be written have almost nothing in common:

| | What it means | Cost |
|---|---|---|
| `def add_route(&block : Ctx -> B) forall B : IntoBody` | The method exists either way. When `B` binds to a concrete type, check that the type implements the trait. | One check at the call site. **Built.** |
| `impl Show for Box(T) forall T : Show` | `Box(Int32)` implements `Show` only if `Int32` does. A **conditional** impl, checked where the type is instantiated rather than where the impl is written, and interacting with coherence. | A separate mechanism. **Not built.** |

The method form is the one the Kemal router depends on, in both `add_route`
and the macro loop that generates the HTTP verbs, so it was on the critical
path of the design's own acceptance test while being the cheaper of the two.
The error names the type, the variable and the method:

```
Error: Int32 does not implement App::Router::IntoBody, required by `B` in `add_route`
```

It is reported as an error rather than as a failed overload match. Under R-3 a
type's method set is closed, so "`Int32` does not implement `IntoBody`" is the
true reason a call is rejected, and Crystal's "no overload matches" would bury
it. This is also where II.6 finding 6 lands: `zip(*others : Indexable |
Iterable | Iterator)` becomes `forall O : Enumerable`.

**A generic impl of a trait with an associated type (II.7 × II.6) did not
work until something needed it.** `impl Enumerable for List(T) forall T` with
`type Elem = T` reported `undefined constant T`. Both halves were built and
specced; they had simply never been written together, because every impl in the
samples was either generic with a parameterless trait (`Show for Box(T)`) or
associated-typed on a concrete target (`Enumerable for Nums`).

The cause is worth recording, because the obvious fix is the wrong one. An
impl's answer to an associated type becomes an argument of the `include` the
compiler writes, and that argument may name a parameter of the *target*,
`List`'s `T`, which is not in scope where the impl was written. Pushing the
target's scope to find it loses the trait, whose name lives in the impl's own
module, and breaks every `impl Cmp for Int32` in `samples/iyi/std/traits.iyi`.
The parameters have to be passed as **free variables** into a lookup that still
happens in the impl's scope, which is what resolving a superclass from inside a
generic already does. Both names then resolve, each from where it actually
lives.

That a generic collection implementing `Enumerable` is the first program to
need this says something about the order the samples were written in: the
canonical case arrived last.

### II.8 What a trait is, and is not: **SETTLED**

Draft 0 said `impl Trait for Type` and left "trait" undefined. The first
implementation desugared it to a module, which compiled but meant a trait and a
module were the same thing: `include Greet` worked, `using Greet` worked, and
`abstract def` was Crystal's abstract method rather than a requirement of
anything. Writing the checks settled what the word means.

**The distinction is at the declaration and use sites, not in the type
hierarchy.** This is the finding, and it went the opposite way from the
expectation. A trait has to *be* a type: `def render(x : Showable)` is
ordinary iyi, and it dispatches to the impl, and everything that makes that
work is what a module already does: it holds the required and default methods,
an impl registers the implementing type against it, and a call on a
trait-typed receiver resolves through the set of implementers. Rebuilding that
as a separate kind of type would mean reimplementing restriction matching,
union dispatch and codegen to arrive back where it started.

So `TraitType` is a *subclass* of the module type. What it adds is the ability
to refuse four things:

| Written | Refused because |
|---|---|
| `include Greet` / `extend Greet` | A type acquires a trait by having an impl, whose location R-3 can check. `include` has no such rule. It is the open-class hole under a different name. |
| `using Greet` | A trait exports no names to bring into scope. By II.3 rule 1 a trait method is resolved from the receiver, never from a `using`, so the two never meet. |
| `impl SomeModule for X` | A module has no requirements to satisfy and nothing for R-3 to check. Only a trait is implementable. |
| `impl Greet for SomeTrait` | A blanket impl in disguise, refused for the reason II.7 gives. |

The selective form of `using` may still *name* a trait,
`using app/show::{Showable}` uses the module and selects a type from it, which
is II.3 working as specified.

**`abstract def` is a requirement, checked where the impl is written.**
Crystal's abstract-method check reports at the point the type is first *used*,
names the type rather than the impl, and says nothing at all if the type is
never used. The trait reading is different in all three: an impl that does not
satisfy the trait is wrong when it is written, whether or not anything uses it.
The check is local. It needs the trait's declaration and this impl, never a
global pass, which is what R-1 requires of it.

A requirement is satisfied by the method existing on the target, not strictly
by the impl block defining it. A `def show` written on the struct itself lives
in the type's own module, which is exactly where R-3 would let an impl live, so
accepting it opens no coherence hole.

**Not yet built:** associated types (`type Elem`, II.6) are not parsed, and a
trait cannot yet require another trait.

### II.9 The Kemal port, compiled: **SETTLED**

The design named Kemal's router as its acceptance test and reported that it
passed. That port was done **by hand, on paper**. It has now been fed to the
compiler: `samples/iyi/kemal/{router,dsl}.iyi` and `samples/iyi/webapp.iyi`
compile and run.

**Everything ported, and one thing had to be built first.** `record`, the macro
loop over a module-local constant that generates the HTTP verb surface,
`with sub_router yield`, blocks, procs, `alias`, `case` on symbols, nested
records, `Array(Tuple(String, String))`: none needed a language change. The
single feature the port required that did not exist is the method-level trait
bound of II.7, which is how `HTTP::Server::Context -> _` gets a name. That it
sat on the acceptance test's critical path is the argument for having built it
before anything else on the list.

**The runtime coercion is gone, as claimed.** `router.cr:301` runs
`result.is_a?(String) ? result : ""` on every request. In the port that is
`forall B : IntoBody`, checked once:

```
Error: Array(Int32) does not implement Kemal::Router::IntoBody, required by `B` in `get`
```

Kemal cannot say this. It accepts the block and returns an empty body forever.
And a user can now make their own type returnable by implementing the trait,
which Kemal has no way to offer.

**`using` did what II.3 said it would.** `dsl.cr` opens with "Kemal DSL is
defined here and it's baked into global scope." The port exports the same names
and the consumer writes `using kemal/dsl`; `before_all`, `get` and `mount` are
then unqualified in `webapp.iyi`. The Sinatra feel survives without the library
reaching into the program's namespace.

**The singletons went, and nothing forced it.** `Kemal::RouteHandler::INSTANCE`
and its three neighbours are replaced by one application value. Separate
compilation permits module-level state, so this is not a rule doing the work,
but `router.cr:270` carries "may have been cleared between tests" as a live
workaround, and a clean sheet is the moment such a line stops being necessary.

**What this does not establish.** `Context` is a stub, so no HTTP, no stdlib,
and WebSocket/SSE are omitted as they add no construct the routes do not
already exercise. Registration into handlers is replaced by returning the route
table. The earlier "+4% size" figure is therefore neither confirmed nor
refuted here: the ported scope differs, and comparing 142 lines against 173
would be comparing different programs.

### II.10 Macros × compile time: **SETTLED by measurement**

The last gap in the measurement record, and the one the rest of this document
had been quietly worrying about: this design picks a fight over compile speed
(Part IV), and it inherits Crystal's macros. If expansion is expensive, the
thesis is in trouble.

**It is not.** The measurement is `bench/macro_cost.py`, and it says "macro
cost" is three different numbers, only one of which matters.

**(a) A macro that emits a template costs what writing the code costs.** N
methods generated by a `for` loop, against N methods written out, with every one
of them called in both:

| N | via macro | hand-written | ratio |
|---|---|---|---|
| 0 | 0.143 s | 0.143 s | 1.00 |
| 500 | 0.155 s | 0.154 s | 1.00 |
| 1000 | 0.169 s | 0.168 s | 1.00 |
| 2000 | 0.187 s | 0.183 s | 1.02 |
| 4000 | 0.224 s | 0.215 s | 1.05 |

The per-method delta is not monotonic and sits inside the run-to-run spread, so
what this shows is an absence: **interpreting the macro body, emitting source
and re-parsing it does not cost measurably more than parsing the same source.**

**(b) A macro that computes per item costs about 9 µs per method it emits.**
Same comparison, but the macro builds each name with string operations and takes
a branch per item. The shape a real derive macro has:

| N | via macro | hand-written | ratio | per method |
|---|---|---|---|---|
| 250 | 0.155 s | 0.152 s | 1.02 | ~14 µs |
| 1000 | 0.171 s | 0.166 s | 1.03 | ~6 µs |
| 4000 | 0.253 s | 0.218 s | 1.16 | ~9 µs |

Real, and worth the context: the same table's slope says a *method* costs about
18 µs to define and type at all. **The macro that writes the code is cheaper
than the code it writes**, which is not the relationship anyone assumes.

**(c) `macro_run` is the whole problem, and it is worse than recorded.** On a
cold cache, against the same program with the generated code written out:

| | cold build |
|---|---|
| no `macro_run` | 1.44 s |
| one `run` script | 8.86 s |
| two `run` scripts | 15.76 s |
| the same script twice | 8.02 s |

One call site costs **+7.4 s**, which is not a percentage of anything. It is a
fixed nested compile, so expressing it as a share of the build (the appendix's
21%) says more about the build it was compared against than about `macro_run`.
It is memoised per *script*, not per call site: writing `run("x.cr")` twice
costs once. But a second script costs in full, so the price is linear in the
number of distinct generators a program and its dependencies contain, and a
library that uses one imposes it on every consumer's cold build, forever.

**What this settles.** R-5's derive scoping does not need a compile-time
justification, and should stop being offered one: it earns its place through
separate compilation (a macro that can see the whole program cannot be compiled
against export metadata alone), not through speed. The thing to police is
`macro_run`, which II.2's list already proposed cutting: now with a number that
does not depend on what it was measured against.

**Two notes on method**, both learned by getting it wrong first:

- **The generated methods must be called.** The earlier attempt at this
  measurement was invalid for exactly this reason: methods nobody calls are
  never typed, so it measured a macro producing dead code.
- **The prelude has to go, and the cache with it.** Against the real prelude the
  fixed ~1.4 s tax (IV.1a) is larger than the effect and the delta is pure
  noise. The first run of (a) reported the macro version as *faster*, twice.
  And Crystal caches the compiled `run` script, so without a fresh
  `CRYSTAL_CACHE_DIR` every build after the first reports `macro_run` as free.
  The 8 s cost was visible only as an outlier in the spread.

---

## Part III: Open questions, with recommendations

### III.1 Errors: **DECIDED (Appendix B #1: yes), built except III.1.4**

Errors are ordinary union members. No `Result` wrapper, no exception hierarchy,
no new type machinery: unions already exist and already carry a type id.

```
pub def read(path : String) : String | IOError
```

#### III.1.1 What makes a member an error: **BUILT**

A prelude marker trait:

```
pub trait Error
  def message : String
end
```

A union member is an *error member* if its type implements `Error`. This needs
no new syntax and composes with II.1: `IOError` is a normal type that happens to
implement a normal trait.

**Built.** `Error` is created by the compiler rather than declared in the
prelude, because the compiler has to recognise this exact trait: `!`, `.or` and
`.or_panic` all ask whether a member implements it, and a name the prelude
happened to define could be shadowed or replaced. Nothing else about it is
special: a module writes `impl Error for IOError` like any other impl, and the
`message` requirement is checked like any other.

The type side needed nothing else. Error unions are ordinary unions, and III.1.3
is already true: dropping a branch from a `case` over one is reported as `case is
not exhaustive`. `T?` is untouched, since `Nil` does not implement `Error`.

Two things the build found, both since closed:

- **`it` was not bound in a `case` branch: now it is.** The examples in this
  section write `in IOError then log(it)`, and `case` has learned to bind the
  value it is matching. The binding is an ordinary assignment the expander
  writes into each branch, so `it` picks up the narrowing that branch already
  did: in the `IOError` branch it *is* an `IOError`, not the whole union. Three
  consequences follow from it being an assignment rather than new machinery:
  `it` outlives the `case` exactly the way a variable assigned inside an `if`
  does; a nested `case` shadows the outer one's `it`; and `it` is a name an iyi
  program should not use for anything else. A `case` over a tuple subject binds
  nothing, since there is no single value to name, and a Crystal file is
  untouched.
- **The orphan rule was vacuous for a top-level trait: now it holds.** `Error`
  has no module, and coherence is satisfied by being inside the trait's module
  *or* the type's; where the trait's module was taken to be the top level,
  everyone was inside it, so `impl Error for String` was accepted from any
  module and two of them could both write it. The fix is that **the top level
  is not a module**: a side of the rule counts only when there is a real module
  on it to be inside of. So `impl Error for T` must live in `T`'s module, and
  `impl Error for String`, where neither side belongs to anyone: is an orphan
  from everywhere and is rejected outright.

  This is not special-casing `Error`. It is the same correction for a prelude
  type, which belongs to no module either, and it leaves both real sides of the
  rule open: `std/traits` still writes `impl Cmp for Int32`, because it owns
  `Cmp`. The one place the top level still answers is a program that never
  writes a module header. A single compilation unit, with no other module an
  impl could have gone in, and nothing for the rule to say.

Two degenerate cases are rejected at compile time rather than given surprising
meanings:

- `def f : IOError`, not a union, nothing to propagate. `f()!` is an error.
- `def f : IOError | ParseError`. Every member is an error, so `!` could never
  produce a value. Also an error. If a function genuinely never succeeds, its
  return type is `NoReturn`.

#### III.1.2 The propagation operator: **BUILT**

For `expr : T | E` where `E : Error`:

- if the value is a non-error member, `expr!` evaluates to it;
- if it is an error member, `expr!` returns it from the enclosing function.

The enclosing function's return type must already include `E`. There is no
implicit widening.

**Built, and it needed no type machinery.** `expr!` expands to

```
tmp = expr
return tmp if tmp.is_a?(::Error)
tmp
```

which is a purely syntactic rewrite. `Error` is an ordinary trait, so `is_a?`
narrows `tmp` in what follows to the union's non-error members. That *is* "if
the value is a non-error member, `expr!` evaluates to it". And the rule above,
that the enclosing function must already include `E`, is not enforced
separately: it is the ordinary return-type check on the `return` the expansion
wrote. `::Error` rather than `Error`, so a module with a type of that name
cannot change what the operator means.

The operator is attached-only: `f(x)!` propagates, `f !x` still means `f(!x)`.
`!` is left out of names by III.1.7, and the one place that still explains the
naming convention is a `def` name, where there is nothing to propagate.

III.1.1's two degenerate cases are rejected, along with a third the build found:
`!` on a type with **no** error member: `Int32?`, say, since `Nil` is not an
error. Without that check it compiles and silently does nothing, which is worse
than either case the section already named.

```
pub def load(path : String) : Config | IOError | ParseError
  text = read(path)!          # read  : String | IOError
  parse(text)!                # parse : Config | ParseError
end
```

**Narrowing.** `expr!` removes *all* error members, so the result type is the
union of what remains. This falls out of unions rather than being bolted on:

```
find(id)         # => User | Admin | NotFound | DBError
find(id)!        # => User | Admin
```

That is a real payoff of choosing unions over a two-parameter `Result`, which
would have forced the success side into a single type or a nested tuple.

**Error sets are just aliases**, so wide signatures stay readable:

```
pub alias LoadError = IOError | ParseError
pub def load(path : String) : Config | LoadError
```

**Inside blocks**, `!` returns from the enclosing *method*, matching Crystal's
existing `return`-in-block semantics. `items.map { |x| parse(x)! }` therefore
abandons the whole method on the first failure. Consistent, and worth stating
because the alternative reading is defensible.

#### III.1.3 Handling: **BUILT**

Nothing new is required. Exhaustive `case`/`in` over a union already exists and
already checks totality:

```
case load(path)
in Config     then serve(it)
in IOError    then log_missing(it)
in ParseError then log_invalid(it)
end
```

Adding a new error member to `load` turns every incomplete `case` on it into a
compile error. This is the main ergonomic argument for the whole approach and it
costs nothing to build.

Two conveniences for the cases where matching is overkill:

```
port = read_port().or(8080)     # value, or a default
port = read_port().or_panic     # value, or panic. The `unwrap` of this design
```

These are compiler-known on error unions rather than ordinary trait methods.
They have to be: by II.1 an ordinary method call on `Int32 | ConfigError` would
require *both* members to implement it, which is precisely the thing being
avoided here.

**Built, and like `!` they needed no type machinery.** Both expand to the same
`is_a?(::Error)` the operator uses:

```
tmp = read_port()               tmp = read_port()
if tmp.is_a?(::Error)           if tmp.is_a?(::Error)
  8080                            ::raise tmp.message
else                            else
  tmp                             tmp
end                             end
```

The result type falls out of that `if` rather than being computed. `.or` yields
the default unioned with the non-error members: `Int32` for the example above,
and honestly `Int32 | Char` if the default is a `Char`, since nothing here
narrows what the author wrote. `.or_panic` yields the non-error members alone,
because `raise` is `NoReturn`. And `tmp.message` is only reached where `tmp` has
been narrowed to the error members: they all implement `Error`, so by II.1 their
union does too, and the call resolves without this having to know which error it
holds.

The default is evaluated only when there is an error to recover from, matching
what a reader of `||` would expect.

Three things the build settled:

- **The two degenerate operands are rejected, as they are for `!`.** With no
  error member there is nothing to recover; with every member an error, `.or`
  can only ever return its default and `.or_panic` can only ever panic. Both
  are dead code wearing a fallback's clothes.
- **`or` and `or_panic` are reserved names in iyi.** That is what
  "compiler-known" costs: they are recognised at the call site by name, so an
  iyi program cannot define or call a method of either name. Only iyi: a
  Crystal file's `.or` is an ordinary call and is untouched.
- **`or_panic` currently raises.** Panics (III.1.4) are not built, so the
  `unwrap` of this design unwinds as a Crystal exception carrying the error's
  `message`. One line changes when panics land.

#### III.1.4 Panics, and cleanup: **`defer` BUILT; panics still PROPOSED**

Panics are for bugs, not control flow: index out of range, division by zero,
a violated invariant. They unwind and are catchable **only at task boundaries**,
so a panicking fiber cannot die silently. **Not built**: the task boundary is
part of III.1.4 that Part V.5 has to specify first, and until then `.or_panic`
raises (III.1.3).

Because errors are values returned early, `begin`/`ensure` no longer covers
cleanup properly. Replace it with `defer`, which runs on normal return, on `!`
propagation, and on panic unwind:

```
pub def with_file(path : String) : String | IOError
  f = File.open(path)!
  defer f.close
  f.read_all()!
end
```

**Built, and it needed no new machinery: only a new shape.** `defer x` expands
to wrapping the rest of its scope:

```
a                       a
defer x        ⟶        begin
b                         b
                        ensure
                          x
                        end
```

`ensure` already runs on a normal exit, on a `return` through it, and on an
unwind, which is the whole of what this section asks for: `!` expands to a
`return` (III.1.2), and a panic is a raise today. So nothing was added to the
runtime. What changed is where the cleanup is *written*: `begin`/`ensure` makes
you wrap everything after the acquisition, and `defer` names the cleanup at the
acquisition, which is the entire ergonomic point.

Two questions Part V.8 left open, both answered by Go's answers:

- **Ordering is LIFO**, and it is not a rule. A second `defer` expands inside
  the first one's body, so its `ensure` is the inner one and runs first. That
  is the only order that can be right when a later resource was built from an
  earlier one.
- **A `defer` may not propagate with `!`** (Appendix B #7), rejected in the
  parser with an error that says why.

One deliberate departure from Go:

- **The scope is the block, not the function.** A `defer` in a loop body runs at
  the end of each iteration rather than piling up until the function returns,
  which is Go's best-known wart with the feature: there, a loop that opens a
  file per iteration holds every one of them until the function is done. This is
  not an extra rule either; it is what the lowering does, and it is where Zig
  and Swift landed. The cost is that a `defer` cannot outlive the block it is
  written in, which is the same restriction stated from the other side.

`defer` is a reserved word in iyi and only in iyi: a Crystal file keeps it as an
ordinary identifier.

#### III.1.5 Nil is not an error: **SETTLED**

`T?` is `T | Nil`, and `Nil` does not implement `Error`. Absence and failure stay
distinct, as they are in Crystal today: `T?` for "not there", error unions for
"tried and failed". Existing flow typing (`if x = maybe_get`) handles nil, and
`!` does not touch it.

**No nil-propagating operator** (Appendix B #4). Not "not yet": a second
propagating operator would give absence and failure the same shape, and the
pressure would then be to unify them, which ends with `Nil` implementing `Error`
and this section deleted. Flow typing is the better tool anyway: it forces the
branch to be written where the absence means something.

#### III.1.6 Error conversion: **SETTLED: none**

Rust's `?` silently converts error types through `From`. That is convenient and
it is also the mechanism by which Rust error handling became something people
write blog posts to explain: the set of errors a function returns stops being
what its signature says and becomes what trait resolution computes.

There is no implicit conversion here, and this is not a Draft 0 restriction
waiting to be relaxed (Appendix B #3). The error type must already be a member
of the caller's return union. Two things make that livable rather than
punishing:

- **Widening is not conversion.** Error sets are aliases (III.1.2), so a caller
  that admits more errors than it raises just names a wider alias. Union
  subtyping makes this free, and it covers most of what conversion is asked to
  do.
- **Real conversion is rare and should look it.** Deliberately hiding an
  `IOError` behind a `ConfigError` is a decision about a module's public
  surface. It is an ordinary function call, written where the decision is made.

### III.1.7 The conflict this design creates: **SETTLED: A**

Working through the operator surfaced a problem the earlier draft only gestured
at. It is not cosmetic.

Crystal allows `!` as the final character of a method name: `sort!`, `map!`,
`not_nil!`, `strip!`. Postfix `!` for propagation makes `arr.sort!` **genuinely
ambiguous**: it is either a call to a method named `sort!`, or a call to `sort`
whose error is propagated.

A compiler can resolve it by preferring the method name when one exists. That is
worse than the ambiguity, because it means **adding a `sort!` method to a type
silently changes the meaning of existing `arr.sort!` call sites** from "propagate
the error" to "call the mutating method". Action at a distance, of the exact kind
R-3 was introduced to eliminate.

Three ways out:

**A. Drop `!` from identifiers. Keep `?`. Recommended.**
Adopt Swift's naming convention instead: the mutating form is the plain verb,
the non-mutating form is the participle.

```
arr.sort          # mutates in place
arr.sorted        # returns a new array
arr.reverse       # mutates
arr.reversed      # returns new
```

`?` stays legal in identifiers (`empty?`, `nil?`) and never collides, because
nilable types use `?` in *type* position, not after an expression. The loss is
one naming convention; the gain is an unambiguous operator and, arguably, a
better convention: `sorted` says what it returns, `sort!` only says it is
dangerous.

**B. Keep `!` identifiers, disambiguate by lookup.** Cheapest to adopt, and
carries the silent-meaning-change footgun described above. Not recommended.

**C. Prefix keyword: `try read(path)`.** No ambiguity, reads well in isolation,
composes badly. Compare chaining:

```
read(path)!.strip.parse!          # A
(try read(path)).strip |> try     # C, roughly: parens required at every step
```

Postfix wins wherever a fallible call is part of a larger expression, which is
most of the time.

**Decided: A.** It costs one Ruby convention and buys an operator with no
special cases.

The compiler enforces this today. `!` may not end a name in a `.iyi` file; `?`
still may. The mode comes from the file extension, so a `.cr` file is unaffected
and the prelude, which is full of `sort!` and `not_nil!`: keeps compiling.

The rejection applies at **call sites as well as definitions**. Banning only
`def sort!` would leave `arr.sort!` lexing as a single name, which is exactly the
room the operator needs. Since no iyi standard library exists yet, and no sample
used such a name, this cost nothing to adopt, which is why it was worth settling
before any stdlib code was written rather than after.

Two deliberate gaps:

- **Symbol literals are exempt.** `:sort!` is still legal in a `.iyi` file. A
  symbol is a literal, not an identifier, and since no iyi method can be *named*
  `sort!`, such a symbol can only ever refer to a Crystal method. The ambiguity
  being removed lives in call syntax, not in symbols.
- **Macro expansion is exempt.** Code expanded inside a `.iyi` file is parsed
  against a `VirtualFile`, so it lexes in Crystal mode and can still generate a
  name ending in `!`. The decision is about hand-written surface syntax, so this
  is defensible; closing it would mean making `VirtualFile` carry the mode of the
  file it expands into.

#### III.1.7a What the convention costs beside Crystal's library: **SETTLED: B**

III.1.7 settled the naming convention against a library iyi was going to write
itself. `--crystal` (Part V item 12a) put iyi's programs beside a library it did
not write, and the convention now has a cost it was not priced against.

**Measured, and it is one method.** Of everything iyi's library mutates —
`<<`, `[]=`, `concat`, `shift`, `sort` — only `sort` means something different
in the two libraries. Crystal writes `!` on the mutating member of a *pair* and
plainly for everything else, so `<<` and `shift` agree by accident of both
languages naming them the same way. The pairs are where it bites, and today
there is one:

| | iyi's library | Crystal's library |
|---|---|---|
| `a.sort` | sorts `a` | returns a sorted copy |
| `a.sorted` | returns a sorted copy | does not exist |

So `a.sort` compiles under both and means the opposite thing, silently. That is
the worst shape a difference can take, and it is worth deciding now rather than
after `reverse`, `map`, `select`, `uniq` and `shuffle` arrive with the same
shape.

**Three ways out, and none of them is free:**

**A. Agree with the library you sit beside.** `sort` copies, matching Crystal,
and `sorted` goes as a duplicate. Revokes III.1.7(A)'s participle rule for this
pair and leaves iyi with no in-place sort until something names one. Costs the
convention; buys a program that means one thing.

**B. Give the mutating one a name Crystal does not use.** `sorted` stays the
copy and the in-place form is spelled out — `sort_in_place`. The convention is
amended rather than revoked: the participle rule holds except where Crystal
spells the copy with the plain verb, and there the mutating form says so. Costs
a clumsy name; buys no collision and no silence.

**C. Keep the convention as it is.** Costs the silence, which is what this
section is about.

**Decided: B.** `sorted` is the copy and `sort_in_place` is the one that
changes the receiver. The plain verb is not in this library at all, so `a.sort`
is an error under iyi's library and Crystal's meaning under `--crystal` —
different answers, neither of them silent, which is the whole point.

A rule chosen for one library is not automatically right beside two, and the
amendment is narrow: the participle rule holds, except where Crystal spells the
copy with the plain verb. There the mutating form says what it does.

**The error teaches it**, because "undefined method 'sort'" is true and useless
and the suggestion machinery cannot reach `sorted` — two edits is past its
threshold. When a name is missing and its participle is there, the compiler
says so:

```
Error: undefined method 'sort' for Array(Int32)

'sorted' is what this library calls it: `!` cannot end a name here, so the copy
takes the participle and the one that changes the receiver says so
```

Asked of the type rather than of a list, so it answers for whatever the library
grows next — `reverse`, `map`, `uniq` — and stays quiet for a name nobody
spelled that way.

#### III.1.8 Worked comparison

Crystal today:

```crystal
def load_config(path : String) : Config
  text = File.read(path)          # raises IO::Error
  Config.from_yaml(text)          # raises YAML::ParseException
end

begin
  config = load_config("app.yml")
rescue ex : IO::Error
  STDERR.puts "missing: #{ex.message}"
  exit 1
rescue ex : YAML::ParseException
  STDERR.puts "invalid: #{ex.message}"
  exit 1
end
```

iyi:

```
pub def load_config(path : String) : Config | IOError | ParseError
  text = fs.read(path)!
  Config.from_yaml(text)!
end

case load_config("app.yml")
in Config     then run(it)
in IOError    then abort("missing: #{it.message}")
in ParseError then abort("invalid: #{it.message}")
end
```

The bodies are the same length. The signature now states what can go wrong, and
the `case` is checked for totality: adding a third failure mode to
`load_config` breaks this call site at compile time instead of at runtime.

**The honest cost.** Every fallible function's signature grows, and every caller
either handles or propagates. In a deep call chain that is real friction, and it
is the friction Go is criticised for. `!` and error aliases blunt it; they do not
remove it. This remains the largest departure from Ruby feel in the design.

### III.2 Garbage collector: **SETTLED by II.5**

No longer an open question. R-4 forces a precise collector; recommendation is
precise, generational, non-moving for Draft 0.

### III.3 `method_missing`: **CUT**

It requires an open method set, which R-3 closes by construction: a type's
methods are what its module declares plus its impls, all of it readable from
export metadata. A hook that answers calls nobody declared makes that set
unknowable, which is the one thing the compilation model needs it to be.

Grounded rather than asserted: in the Crystal standard library `method_missing`
appears **once**, as the hook definition in `object.cr`. **Kemal does not use it
at all.** Meanwhile `responds_to?`. The static alternative: appears across 34
files. The dynamic escape hatch is close to unused; the static one is what
people actually reach for.

**Cut.** `macro method_missing` is rejected in a `.iyi` file, with an error that
names R-3 and points at `responds_to?`. Only there. A Crystal file keeps the
hook, and the prelude's own definition of it is untouched. Compile-time
`responds_to?` works unchanged, which the error message is entitled to claim
because it is tested.

### III.4 Concurrency: **PROPOSED; III.4.4's gate cleared by the count in III.4.7**

This is the section where the design either beats Go or does not, so it is worth
being blunt about where Go actually loses. Not goroutines: they are cheap, the
scheduler is good, and nothing here improves on them. Go loses in three places,
all of them the same shape: **the compiler is not told anything, so the failure
shows up at runtime or not at all**:

1. **`go f()` is fire-and-forget.** Nobody waits, nobody is told, and a leaked
   goroutine is invisible. There is no construct that makes "this finished"
   checkable.
2. **Data races compile.** Sharing a map across goroutines is legal Go. `-race`
   is a runtime detector that finds what a particular execution happened to do.
3. **`context.Context` is a parameter, not a property of the work.** It is
   viral, appears in nearly every signature, carries values in a
   `map[any]any`, and cancellation is cooperative. You must remember to select
   on `Done()` in every loop.

The recommendation below turns each of the three into something the compiler
knows. It is not built, and none of it is free.

#### III.4.1 Concurrency is introduced by a scope, never by a call

There is no bare spawn. A task is started inside a group, and the group's block
cannot be left until every task started in it has finished:

```
pub def fetch_both(a : String, b : String) : Tuple(String, String) | IOError
  group do |g|
    x = g.spawn { read(a) }
    y = g.spawn { read(b) }
  end!
end
```

**This is `defer` again, and that is the argument for it.** III.1.4 built a
cleanup that runs on a normal exit, on a `!` propagation, and on an unwind, by
lowering to an `ensure`. A group is that same guarantee applied to a set of
tasks: the join is deferred to the end of the scope, so there is no exit, not a
`return`, not an error, not a panic. That leaves a task running. Go's leak is
unrepresentable, and it costs no new mechanism.

The cost is real and should be stated: a task cannot outlive the scope that
started it. Work that genuinely must outlive its caller is started from a group
that lives as long as it should: usually one owned by the program's entry
point, and that group is written down rather than implied. Trio, Kotlin and
Swift all landed here; Go is the outlier.

#### III.4.2 Cancellation belongs to the group, not to a parameter

Because a group owns its children, cancellation is a property of the scope, not
an argument threaded through every signature. There is no `Context` parameter.
A group cancels its remaining children when the block leaves early, when a
child fails under the group's policy, or when an enclosing group is cancelled.

**This has a runtime dependency, and it is the same class of dependency as
II.5's precise collector: it constrains the runtime from day one rather than
being added later.** Cancellation is worthless unless it reaches a task that is
*blocked*, so every blocking primitive (channel receive, IO, sleep) has to be
cancellable. A cooperative check the author has to remember is Go's answer, and
it is the part of Go's answer people get wrong.

#### III.4.3 A task's failure is an error member

The group returns what its tasks return, and an error from a task is an ordinary
member of that union, so `!` propagates it (III.1.2) and `case` handles it
exhaustively (III.1.3). Nothing new is required, which is the whole point:
Go needed `errgroup`, a library, because `error` carries no type information a
signature could have stated.

Default policy: the first failing task cancels its siblings and the error leaves
the group. That is `errgroup`'s behaviour, typed and built in.

#### III.4.4 Data races are a compile error, and R-3 is why that is affordable

A marker trait, `Share`, decided structurally: a type is shareable if every
field is shareable and none is mutable, or if it is a synchronised type that
owns its contents: `Mutex(T)` is shareable when `T` is. A value that is not
shareable cannot be captured by a spawned block or sent over a channel.

This is Rust's `Send`/`Sync` **without** ownership or borrowing, and it is worth
being exact about what that buys and what it does not. It rules out data races,
because anything two tasks can both reach is either immutable or synchronised.
It does not rule out deadlock, and it does not rule out logical races. Aliasing
is untouched. The restriction is on the *type*, not on who points at what,
which is exactly why it needs no borrow checker.

**The interaction that makes it affordable is R-3.** A structural marker is only
computable if a type's field set is final, and open classes are what would
break that: any module could reopen a type and add a mutable field, and
shareability would no longer be a property the defining module could state.
With R-3 it is, so `Share` is computed once by the module that declares the type
and travels in its export metadata (IV.2) like any other exported fact. A
consumer checks a spawn against a marker it read from a `.iyimod`, with no
global pass. The same result IV.4 reaches for coherence, for the same reason.

**This is the decision most likely to be wrong, so here is the alternative and
why it lost.** The other sound answer without ownership is Erlang's: no sharing
at all, tasks communicate only by copying. It is simpler and it is proven. It
was rejected because copying cost is not something a systems language can hide,
and because `Mutex(T)` gives the escape hatch that Erlang has to route through a
process. The count in III.4.7 was to be the arbiter, and it came back for
`Share`: the class this section feared turned out to be empty, and clean-sheet
iyi code is 77% shareable as written.

**It came back with an obligation attached, though, and the obligation is
now met.** Every failure in that clean-sheet code was a type holding an
`Array`, which made a **shareable immutable collection** something the standard
library owed the language rather than a convenience: without it the `Mutex(T)`
escape becomes the normal case, and an escape hatch used routinely is the
definition of a failed rule. `samples/iyi/std/list.iyi` is that collection, and
`samples/iyi/immutable.iyi` exercises it.

Two things building it settled that the count could not:

- **The collection cannot derive `Share`; it has to be trusted.** `List(T)`
  holds an `Array(T)`, so structurally it fails its own marker, and the
  counting tool duly reports it as failing, which is the demonstration rather
  than an embarrassment. What makes it safe is that it *owns* the array and
  never hands it out, and ownership is exactly what this design has no way to
  express, having refused a borrow checker. So `List` joins `Mutex` as a type
  the compiler trusts rather than checks. That list should stay short, but it
  cannot be empty. Rerunning the count with `List` present: 14 of 14 sample
  types pass once a shareable collection exists, against 10 of 14 without.
- **The constructor has to copy, for the same missing reason.** A caller that
  keeps the array it passed in could otherwise mutate the list from underneath
  a task holding it. Rust says "I own this now" and pays nothing; here it costs
  one copy at the boundary. `immutable.iyi` demonstrates the failure that copy
  prevents rather than asserting it.

#### III.4.5 What this settles about module-level state

II.9 recorded that the Kemal port replaced `Kemal::RouteHandler::INSTANCE` and
its neighbours with one application value, and noted that **nothing in the
design forced it**: separate compilation permits module-level state, so it was
taste and a suspicious comment in `router.cr:270` doing the work.

III.4.4 is the rule that was missing. Module-level mutable state is not
shareable, so it is not reachable from a task; it is either immutable or it is
behind a synchronised type. The Kemal port did by hand what this makes checked,
and Part V.5's question about the interaction between concurrency and
module-level mutable state is answered: there is no interaction, because the
combination does not compile.

#### III.4.6 What carries over from Crystal, and what does not

- **`Channel(T)` carries over**, with `T : Share`.
- **`select` carries over** unchanged.
- **`Fiber` does not carry over as a user-facing primitive.** It is how a task
  is implemented. Exposing a raw spawn puts III.4.1's leak straight back.
- **Parallelism is not free of the rest of the design.** IV.1d already measured
  that only the forking thread survives a `fork`, which is why the build daemon
  is single-threaded. A multi-threaded runtime and a fork-based daemon are in
  tension, and that is a measured fact rather than a prediction.

#### III.4.7 What `Share` costs: **COUNTED**

Every other rule in this document that costs users something was decided by
counting, and `Share` was not to be built before the same was done to it. The
count is `bench/share_count.cr`, which makes the marker mechanical: a field is
**mutable** if it is assigned anywhere other than the constructor, or if an
accessor macro generates a setter for it; a type fails if any field is mutable
or any field's type fails.

| | `samples/iyi` | the compiler's own source |
|---|---|---|
| types that can hold state | 13 | 483 |
| directly mutable | 0 (0%) | 118 (24.4%) |
| fail once field types propagate | 3 (23.1%) | 297 (61.5%) |
| …only because a collection is mutable | 3 (23.1%) | 2 (0.4%) |
| …only because of a generated setter | 0 | 42 (8.7%) |
| **pass `Share`** | **10 (76.9%)** | **186 (38.5%)** |
| pass given a shareable immutable collection | 13 (**100%**) | 188 (38.9%) |
| hold class variables (III.4.5) | 0 | 3 (0.6%) |

**The class this section told itself to fear is empty.** "Immutable in practice
but holds a mutable field for one initialisation" describes no type here,
because a construction-only write is not a mutation, and letting it pass is
sound rather than lenient: a value is not reachable from another task until it
exists, so there is no second party to observe the write. Zero of the sample
types are directly mutable at all. The escape hatch that would have signalled a
failed rule is not needed for this reason.

**Nor for the reason next most likely.** Only 8.7% of the compiler's types fail
solely because of a generated setter, so "move the field into the constructor"
is not a fix anyone would be applying constantly either.

**What the count actually found is that the two corpora disagree, and why.**
Clean-sheet iyi code is 77% shareable as written and **100% shareable given one
missing piece**: every failure in it is a type holding an `Array`. The compiler
is 38.5% shareable and stays there, because its failures are not collections but
its own mutable object graph: `MainVisitor` with 35 mutated fields, `Compiler`
with 34, `Formatter` with 32, `Parser` with 30.

So `Share` is not a rule that fails; it is a rule that **prices a style**. It
costs nothing for code written the way the ported samples are written, and it is
close to unpayable as a retrofit onto a program built as a mutable workspace.

**The compiler is the control case, and it agrees with something already
measured the hard way.** IV.1d records that the build server could not be made
concurrent by adding fibers. The obvious fiber-per-connection version deadlocked
and died, and the daemon had to fork instead. That took two attempts and a
debugging session to discover. `Share` says the same thing about the same code
statically, before anything runs. A marker whose verdict matches a fact that
previously cost a failed implementation to learn is measuring something real,
not merely being restrictive.

**Verdict: keep `Share` (Appendix B #9), with one dependency.** The stdlib owes
the language a **shareable immutable collection**, and it is not optional,
without it a quarter of clean-sheet iyi types fail the marker for a reason that
has nothing to do with how they were written, and the only workaround is
`Mutex(Array(T))` everywhere, which is exactly the routinely-used escape hatch
that would mean the rule had failed. Rust answers this with an immutable borrow,
which is not available here; Erlang answers it with immutable collections by
default, which is. This is the same shape of dependency as II.5's precise
collector: a language rule that constrains the library from day one.

**Limits.** The tool reads syntax, not types: field types are matched on the
last segment of their path, so a name used in two namespaces is conflated, and
`Mutex(T)` is counted as mutable rather than as the synchronised escape it is
meant to be, which makes these numbers a lower bound on what passes. It also
cannot answer the second half of the original question, "how many of those are
reached from something that would plausibly be spawned", for the compiler, which
spawns nothing. For the samples it can: the three failures are `Nums`, `Words`
and the Kemal router's route table, and the router is precisely the thing a
server would share across tasks.

### III.5 Module initialisation: **PROPOSED; rules 1, 2 and 4 BUILT**

II.9 left this open with a concrete case: Kemal registers routes as a side
effect of top-level calls, which is legal, and the ordering guarantees across a
module DAG were never stated. Go's `init()` is the reference, and it is a
reference for what to avoid: importing a package runs code, order within a
package follows *file name*, an `init` that fails can only panic, and
`import _ "github.com/lib/pq"` exists as a language-level hack for a side effect
the compiler cannot see.

**III.4.5 already shrank the question.** Module-level mutable state is not
shareable, so it is either immutable or behind a synchronised type. What a
module initialiser mostly does, then, is compute constants, and the order in
which constants are computed is a much smaller question than the order in which
arbitrary side effects run.

**1. A module initialises after every module it imports.** R-1 makes `import` a
DAG, so this is a partial order with no cycles to resolve, and it needs no
analysis beyond the edges already in the artifact (IV.2).

R-1's DAG was a claim about the language and not about the compiler: a cycle
compiled. It was refused only where a module needed one of the other's names at
*declaration* time, because the second module of a pair is loaded from inside
the first's `import`, before the first's own body has been seen. Anything
resolving later got through. A cycle whose only crossing use sat inside a
`def` built and ran, and so did one that closed through the entry module, whose
initialiser is last by construction and so cannot precede a module that imports
it. A cycle is now an error naming the cycle, which is the same accident rule 1
stopped relying on above, and the one IV.4's coherence proof rests on.

**2. Between independent modules the order is *unobservable*, not merely
unspecified.** This is the rule worth having, and the compilation model already
pays for it: a module can only name what it imports (R-1), can only reach what
that module exports (R-2), and cannot reopen anything (R-3). So a module's
initialiser has nothing of an unrelated module to look at, and no program can
tell which of two independent modules went first. The tiebreak therefore does
not need specifying. There is no experiment that could detect it.

A rule nobody can observe is a rule that rots, so **debug builds shuffle the
order of independent modules. Built.** This is Go's own trick: map iteration was
randomised precisely to stop programs depending on an order the specification
never promised, and Go went further there than in its own `init`, which is
ordered by file name and therefore depends on one.

The compiler walks the DAG the way Kahn's algorithm does and picks at random
among the modules whose imports have all been placed, so no two debug builds of
a program need hand out the same order. Release builds keep the load order, so
what ships is reproducible; `IYI_INIT_SEED` pins a debug one, for a program
that fails under an order and has to be looked at twice.

**What it cost, measured.** Every sample was built under eight orders and all
eight produced identical output. The result is thinner than it sounds: of the
samples, only `modules.iyi` imports two modules that are independent of each
other, and their initialisers are declarations with nothing to observe. What it
does establish is that the reordering is safe. The tree the compiler hands the
rest of the pipeline is still one it types and generates code for, and that no
sample was quietly relying on load order. Evidence for what the rule *catches*
needs a program whose modules do work at initialisation, and there is not one
yet; III.4.5 is the reason to expect there never will be many, since
module-level mutable state is not shareable and an initialiser mostly computes
constants.

**Rule 1 was accidental, and now is not. Built.** `import` used to expand the
imported file *in place*, splicing its nodes where the directive stood, so a
module's top-level code ran at its import site and the order was textual. It
happened to agree with rule 1. An `import` usually precedes the body that
needs it, but only usually. An `import` written below other top-level code
disagreed, and the disagreement printed:

```
module probe/main
puts "before"     # ran first, before `probe/a` had initialised at all
import probe/a
puts "after"
```

`import` now leaves a `Nop` where it is written and hands the loaded file to
`Program#iyi_module_inits`; `top_level_semantic` splices that list into the
tree, after the prelude and ahead of the program's own code. Loading is
depth-first and a module is appended only once the modules it imports already
are, so the list is in topological order and rule 1 holds by construction. The
entry file is not in the list, which is rule 1 applied to it: it imports
everything, so it initialises last. `samples/iyi/init_order.iyi` is the case
above, printing in the order the DAG fixes.

This is the separation rule 2's shuffle was waiting for. The order is now a
list the compiler owns rather than a property of where the text sits, and it
is the same separation Part IV needs, since an artifact cannot store an
initialiser it never separated. What is still missing for Part IV is the step
after: the list holds a module's *nodes*, not a callable initialiser in the
module's own object code.

**3. There is no `init()`. A module's top-level expressions are its
initialiser, in source order.** Go needs two mechanisms: dependency-ordered
package variables *and* `init` functions, and orders the second by file name,
which means adding a file can change behaviour. That failure has nowhere to live
here: `import a/b` resolves to `a/b.iyi`, one source file per module, so source
order is already total.

**4. Initialisation may not fail. Built.** If it can fail it is not
initialisation, it is work, and work belongs in a function the program calls
when it is ready to handle the failure. This is checkable rather than
aspirational, because errors are types: a top-level expression may not
propagate.

It turned out to be enforced already, but by accident: `!` expands to a
`return` (III.1.2), so it hit Crystal's rule about returning from the top level
and reported `can't return from top level`, which describes the expansion rather
than the rule. The propagating `return` is now marked, and the message names
III.5. Reported where the check already was rather than in the parser, because
the parser cannot see through a macro to know whether the expansion will land
inside a `def`.

**5. No import for side effects.** `import` brings a module's declarations; it
is not a way to run its registrations. The driver-registration pattern Go writes
as `import _` becomes an ordinary call the program makes, where a reader can see
it. This is the rule that costs the most: it is more code, and it removes a
convenience real programs use. The Kemal port is the evidence that the trade is
survivable: II.9 records that its singletons were replaced by one application
value and its routes returned as a table rather than registered into a global,
and that **nothing in the design forced it at the time**. This is the rule that
would have.

**The alternative that lost: lazy initialisation.** Module-level values could be
computed on first use, which removes ordering as a question entirely: Swift's
answer. It was rejected because it moves cycles from a compile-time
impossibility to a runtime failure, and because a guard on every access to a
module-level constant is a cost paid by every program to solve a problem that
R-1's DAG already prevents.

**Status.** Rule 3 is a description of what the compilation model already
forces and needed writing down more than building. Rules 1, 2 and 4 are built,
and so is the cycle refusal R-1 asserted and the compiler did not perform.
Rule 5 is the one with a real cost and no measurement behind it yet, and it is
the one to be suspicious of.

---

## Part IV: `.iyimod`, the module artifact

Everything in R-1 rests on this file. If it is wrong, separate compilation does
not work and the 95% prelude tax stays.

**The contract:** to compile module B which imports A, the compiler reads A's
`.iyimod` and never opens A's source. The prelude stops being 200k lines to
re-analyse and becomes a file to read.

### IV.1 Shape

One file per module, sections in a single container. Single-file because
replacement must be atomic. A half-written artifact that a later build treats
as valid is the worst failure mode a build cache has.

| Section | Contents |
|---|---|
| Header | magic, format version, compiler version, target triple, build flags |
| Hashes | interface / implementation / private (see IV.3) |
| Imports | DAG edges, each with the interface hash it was compiled against |
| Requires | under `--crystal`, the library files the module required (Part V item 12d) |
| Exports | types, signatures, traits, impls, constants |
| Macro bodies | serialised AST for exported macros and derives |
| Mono bodies | the bodies a consumer has to compile: source text, not IR yet |
| Initialiser | the module's own top-level code, as source text (IV.1g) |
| Object code | machine code for this module's own definitions |

Binary, for read speed. A `iyi mod dump` producing text is required, not
optional. An opaque cache format is one nobody can debug.

**The container is built, `Exports` carries the declarations, and a build can
be compiled against them.** `src/compiler/crystal/iyimod.cr` writes and reads
magic, format version, a section table and the `Header`, `Imports` and
`Exports` sections; `crystal build --emit-iyimod DIR` writes one per imported
module, `crystal mod dump FILE` prints it, and `crystal build --use-iyimod DIR`
compiles an `import` from the artifact instead of the module's source: see
IV.1f. `Exports` carries `pub def` signatures, exported type declarations with
their parameters, associated types and methods, and impl records with what they
answer, **each type's own fields, in the order they were declared**, and **the
defs and types a module does not export**, which travel unreachable because a
body that travels calls them (IV.1g). Layout
templates and type descriptors are not in it. Those are what codegen needs
rather than what the front end needs. **`MonoBodies` carries the bodies a
consumer has to compile itself, `Initialiser` the module's own top-level code,
`TypeIds` the types its object code numbers, `Constants` the names that code
reads, and `MacroBodies` the macros a travelling body expands** (IV.1g). Every
section the `Section` enum names is written now.

`Requires` is the newest and belongs to the same rule as `TypeIds`: a module
built with `--crystal` refers to Crystal's types by name, and only a program
that required the same library has those names to define. The header also
records *which* library a module was built against, and importing across the two
is refused — Part V item 12d is why both are there.

`MacroBodies` was the last one, and what put it there was a body that travels:
the consumer compiles a block-taking `run`, `run` writes `twice(n)`, and `twice`
is a macro of the module `run` came from. A macro has no machine code to arrive
as and no `pub` to be exported with, so it travels as source text on the two
things that can declare one. The module and a type, and arrives ahead of the
bodies that call it, because a macro is read before it is called. All of them
rather than a chosen few: none is reachable from outside, so they are there for
the bodies to expand against, exactly as the unexported defs beside them are
there to typecheck against.

Fields were meant to be in that second list and are not, which is worth saying
plainly because the reason is a bug rather than a change of mind. A consumer
does not need a field to typecheck a call, and it does need one to
**allocate** the receiver. Without them `pub struct List(T)` read back as a
struct with no fields, and the consumer generated a `List(Int32)::new` that
allocated nothing while the module's own object code wrote to `@items`. That is
memory corruption, standing behind a link error that happened to fire first.
The line between "what the front end needs" and "what codegen needs" is not
the line between what travels and what does not.

**`ObjectCode` now carries a module's own machine code**: see IV.1g for what
that turned out to mean, and for everything that turned out to be standing
behind it.

`std/list` reads back as:

```
imports
  std/enumerable
usings
  std/enumerable::{Enumerable}
exports
  struct List(T)
    def appended(item : T) : List(T)
    def at(index : Int32) : T
    def concatenated(other : List(T)) : List(T)
    def empty? : Bool
    def initialize(items : Array(T))
    def size : Int32
  impl Std::Enumerable::Enumerable for Std::List::List(T) forall T
    type Elem = T
    def each(& : (T -> Nil)) : Nil
```

**A signature is stored as the annotation the author wrote**, not as a
rendering of the inferred `Crystal::Type`. R-2 is what makes that sound,
everything exported carries full parameter and return types, so there is
nothing to infer, and it avoids inventing a second grammar for this file when
the consumer already has a parser for the first one. Where no annotation was
written it is recorded as absent rather than filled in: a constructor's result
is its type and nobody writes it down, and `def initialize(items : Array(T))`
above is that case rather than a missing one.

**Impl records had to be collected as they are declared**, not recovered
afterwards. An impl leaves no record of its own. It works by making the target
type include the trait, and once analysis is over that is indistinguishable
from any other ancestor. R-3 is what makes the collected set complete: an impl
may only live in the trait's module or the type's, so `std/traits` carries
`impl Cmp for Int32` and no third module could have carried it instead.

Because the section is still partial, **`mod dump` says so on every dump**. A
reader cannot tell an absent field list from an empty one, and taking a partial
surface for a complete one is the mistake this file cannot afford.

Two properties were built in from the start rather than retrofitted, because
neither can be added later without a format break. **Replacement is atomic**: a
sibling temporary is renamed over the target, so a reader sees the old file or
the new one and never a half-written one. The worst failure a cache has is the
one that looks fine. **Unknown sections are skipped**, which is what the table
is for: a consumer wanting `Exports` must not have to page in `ObjectCode` to
reach it, and forward compatibility falls out of the same property. Both are
covered in `spec/compiler/iyimod_spec.cr` rather than asserted here.

**Target, and what became of it:** reading the prelude's `.iyimod` was to cost
single-digit milliseconds against the **~1.0 s** its top-level analysis cost
when that was written. Item 3 took the analysis to 0.010 s by deleting 107,719
lines of prelude, and IV.1a's re-measurement then took the target away: reading
an artifact is parsing text and running the top-level pass over it, which is
what reading the source was. The prelude is not made into an artifact, and the
reason is a measurement rather than a preference.

### IV.1f Reading the artifact instead of the source

`crystal build --use-iyimod DIR` resolves `import a/b` to `DIR/a/b.iyimod`
where it would have opened `a/b.iyi`, and **does not open the source**. Not
"prefers the artifact": the file need not exist. Seven of the eight samples
compile with the imported module's source deleted, `immutable.iyi` among them,
a generic type, a 575-line trait with an associated type, and a generic impl
that answers it.

**The artifact is rendered back to declarations and those are parsed.**
`crystal mod dump --declarations` prints exactly the text the compiler reads,
which for `std/list` is its `module`, its `import`, its `using`, `pub struct
List(T)` with six headers and no bodies, and the impl with its `type Elem = T`.
Text rather than a serialised AST because the signatures already are text: the
parser that read the module is the one that should read its declarations back,
and a second grammar for this file would be a second thing to keep correct. A
diagnostic that points into a `.iyimod` names a line of that output, which is
why it is printable.

**A call to a def from an artifact is typed from its return annotation.** There
is no body to visit and there is not meant to be one: R-2 guarantees the
annotation is written, and IV.2 keeps the body out. That is the whole of what
the front end gets, and it is also the boundary: a module read this way
contributes an **initialiser only because one now travels** in a section of its
own (IV.1g). Its top-level code is not a declaration, so `Exports` was never
going to hold it. What is still left behind is code inside a *type* body, and a
build that would generate code against a module with one is refused rather than
given a program that runs with the setup missing. IV.1a said the same thing
from the other direction,
codegen needs the prelude's tree for reasons caching analysis does not remove.

**Three things had to travel that the format did not carry**, each found by a
real module rather than by reading:

1. **The rest of the `def` line.** The block annotation, `forall`, `abstract`,
   the receiver, and a parameter kept whole so its default value survives.
   `Enumerable`'s `map(& : Elem -> U) : Array(U) forall U` needs three of the
   five in one signature.
2. **An impl's own methods.** They are the impl's, not the target's:
   `impl Cmp for Int32` puts `cmp` on a prelude type this module does not
   export, so recording it against the target loses it. This is also why
   `each` appears under the impl in the dump above and not under `List`.
3. **The module's `using` directives.** A signature is stored as the annotation
   the author wrote, and an annotation is written in a context: `pub def
   handle(ctx : Context)` resolves `Context` through a `using` further up the
   file. `std/list` never noticed, because its signatures name only its own
   types; the Kemal port's first exported signature does not. Carrying the
   annotation without what resolves it was carrying half of it.

**Measured**, best of 7 runs, `immutable.iyi`, top-level pass only:

| | top level |
|---|---|
| prelude alone (empty program) | 0.886 s |
| + `std` from source (722 lines) | 0.901 s |
| + `std` from its `.iyimod` | 0.884 s |

The 722 lines cost 15.5 ms from source and nothing measurable from their
artifacts, so on the modules it is applied to the mechanism delivers what it
promises. It is also invisible, because 0.886 s of prelude is next to it. That
is the 95% prelude tax stated as a measurement rather than as an argument, and
it is why item 3 of the 0.1.0 list. A prelude small enough to be one of these
modules: is what decides the schedule and not this section.

### IV.1g `ObjectCode`. The module's own machine code

**The unit is the object file, because codegen already splits that way.** Every
method is emitted into the LLVM module of the type that owns it, one object
file per type, and the split is a **partition**: on the Kemal port, 23 units
and no symbol defined by two of them. So "this module's own definitions" is a
set of whole object files rather than a filter inside one, and carrying them is
copying bytes rather than teaching codegen a second way to lay out a program.

A module's units are the module type itself, where its own `pub def`s are
owned: plus every non-generic type declared under it, recursively.
`kemal/router` owns five (`Router`, its three nested records, `Context`) and
`kemal/dsl` one. `app/greeter`'s artifact comes out at 3,177 bytes, of which
2,736 are an ELF object defining `polite`.

**A generic type's instantiations are deliberately not among them**, and
carrying them was tried first because it looks obviously right. `--emit-iyimod`
runs inside an ordinary build, so the producer's instantiations *are* the
consumer's, and `List(Int32)`'s unit appeared to belong in `std/list`'s
artifact. It does not: `List(Int32)::new` is **synthesized** from `initialize`
rather than read from the artifact, so the consumer generates its own copy and
the link fails on a duplicate symbol. The deeper reason is that the appearance
depends on the two builds being one build, which is the arrangement this file
exists to end, which instantiations exist is decided by whoever writes
`List(Int32)`. They are `MonoBodies`' business (IV.2).

**Two properties had to hold for this to be possible at all, and both were
checked rather than assumed.**

*Symbol names carry nothing build-specific.* A method's symbol is its owner
type, its name, its argument types and its return type, escaped: no counter,
no path, no hash of the build. Two builds that agree on the types agree on the
name, which is what lets one build's object file be linked by another's.

*A type id is already an external reference.* Type ids are integers assigned by
a global pass, so a module compiled alone cannot know its own. The obvious
reading is that separate compilation is therefore impossible without a format
that carries them. It is wrong: the router's unit lists `Kemal::Router::Router:
type_id` among its **undefined** symbols. The number is resolved by the linker
from a definition in `_main`, not baked into the code. Whoever assigns the ids
defines the symbols, and everything else relocates against them.

**And a program built from an artifact runs.** `--use-iyimod` no longer implies
`--no-codegen`. A def read from a `.iyimod` is *declared* rather than defined,
the same shape a `lib` function takes, and for the same reason: the body is
somebody else's. The artifact's object files are unpacked into the build's
own output directory, and the linker joins the two.

```
crystal build --emit-iyimod mods -o from-source main.iyi   # 42
rm app/twice.iyi
crystal build --use-iyimod  mods -o from-artifact main.iyi # 42
```

That is the first thing in this document that produces a program rather than a
typecheck, and `spec/compiler/iyimod_spec.cr` runs both binaries and compares
what they print.

**Two bugs it found, both of the kind that would have linked and lied.**

*A def read from an artifact must not be inlined.* Its body is absent, which
reads to codegen as the simplest possible body: `Nop` is the first case
`try_inline_call` matches, so a call to the module's code was being replaced
by nothing at all. It did not link, because an absent body also has no type;
had it, the program would have run and computed the wrong answer.

*`type?` is not `@type`.* `ASTNode#type?` answers `@type || freeze_type`, so a
def whose return annotation has been resolved reads as typed while `@type` is
still nil, and `Def#mangled_name` reads `@type`. Setting the type only `unless
type?` therefore left the front end correct and handed codegen a symbol with no
return type on the end, which is not the symbol the artifact defines. The
linker caught it. Nothing else would have.

**Three more things had to travel, each found by the linker on `modules.iyi`**,
build it, delete `app/greeter.iyi` and `app/formal.iyi`, build again from the
artifacts. Four undefined symbols, then two, then none.

*A method inlined away has no symbol to carry.* `title` returns a string
literal, so every call site inlined it and the producing build emitted no
function, but the consumer has no body to inline and calls it by name. Two of
the four. A build writing an artifact therefore stops inlining the methods that
artifact describes: code somebody else will call by name has to be defined. The
check asks the *instance* type, because a module-level `def` is owned by the
module's metaclass, which is most of what a module exports.

*A module carries private copies of what it calls.* `String::interpolation
<String, String, String>` is in the prelude's `String` unit, and the consumer's
own `String` unit holds whatever *the consumer* instantiated, which need not
include it. Carrying the producer's whole `String` unit is not an option: it
would define symbols the consumer also defines, and the linker refuses that,
and sub-unit granularity cannot be had by copying bytes. So the callee is
copied into the module's own unit with **internal linkage**, transitively.

The alternative was `linkonce_odr` on Crystal's functions, so duplicates merge
at link. What C++ and Rust do with template instantiations, and sound here
because the header already asserts the same compiler, triple and flags. It was
rejected for reach: it changes codegen for **every** build in this fork to fix
a problem that belongs to artifacts. The price of the private copy is
duplication. Each module carries its own `String::interpolation`, and one
consequence worth knowing, that a proc taken to such a function has a different
address on each side of the boundary. A C function is never copied: it is a
declaration with no body whoever asks, and internal linkage on a declaration is
invalid IR, which `write` and `exit` reach from the prelude's own `puts`.

*And a program that links an artifact defines every type id.* The copy above
brought its own undefined symbol: `String:type_id`, which the same program
built from source resolves without trouble. Type-id globals are emitted on
demand, so they exist only where *this* program wanted one, and a build cannot
see from an object file which ones that object needs. It therefore defines them
all. An `i32` per type is not a cost worth a cleverer answer, and the artifact
must keep carrying a reference rather than a value: two programs number their
types differently.

**Some bodies have to travel, and `MonoBodies` is which ones.** A module's
machine code answers for a method the producer could compile. Two kinds it
cannot, and they are the two exceptions IV.2 already names:

- **A generic type's methods.** `List(Int32)#size` exists once per
  instantiation and the instantiations belong to whoever writes them. A
  consumer that writes `List(Float64)` needs a method the producer never made.
- **A trait's default methods.** `to_a` is stencilled onto the implementing
  type, and the implementing type may be the *consumer's*. There is no name
  `Samples::Collections::Nums@Std::Enumerable::Enumerable#to_a` could have been
  compiled under in the producing build, because `Nums` did not exist in it.

Both ship their bodies as **source text**, rendered back into the declarations
a consumer parses. IV.1's table asks for serialised typed IR, which is faster
and is a second grammar to keep correct; text is the choice `Exports` already
made, for the reason IV.1f gives, and IR can replace it without changing what
travels.

**An impl is the third case, and it is the one that fixes the rule.** An impl
defines methods *on its target*, so they are emitted into the target's unit,
and the artifact carries a unit only for a non-generic type the module
declares. `impl Cmp for Int32` in `std/traits` therefore puts `cmp` in the
*prelude's* `Int32` unit, which no artifact can carry without defining every
other `Int32` method the consumer also defines. So an impl's bodies travel
**unless** its target is a non-generic type this module declares, and the
"unless" is not caution. Shipping them always makes the consumer compile a
method the artifact's object code already defines, which is a duplicate symbol.

**Two duplicates found by that boundary, both about a method nobody wrote.**
`Greeter::new` is synthesized from `initialize` rather than read from an
artifact, so nothing marked it as coming from one: the producer emitted it into
`Greeter`'s unit and the consumer synthesized its own. The types an artifact
declares are now marked, and codegen declares their methods rather than
defining any. The artifact is authoritative for a type whose object code it
carries. The mark is on the declared type and not on its instantiations, which
is the distinction that makes it work: `List(T)` is the artifact's, and
`List(Int32)` is compiled here like any other type.

**And the artifact's declarations join the tree.** They were being parsed,
accepted and thrown away, which is enough for name lookup and no more: an
instance variable's type is settled by `TypeDeclarationVisitor`, a separate
pass over the tree. So `@items : Array(T)` read from an artifact was a
declaration the compiler had parsed, accepted, and could not see: "can't infer
the type of instance variable `@items`" on the line that assigns it. A file of
declarations still contributes no initialiser, because there is nothing in it
to run; that is a property of the content, not of how it is plumbed.

**And the module's initialiser travels too.** It is the one part of a module
that is neither a declaration nor the body of one, and III.5 is entirely about
it: it has to *run*, in DAG order, before anything that imports the module.
Nothing else can produce it. A consumer that never opens the source cannot
invent the module's constants, its proc literals, or the statements between
them. So it goes in a section of its own, as source text, rendered back inside
the module's own namespace; the consumer parses it and it takes its place in
the import order like any module read from source, because that order is over
modules and not over text. `init_order.iyi`, whose whole subject is that
ordering, and one of whose `import`s sits below a statement of its own: prints
the same five lines in the same order from its artifacts as from source.

The section is not in IV.1's table. The table had a row for declarations and a
row for bodies of declarations and no row for this, which is the gap rather
than an addition: a module is not only what it declares.

**What still does not travel is code inside a *type* body**. A class
variable's initialiser, which belongs to the type rather than to the module's
top level. `has_initialiser` now means exactly that, and a build that would
generate code against such a module is refused, naming the module and why. The
distinction is worth the precision: the flag used to mean "has anything to run"
and refused three modules that were fine.

**Two things the samples do not have, found by writing an example that did.**
A module exporting a type with a class method and a field is an ordinary shape
and no sample happens to be one, so both of these survived every sweep above.

*A class method lives on the metaclass.* `def self.zero` is stored there rather
than on the type, so walking a type's own defs dropped every class method a
module exported: `Counter.zero` was an undefined method on the far side of an
artifact that looked complete. Both sides now travel, told apart by the
signature's receiver, which is a thing the format already carried and nothing
had used. Two methods are kept out on the way: `new`, which is synthesized from
`initialize` and which the consumer therefore makes for itself, and anything
whose body is a `Primitive`: `allocate` is put on every metaclass by the
compiler, and describing it as part of a module's surface would be describing
this compiler instead.

*A field with a bodyless `initialize` reads as nilable.* The artifact's
`initialize` is a header, so nothing in it assigns `@n`, so the check that
looks for an `initialize` leaving an instance variable unassigned refused the
module outright. It is treated like a macro def now: assumed to assign
everything, because the build that wrote the artifact already checked that the
real one does.

**Where that leaves the eight samples.** Five import a module at all; the other
three (`hello`, `generics`, `errors`) are single files and exercise nothing
here.

| sample | from its artifacts, source deleted |
|---|---|
| `modules` | **builds, links, runs, identical output** |
| `immutable` | **the same**: a generic type, a 575-line trait, a generic impl |
| `collections` | **the same**: the consumer's own type implementing the trait |
| `init_order` | **the same**, including III.5's ordering, line for line |
| `webapp` | **the same**: the Kemal port, blocks and all |

**All five run.** `webapp`. The Kemal port: used to stop at `--emit-iyimod`, because
R-2 refuses an exported `def` that does not describe its block and
`Router#namespace` took `&` with `with sub_router yield` inside it. The port now
passes the sub-router as a block parameter: `& : Router -> Nil`, and its caller
writes `|admin|`. That is the rule costing something visible and being paid
rather than avoided. A `namespace` that keeps `with` would have to stay
unexported, which is a worse trade for a DSL than one extra parameter. Giving
`with … yield` a notation stays open (IV.2); this is what an exported
block-taking method looks like until it has one.

**And behind that one were two more, both the same shape as everything else
here: a module's object code referring to something the artifact does not
carry.** Neither is about blocks.

*A module's constants*: **fixed.** `kemal/dsl` writes `APP = Router.new`, and
its unit calls through `Kemal::Dsl::APP` from every exported `get`, `post` and
`mount`. The initialiser travels as source text and the consumer runs it, but
the *symbol* did not: a constant is typed and initialised where it is **read**,
the only reader on this side is machine code the consumer did not compile, and
nothing defined it. Six undefined references on a module of forty lines.

The names now travel in a `Constants` section and the consumer reads them on the
module's behalf. The paths are appended to the declarations before they are
analysed. Marking them used was tried first and is not enough: without a read
the constant's value has no type, and the next pass says it cannot infer one.
Reading costs one load in the consuming program and puts the constant back on
the ordinary path, where initialisation stays lazy and stays in III.5's order,
because reading a constant is what initialises it.

*A module's proc literals*: **fixed, and not by carrying a list.** `add_route`
builds `->(ctx : Context) { block.call(ctx).into_body }`, and the symbol for it
is named after the file and line it was written on,
`~procProc(Context, String)@kemal/router.iyi:211`. A proc literal is emitted
into `_main`, so the router's unit referred to a definition in a module the
artifact does not carry; and a name with a source location in it is one the
consumer could not have reproduced either, since its declarations arrive under
another filename. So the definition goes where the code that made it goes:
while a unit that will travel is being emitted, its proc literals are emitted
into that unit, private to it. Same answer, and the same reason, as the callees
the closure already copies.

**And behind that, the rule this section has been circling.** With the procs in
place the port fails twice more, and both are one thing: a method that takes a
block is instantiated *with the caller's block inlined into it*,
`Kemal::Dsl::before_all<&Proc(Context, Nil)>`. The producing build made those
instantiations because `webapp.iyi` called them, so they are in the unit the
artifact carries; the consuming build makes its own, because the block is its
own code. One is a duplicate symbol and the other: `Router#namespace` with a
block the producer never wrote: is an undefined one, and they are the same
mistake seen from either side.

So a block-taking method belongs with a generic type's methods and a trait's
defaults in IV.2's list: **its body has to travel and its machine code must
not**. `iyi_bodies_travel?` asked that question of a *type*, and this is the
case that makes it a question about a `def` as well: whatever the def is
written on, a module's own `pub def` and a method of an exported class alike.
**Built.** The producer emits each instantiation into the unit that called it,
private to that unit, so no symbol for one leaves the artifact; the body travels
in `MonoBodies`; and the consumer compiles its own from the block it wrote.

**And behind that one, three more**: each of them invisible until a consumer
started compiling a body against a type it had only ever imported.

*The aliases a declaration names*: **carried.** `Router` writes `alias Handler
= Context -> String`, and the private records that travel take a `handler :
Handler`. The text travels, so the name has to resolve on the far side, and it
did not: an alias has neither a layout nor an id, which is the reason it was
left out, and the reason it travels anyway is the other one a declaration does,
something else's text names it. It arrives as what it resolved to rather than as
what was written, on the same grounds as a field's type: the name resolved where
the module was read from source, and this file is read somewhere else.

*Whose machine code a def is*: **a question about the def, and not only about
the type.** Codegen asked whether `self_type` came from an artifact and, if it
did, emitted a signature with nothing under it. That is right for every method
that arrived as a header and wrong for the two things that did not: the def
whose body travelled, and a proc literal written inside that body. `add_route`
builds one, and its `self` is the artifact's type while its code has never been
anywhere but here.

*A field's offset is its position in the list*: **so the list travels in
declaration order.** The fields were sorted by name, for a good reason: a hash's
order is not a fact about a type, and an artifact that changed between two
identical builds would defeat IV.3. But the order *is* the layout, and sorting
it was wrong in a way nothing could see for as long as everything a consumer
compiled kept its hands off an imported type's fields. A travelled body is the
first thing that does not: the consumer's `add_route` wrote `@routes` at the
offset the module's own code reads `@filters` from. Every route went somewhere
nobody looked: `app.routes` came back empty, and then the program segfaulted.
Declaration order is no less deterministic than sorted order, because
`instance_vars` is insertion-ordered and the insertions are the declarations.

**And one the samples do not reach, found by asking what the rule leaves open:
the block-taking def a module does not export.** `pub def run` takes a block, so
the consumer compiles it, and `run` calls a `helper` the module kept to itself,
or a method on a type it never exported. Being unreachable changes nothing about
who the caller is, so those bodies have to travel too, and a header for one
would promise a symbol nobody emitted: the producer makes no machine code for a
block-taking def wherever it is written. They travel in a list of their own and
are rendered without `pub`, which is what keeps R-2b true. A consumer that
names one is refused with the message it gets from source, having had the
declaration all along. The same sentence covers both namespaces: the method on
a carried type, and the def at the module's own top level.

Both belong to IV.1g's rule rather than beside it: "a module's own code is the
object files named after the types it declares" is what makes them missing, and
what makes the type ids above missing was the same sentence.

**And one thing none of the five reaches, which was expected to be a missing
object file and turned out to be a missing number.** A module's body
instantiates prelude generics at its own types. The router's builds an
`Array(Kemal::Router::Router::RouteDefinition)`, and that unit is named after
`Array`, not after anything the module declares, so the ownership rule does not
catch it. It does not have to: the closure above already copies a callee the
emitting module does not own into the module's own unit, and a generic's
instantiated methods are callees like any other. What the copy leaves behind is
the **type id** it refers to. `Array(Item):type_id` is resolved from a
definition in the consuming program, a program defines an id for every type it
*has*, and `Array(Item)` is not among them: it exists in the producing build
because of a body that stays behind, and nothing in the declarations a consumer
reads would ever make it. Four undefined symbols on a module of nineteen lines,
in a program whose every method resolved.

So the artifact carries the **names** of the types its object code numbers, and
the consumer instantiates them on `import`. Names rather than numbers, for the
reason the section exists at all. Two programs number their types differently.
Only generic instances travel: everything else a module's code can name is
either declared by this artifact or imported by the consumer for itself, and an
instantiation is the one case with no declaration anywhere to arrive through.
The type has to be *numbered*, not used, so making it is enough.

**Which made a module's unexported types travel too**: the router's
`RouteDefinition` is a `private record`, so `Array(Router::RouteDefinition)`
named something the artifact did not have. A type nobody may call arrives as
its name, its kind, its fields and its nesting, and **no methods**: the
consumer cannot reach them and the module's object code already defines them,
and carrying them would put R-2's block rule. A rule about what another module
reads: in front of a private method's unannotated block. The visibility
travels as it was written, which is what keeps R-2b true on the far side: the
type is declared by the consumer and reachable from nowhere, exactly as it is
when the module is read from source, and a consumer that names it is refused
with the same message either way.

Nesting travels because iyi cannot reopen a class to add a type to it later,
and a type declared in a class belongs to the class rather than to the module's
surface: R-2 governs the unit's own body. Two things follow from a private
type being *written down*. The declarations name it: `@routes :
Array(Router::Route)`, and a path in that text may reach it where a path in
anybody's source may not, which is a mark on the path rather than a hole in the
rule. And it arrives with fields and no `initialize` to assign them in, so it
is assumed to assign everything, on the same grounds as a bodyless `initialize`
above: the build that wrote the artifact already checked the real one.

What is left is an instantiation at somebody *else's* unexported type, which
neither module can name. The consumer refuses the `import`, naming the module
and the type, rather than leaving it to a linker that would report a mangled
symbol and no module at all.

Underneath all of it stays the fact that **an artifact carries what the
consuming build reached**, rather than the module's surface. Codegen is
demand-driven and `--emit-iyimod` lives inside an ordinary build. A module
compiled on its own would instantiate every exported def at the signature R-2
makes it write down, and compiling a module on its own is the command that
cannot precede the artifact it produces.

**Deciding "does this module have an initialiser" was wrong three times**, and
each was the kind of mistake a spec cannot find by reasoning. The same class
IV.6 records. The test walks a module's top level and calls anything it does not
recognise as a declaration an initialiser, which is the safe direction: a
refusal explains itself and a missing setup does not. What it did not recognise:
the file is already wrapped in a `ModuleDef`, because `apply_module_header`
turns `module a/b` into one, so **every** module answered "no initialiser" and
the flag was written and always false. Then `pub struct List(T)` is a
`VisibilityModifier` around the declaration, not a declaration, which refused
three samples that were fine. Then `type Elem = T` is an `AssocTypeDecl`, which
refused the two that have associated types. Each looked like the last bug and
was a different one.

**And a fourth, which is where the safe direction stopped being safe.** A macro
call is not a declaration, so `getter name : String` in a type body read as code
that has to run and refused the module, and so did `private record Route, …`,
which is how the router writes its three. That is not a corner: `getter` is the
shape of every library anybody would write, so the conservative answer was wrong
on the ordinary case. A macro call is not code *until it is expanded*, and by
the time this test runs the top-level pass has expanded it, so the question can
be asked of the expansion instead of the call. A `getter` is a `def` and a
`record` is a struct, and both are declarations. The other direction is what
makes that safe rather than merely convenient: a macro that expands to `puts` in
a type body is still code in a type body, and the module is still refused. A
call with no expansion is what it looks like, and is refused too.

**A reader that does not want it does not pay for it.** `ObjectCode` is the
largest section in the file and is written last; `IyiMod.read` seeks past it
unless asked, so `import`. The front-end reader this whole file exists to make
fast: never allocates it. A `--no-codegen` build omits the section entirely
rather than writing it empty, and can still typecheck against a module whose
initialiser rules out generating code.

### IV.1a What the artifact actually buys: measured

The prelude fork probe (`IYI_FORK_PROBE=1`, temporary instrumentation) analyses
the prelude, forks, and compiles the user program in the child. Restoring the
prelude then costs a `fork`, which is the ceiling no serialised artifact can
beat. Front end only; 5 runs, median; single-threaded compiler build.

| Program | Front end today | Artifact (top level cached) | + prelude-aware passes |
|---|---|---|---|
| `hello.iyi` | 1.58 s | 0.47 s (3.4× | 0.049 s) 32×† |
| `webapp.iyi` (the Kemal port) | 1.54 s | 0.45 s (3.4× |) |
| 19.5k lines, 1500 types, 4500 methods | 2.39 s | 1.39 s (1.7× | 0.94 s) 2.6×† |
| prelude-free floor (`--prelude=empty`) | 0.09 s | (|) |

† Read IV.1e before quoting these. The third column measures a prelude analysed
all the way through `main`, which is more than Part IV's artifact carries and
which fails on any program that subclasses a prelude type. The number is a
ceiling on a configuration that does not work, not a target.

**The third column is reachable, and it was verified past the front end.** The
probe can go on to emit object code (`IYI_FORK_CODEGEN=1`). Under both models the
emitted object has a **byte-identical symbol table** to a normal build's: 3741
symbols, same size, differing only in 0.1% of bytes. So a front end that never
looks at the prelude produces the same program.

Getting there took one wrong turn worth recording, because it is the kind of
mistake this design invites. The first attempt handed codegen only the *user*
tree and failed with:

```
Missing __crystal_raise_overflow function
```

The tempting reading is that `main` is demand-driven and a prelude analysed
alone never instantiates what only user code reaches. That reading is wrong.
`__crystal_raise_overflow` is a `fun` in `src/raise.cr`, and **codegen emits
`fun`s and top-level code by walking the AST**, so the prelude's tree has to
reach codegen whatever the front end did with it. Once it does, the object is
equivalent.

Which is exactly what IV.1's object-code section is for: the prelude's machine
code comes from the artifact, not from re-analysing its source. The front end and
codegen need the prelude for *different reasons*, and only the front end's reason
is removed by caching analysis. Anyone building this will hit the same error and
should not conclude from it that the design is unsound.

**Measured again, now that it exists and the prelude is 1,053 lines: at this
scale the artifact buys no measurable time.** `bench/artifact_speed.py` builds
the Kemal port. The largest import graph here: from four modules' source and
then from four modules' artifacts with every one of those sources deleted. The
front end is the same figure either way, run after run, within a few percent.
The full builds move by more than that between two runs of the same column, so
this machine cannot separate them at all: what is being compared is smaller than
what the machine does to any measurement of it.

The reason it comes out this way is that **an artifact does not remove the pass
that costs**. What it removes is reading a module's source and typing its
bodies. What it does not remove is parsing. The declarations are text, and they
arrive as text, or the top-level pass, which runs over those declarations
exactly as it would have run over the source. At 107,719 lines the difference
between "the source" and "its declarations" was three orders of magnitude. At
400 it is nothing, and the parse of the declarations can cost more than the
parse of the module.

One thing the bench did find, and it was a defect rather than a difference: the
consumer wrote every object file it unpacks out of an artifact on **every**
build, to link bytes identical to the ones it linked last time. Six files on
this program. It writes them only when they are not already there now, which is
verified by the filesystem rather than by a stopwatch. A second build of an
unchanged program rewrites none of the six, where it used to rewrite all of
them.

**So it decides the prelude question, which was the next item on the list.**
Making the prelude an artifact would leave its 0.010 s top-level pass exactly
where it is, because that pass is over declarations either way, and would save
only the macro expansion: `primitives.iyi` writes 445 definitions from a loop
over five types, and an artifact would carry them already written out. What
removes the prelude's cost is not serialising the analysis but *keeping* it,
which is the daemon (IV.1d): analysed types in memory, no parse and no pass.

None of this is an argument against the artifact. It is the argument for what
the artifact is actually for: R-1, so that a module compiles against
declarations rather than source; IV.3, so that a build knows what to redo; and
`ObjectCode`, so that a consumer links a module it never compiled. Speed at this
size was never among them, and saying so is cheaper than measuring it twice.

### IV.1b End to end, with a real binary at the end

The probe can also link, so the claim can be checked the only way that really
counts: build `hello.iyi` inside the fork and run what comes out. Both models
produce a binary whose output is identical to a normal build's.

| | front end | whole build | vs Crystal today |
|---|---|---|---|
| today | 1.48 s | 2.19 s | 1.00× |
| artifact model | 0.47 s | 1.13 s | **1.9×** |
| + prelude-aware passes | 0.049 s | 0.74 s | **3.0×** |

Reaching this needed a runtime fix, worth recording because it is not
iyi-specific. **A forked child could not spawn a subprocess at all.**
`Signal.after_fork` recreates the signal pipe but never restarts the
`signal-loop` fiber that reads it (only the forking thread survives a fork) so
a `SIGCHLD` was written into a pipe nobody read and `Process#wait` blocked
forever. That silently broke the linker, `expand_lib_flags`, and `macro_run`
alike; restarting the reader fixes all three.

So a prelude daemon (analyse once, fork per build) is not blocked on `.iyimod`
at all.

### IV.1c Two bugs the split found, which `.iyimod` would have hit anyway

Making the artifact model compile the compiler itself took fixing two defects in
`TypeDeclarationProcessor`. Both are latent today and unreachable in a single
run, and both are certain to reappear the moment analysis is restored from an
artifact rather than recomputed. They are the first concrete evidence of what
Part IV costs beyond the file format.

1. **A module's guessed instance variables never reached types that included it
   later.** `process_owner_guessed_instance_var_declaration` returns early when
   the owner already has the variable, which doubles as "already processed",
   and that skipped the transfer to `raw_including_types`. When `IO::Buffered` is
   analysed in one run and `Socket` includes it in the next, `Socket` never gets
   `@in_buffer`, and it surfaces far away, as a nil assertion while attaching the
   initializer.

2. **Redeclaring a variable discarded its initializer.**
   `declare_meta_type_var` always builds a fresh `MetaTypeVar` and replaces the
   old one. In a single run that is safe, because declarations are processed
   before initializers are visited. Across a split it silently dropped every
   prelude class variable's initializer: caught here by the non-nilable check,
   but the same clobbering would have left them uninitialized at runtime.

3. **A per-pass flag stayed set across passes.** `top_level_semantic_complete`
   guards `TypeNode#instance_vars` and `#has_inner_pointers?` in macros, which
   must refuse to answer before instance variables are declared. A second
   top-level pass inherited the flag from the first, so the guard did not fire
   and the macro got an *empty* list instead of an error: then generated code
   against variables the type did not have yet. It is now cleared at the start
   of every top-level pass, which is a no-op in a single run.

The pattern in all three: **passes assume they see the whole program once.** Not
"they are slow", which is what IV.1a measured. They encode single-run
assumptions in ways that only fail when a program is analysed in two pieces.
That is the real content of "make the passes prelude-aware", and it is found by
running the split, not by reading the code.

### IV.1e What the fourth failure revealed about the experiment

The full model's remaining failure on the compiler was worth chasing to the
bottom, because the answer is about the experiment rather than about a bug.

Two plausible causes were wrong. It was not `finished_hooks` accumulating across
runs, and it was not the flag above. The actual chain, from the compiler's own
stack rather than from reading:

```
force_add_subclass → add_subclass → notify_subclass_added → Call#on_new_subclass
```

**A subclass observer is a `Call` registered during `main`, and notifying it
re-types that call.** In an ordinary compile this can never fire mid-declaration:
every type exists before `main` runs. Under the full model the parent had already
run `main`, so the child's top-level pass declaring `TypeException < CodeError`
re-typed a prelude call against a type whose instance variables were not declared
yet: hence a complaint about `@inner`, three layers away from the cause.

Holding those notifications until the end of the top-level pass fixes that layer
and exposes the next one: `instance variable '@dependencies' of Crystal::ASTNode
must be Crystal::SmallNodeList, not Nil`, i.e. nodes bound by the completed run
being re-bound by the new one.

That deferral is **not** in the tree. It passed the whole suite: 3350 semantic,
1811 codegen, 3962 parser, so removing it was a scope decision rather than a
correctness one: it changes a core mechanism to serve a configuration that still
does not work, and the knowledge it produced is this section. Whoever builds the
real prelude-aware passes will need it, and will find it here.

**The pattern is the finding.** The full model restores a prelude analysed
*through `main` and `cleanup`* and then declares new types against it. Part IV's
artifact deliberately carries types, signatures, impl records and layout
templates: **not typed method bodies**. So the full model was measuring a
configuration the design does not ask for, and its layered failures are what
"analysis complete, now declare more types into it" costs.

This corrects the third column of IV.1a: **32× is the value of a configuration
that does not work**, not a target. The genuine version of "prelude-aware passes"
parent stops at the end of the top-level phase exactly as the artifact model
does, and the child's *later* passes skip prelude subtrees: has not been built
or measured. It is the honest next experiment, and it is unaffected by everything
above, because it never runs `main` twice.

**Where it stands:** the artifact model now compiles all nine gate programs, a
targeted regression for each bug above, and the compiler itself. The full model
still fails on the compiler, for the fourth reason above, so its 3.0× remains a
result on small programs. The artifact model's 1.9× is the one that survives
contact with a real codebase.

The other honest limit: codegen's own prelude cost is untouched: 0.7 s of the
2.2 s build, now the dominant term, and reducing it is the object-code
section's job, which Crystal's existing `.o` reuse already does part of.

### IV.1d The daemon. The measurement, shipped, and then outlived

**Read this section knowing how it ends.** The daemon was built to hold
Crystal's 107,719-line prelude analysed between builds, and it did, and then
0.1.0 item 3 replaced that prelude with 1,053 lines of iyi and left it nothing
to hold. Measured again on the edit loop of IV.3a, 30 modules and 7,208 lines,
each build checked to produce a program that prints what the edit says it
should:

| | one module edited, rebuilt |
|---|---|
| `iyi build` | 0.18–0.28 s |
| the same through the daemon | 0.20–0.24 s |

**Nothing, within the noise, and a socket round trip to pay for it.** The term
it removes is prelude analysis, and iyi's prelude is small enough that
analysing it is no longer a term. So the daemon stays in the compiler, where it
is Crystal's to use on Crystal's prelude, and `iyi` does not offer it: a
command that costs a terminal and buys nothing is not a command.

> **And then `--crystal` gave it a prelude to hold again, so `iyi` offers it.**
> The paragraph above is right about iyi's prelude and wrong about the mode
> item 12d made central. `iyi daemon start` runs a single-threaded `iyi-daemon`
> built and shipped beside `iyi`, and holds Crystal's library analysed between
> builds.
>
> **The first numbers written here were wrong, and how they were wrong is worth
> more than they were.** They are below, after the right ones, because a
> measurement that flatters its own feature is a failure this document has now
> recorded more than once.
>
> Front end only, so that the term the daemon actually removes is not diluted by
> codegen. Release compiler, a daemon holding one prelude, and the two arms
> alternated rather than run in blocks — this machine's clock steps, and a block
> of one arm can land inside a step:
>
> | twelve-module app, `--no-codegen` | normal | through the daemon |
> |---|---|---|
> | twelve modules | 0.77–0.85 s | **0.44–0.49 s** |
> | twelve modules and Kemal | 1.15–1.36 s | 0.93–1.13 s |
> | the same, with Kemal named in a `--prelude` file | 1.15–1.36 s | **0.57–0.66 s** |
>
> **What it removes is about 0.3 s**, and a full build adds codegen and a link
> that it does not touch, so the share is smaller again. Full-build timings on
> this machine were too noisy to publish.
>
> > **They are publishable now, and the harness is committed** —
> > `bench/daemon_full_build.py`, which builds twelve modules under `--crystal`
> > with codegen and a link, eight alternating pairs, a module edited before
> > every build, and refuses to run unless both binaries are optimised. All
> > three of those are the corrections above, built in so they cannot be
> > forgotten again.
> >
> > | twelve modules, full build | min | median |
> > |---|---|---|
> > | normal | 0.63 s | 0.66 s |
> > | through the daemon | **0.46 s** | **0.49 s** |
> >
> > **0.17 s, or 26%**, and two runs agree to a hundredth. What was called noise
> > was mostly the measurement: `/usr/bin/time`, whose negative elapsed times
> > this section records, is not installed on this machine at all, and the wall
> > clock now runs a three-second window against the monotonic one with no
> > backward step.
> >
> > **This is not the row above measured further.** The app here is twelve
> > trivial modules and its front end alone is 0.35 s, against 0.81 s for the
> > app the table was made from — a lighter program, so a smaller saving. What
> > it establishes is that a whole build *can* be measured here, and what the
> > shape of the answer is: the daemon takes about half of the front end, and
> > the front end is about half of the build.
>
> **The last row is the finding.** It is the only large effect, it is more than
> twice the other two, and it does not come from holding the prelude — it comes
> from holding *Kemal*. The daemon's value is in the program's dependencies
> rather than in the library underneath them, which is the same sentence as
> "give the dependency an artifact", said by a resident process instead of by a
> file.
>
> **What it costs is memory.** About 200 MB resident per prelude held, and the
> default is three (`CRYSTAL_DAEMON_PRELUDES`), so a daemon that has seen a few
> flag sets is holding half a gigabyte.
>
> **The mechanism itself is sound, measured separately.** `IYI_WARM` analyses the
> prelude and adopts it in one process, without forking: adoption returns
> essentially the whole prelude analysis — 0.48 s of a 1.25 s front end — with no
> penalty for the Kemal case. The gap between that and what the daemon delivers
> is the fork, 0.2 to 0.3 s. It is not the GC: a daemon started with
> `GC_DONT_GC=1` measures the same.
>
> **The wrong numbers, and the three ways they were wrong.** What was published:
> 2.27 s to 1.24 s, 2.42 s to 1.30 s, 3.33 s to 2.52 s.
>
> - **A debug compiler.** `make iyi-tarball` did not force `release := 1`, so
>   the binaries measured were unoptimised. Prelude analysis is about 1.5 s
>   there and about 0.5 s in a release build, so every saving above is roughly
>   three times what somebody with the released tarball would see. The tarball
>   now refuses to be built from an unoptimised binary — `check_iyi_is_release`.
> - **Repeated identical builds.** Crystal caches generated objects per program,
>   so building the same unedited file five times skips codegen from the second
>   run on. That leaves the front end as most of what is measured, and the front
>   end is exactly what the daemon accelerates. Every measurement here now edits
>   a module first.
> - **A stepping clock.** This machine's clock jumps, and `/usr/bin/time`
>   reported *negative* elapsed times more than once. Six measurements of one arm
>   in a row can sit inside a step and come out uniformly wrong, which is how one
>   batch showed the daemon *slower* than a normal build for the Kemal case. It
>   is not. Alternating the arms is what makes a step hit both.
>
> The first two flattered the daemon and the third smeared it in both
> directions. None was a mistake about the compiler; all three were mistakes
> about the measurement, made by the person who wanted the number to be good.
>
> **It warms Crystal's prelude and not iyi's, and that is deliberate.**
> `--crystal` sets the prelude `Compiler.new` already has, so those builds hit
> the startup analysis on their first request. An ordinary `.iyi` build misses
> and warms `iyi/prelude` after its first build: 0.03 s, which is the reason
> the daemon is not for that mode.
>
> **Four bugs were in the way, all older than this work.** Three are one fact
> forgotten — the daemon runs in its own directory and the client does not.
>
> - A finished build's arguments are re-read in the daemon to decide which
>   prelude to warm next, and they were read in the *daemon's* directory. The
>   option parser exits the process on a file it cannot find, so the daemon
>   died after serving a build correctly — whenever the client had typed a
>   relative path, which is always.
> - A preanalysed prelude carries the compiler's search path, and `lib` is
>   resolved against the directory that path was built in. Every shard-using
>   project, built from anywhere but the daemon's own directory, answered
>   `require "kemal"` with "can't find file".
> - Fixing the second silently did nothing, because `CrystalPath` is a
>   **struct**: setting a field through a getter mutates the copy the getter
>   returned. Nothing failed; the daemon simply went on resolving `lib` beside
>   itself.
>
> Every spec in `crystal-daemon_spec.cr` passed through all three, because each
> one passes an absolute fixture path and starts the daemon where the runner is.
> That is the shape of the lesson rather than an aside: **a spec that never
> leaves the directory it was written in cannot see a directory bug.** Three new
> ones do.
>
> The fourth is not about directories and is the worst-behaved: **the path that
> adopts a preanalysed prelude never runs `new_program`**, so everything that
> method turns a switch into was decided by whoever analysed the prelude — a
> `Compiler.new` in a daemon, holding none of the build's switches. Most of it
> is safe because the flags, the target, the optimisation mode and the prelude
> are all in `prelude_cache_key`: an analysis that differs in any of them is a
> different analysis. `--use-iyimod` is not in that key. It was accepted,
> ignored, and the build compiled every module from source without a word,
> which is worse than the switch not existing — and it is only visible from
> outside by deleting the module's source, which is what its spec does.
>
> That one is worth generalising. **A cache key is a claim that everything not
> in it does not matter**, and this key was written when the only thing reading
> it was prelude analysis. Every switch added since has had to be checked
> against it by hand, silently, and nothing enforced the check.
>
> **It is enforced now.** Each of `Compiler`'s thirty-seven switches is written
> down as one of three things — in the key, re-applied when a build adopts a
> preanalysed prelude, or reaching neither — and `prelude_cache_key` refuses to
> compile while any is missing. Adding a property fails the build with the
> question rather than leaving it to be answered later by a build that quietly
> did the wrong thing.
>
> Writing the three lists out is itself worth something: two entries turned out
> to be judgements rather than facts. `mcpu`, `mattr` and `mcmodel` reach the
> target machine and the target machine reaches codegen, so a prelude analysed
> for one `-mcpu` is the same analysis as for another. And `progress_tracker`
> and `stderr` are where output goes — `new_program` sets the first, the adopt
> path sets neither, and that asymmetry was true before and invisible.
>
> **And artifacts and the daemon overlap.** Twelve modules as artifacts *plus*
> the daemon was 1.67 s against the daemon's 1.30 s — slower, because the daemon
> has already removed the term the artifacts were removing and reading twelve of
> them is not free. Under Crystal's library the daemon wins; under iyi's own the
> artifacts do, and neither is a general answer.

The measurement that follows is the one that built it, kept because it was true
and because the shape — *a thing measured, shipped, and then made pointless by
the next thing measured* — is the second time this document has had to record
it (0.1.0 item 2 is the first).

Measured on `hello.iyi`, five consecutive builds with the output deleted each
time:

| | |
|---|---|
| `crystal build` | 2.19 s |
| `crystal daemon build` | **1.12–1.31 s** |
| prelude analysed once, at startup | 1.07 s |

Diagnostics and exit status are identical to a normal build on all nine gate
programs, and the binaries it produces behave identically on all four samples.

Three things it has to get right, all of which are about being a *daemon* rather
than about compilation:

- **Staleness.** It holds an analysed prelude across edits to that prelude. The
  fingerprint is every file in `program.requires` with its modification time,
  checked per request; a changed prelude is re-analysed before the build. Tested
  by adding a method to `String`, watching a previously failing program compile,
  removing it, and watching the error come back.
- **Flags.** Macros branch on flags, so an analysis made under one set cannot
  serve a build under another. The daemon keeps one prelude *per flag set*,
  keyed on everything that changes what the prelude analyses to, and warms a new
  one from builds that already succeeded. The first `--release` build is cold,
  the rest are not. Measured: 0.46 s on a cached flag set, 1.48 s cold, and
  0.52 s once warmed.

  It warms only from arguments a build has already parsed successfully, and that
  is the whole safety argument: turning arguments into a compiler means running
  the option parser, and the option parser exits the process on bad input. Doing
  that on arguments a client made up would take the daemon down on a typo. It
  also warms only while nothing is in flight, since analysing costs about a
  second and this loop is what relays every build's output.

  Bounded by `CRYSTAL_DAEMON_PRELUDES`, default 3, because each analysed prelude
  is roughly 180 MB of live heap. Past the bound, extra flag sets stay cold
  rather than being evicted. A cold build is slow, and evicting the set someone
  is actively using would make every build slow in turn.
- **Its own socket.** `UNIXServer#close` unlinks the socket file, so the forked
  child closing its inherited copy took the daemon's address away from every
  later client while the daemon went on listening, looking healthy. `close(delete:
  false)` in the child.
- **Its own compiler.** A daemon holds an analysed prelude *and the compiler that
  analysed it*. Rebuild the compiler and it keeps serving builds from the old
  one, with output that looks entirely normal. The worst shape a stale cache
  can take. It now records its executable's size and modification time before
  opening the socket, checks per request, and refuses with an instruction to
  restart. Nanoseconds, not seconds: a rebuild landing in the same second as the
  daemon's start is exactly the case to catch.

**Using it should not require remembering it.** With `CRYSTAL_DAEMON_SOCKET` set,
an ordinary `crystal build` is served by that daemon: 1.00 s against 1.85 s on
the same warm cache, and falls back to a normal build, with a line saying so,
when nothing answers. Opting in to a daemon must never be able to *stop* a build;
the worst it may cost is the speedup.

**Builds run concurrently, and getting there took two attempts.** The obvious
fiber-per-connection version deadlocks and then dies: a forked child inherits the
parent's live fibers, and the scheduler runs them as soon as the child blocks on
IO, so another build's relay fiber writes to descriptors this child has closed.
**Fork-based build servers cannot be made concurrent by adding fibers**: that is
the transferable part.

What works is one fiber and one `poll(2)` over the listener plus every in-flight
build's two pipes. Crystal has no `IO.select`, so the binding is declared in the
daemon (at file scope: reopening `lib LibC` inside a class defines a *nested* lib
of the same name instead of extending the real one). A child also closes every
*other* in-flight build's connection and pipes, or an inherited copy outlives the
build that owns it.

Measured: four concurrent builds finish in 2.0 s against 1.16 s for one, and
eight (half of them deliberately failing) in 3.2 s with every exit status and
every diagnostic delivered to the client that asked for it.

Two limits worth naming: the request is read inline, so a client that connects
and then stalls holds up the loop; and writes to a client are blocking, so a
client that stops reading stalls the relaying of other builds. Both are fine for
a local build daemon and neither is fine for anything exposed.

**Packaging.** The server is a separate binary, `make crystal-daemon`, built with
`-Dwithout_mt`. This is not a workaround to be removed later: only the forking
thread survives a `fork`, so a multi-threaded runtime hands the child a broken
one, and Crystal refuses `fork` in such a build at compile time: correctly. The
client does not fork, so it stays in the normal compiler; `crystal daemon start`
execs the server binary (or `CRYSTAL_DAEMON`, if set) and says how to build it
when it is missing.

The cost of that split is that the daemon's builds code-generate sequentially.
Measured, it does not eat the win: on a 19.5k-line, 1500-type program the normal
multi-threaded build takes 3.40–4.25 s and the daemon 2.59–2.77 s, with identical
output. That is one program on one machine, not a general claim. A program whose
codegen both dominates and parallelises well could come out differently.

Against the same multi-threaded compiler as baseline: `hello.iyi` 2.21–2.26 s
normally, 1.16–1.24 s through the daemon.

**What it is not.** It cannot cross machines or sessions, it holds one prelude
and so serves one flag set quickly, and it builds one program at a time. It is
scaffolding that `.iyimod` will replace: worth having because it delivers the
win now and because every latent single-run assumption it trips over is one
`.iyimod` would have tripped over later.

It is covered by `spec/compiler-cli/crystal-daemon_spec.cr`, which starts a real
daemon on a private socket and checks the properties that would make it subtly
wrong rather than visibly broken: a served build's exit status and diagnostics
match a normal build's byte for byte, `stdout` and `stderr` stay separate, a
second build is still served after the first, and a build whose flags differ from
the daemon's prelude is still correct. `make cli_spec` builds the server binary
so the suite actually exercises it; if it is absent the examples report as
pending with the reason, rather than passing silently.

**The artifact alone is worth 3.4×, not 20×, and the gap is not the artifact's
fault.** Where the child's 0.45 s goes:

| Pass | Cost with prelude pre-analysed |
|---|---|
| top level | 0.004 s (was 0.99 s) |
| class-var initializers | **0.285 s** |
| main | **0.162 s** |
| everything else | ~0.04 s |

The top-level pass. The only one `.iyimod` removes: drops by 250×. What
remains is that **six of the eleven semantic passes re-walk the prelude AST and
three re-walk the whole type graph**, whatever put the prelude there. Class-var
initializers and `main` are 90% of the residual.

**So Part IV is necessary and not sufficient.** A serialised prelude that the
later passes still traverse converts a 1.5 s front end into a 0.45 s one; the
floor needs those passes to skip prelude nodes too, which the experiment above
shows is achievable and worth another 10×. That is a separate piece of work from
the file format, it is larger than the format, and it should be planned as such
rather than discovered afterwards.

Two secondary results from the same instrument:

- **Half the top-level cost is parsing.** 304 files, 107,719 lines: 0.57 s to
  parse, 0.54 s to visit. A cache removes both; a faster parser removes one.
- **User code stays nearly free until the program is large.** `webapp.iyi` costs
  the same as `puts "hi"`. At 19.5k lines user code finally dominates and the
  win falls to 1.7×. The prelude cache matters most to the small, frequent
  builds, which is where build-speed complaints come from.

**Everything above was measured against a 107,719-line prelude, and item 3
deleted it.** The table in this section is kept as what the instrument said at
the time, because the reasoning it supports is still the reasoning. A pass that
re-walks the prelude is a pass whose cost grows with the prelude. What changed is
the multiplier. Re-measured on the release compiler with iyi's own 1,053-line
prelude: the top-level pass is 0.012 s, and class-var initializers, `main`,
instance-var initializers, cleanup and the recursive-struct check are **0.4 ms
between them**. "Six of the eleven passes re-walk the prelude AST" is still true
and no longer worth anything: the residual it describes is 2% of a front end that
is itself 7% of a build. Scope item 2 records where the time went instead, which
is the linker.

### IV.2 What goes in Exports, and what is deliberately kept out

**In:**

- **Type declarations.** Name, kind, generic parameters, field names and types.
  **Built.** A field travels as its resolved type rather than as the annotation
  the author wrote, which is a departure from how signatures travel and is
  deliberate: a field is not part of the surface a consumer writes against, it
  is what the consumer has to allocate. For a generic type the resolution is in
  terms of its own parameters: `List(T)`'s `@items` is `Array(T)`, which is
  what lets one declaration stencil at every instantiation.
- **Layout templates.** Size, alignment, and pointer map: expressed as a
  *function of the type parameters' shapes*, not a fixed layout. `Array(T)` is
  three words regardless of `T`; `Tuple(Int32, String)` is not. R-4 needs the
  template to stencil at any shape.
- **Type descriptors.** A runtime type id per exported type. II.6 established
  that dictionaries carry type identity, not just pointer maps, because
  `select(type : U.class)` filters by runtime type.
- **Signatures** of `pub` functions and methods. Parameters, return type, the
  `where` bounds from II.6, and everything else on the `def` line: the block
  annotation, `forall`, `abstract`, the receiver.
- **Trait declarations.** Required methods, associated types, and the
  *signatures* of default methods.
- **Impl records.** Every `(Trait, Type)` pair this module provides, with what
  the impl answers. Its `forall` parameters, its trait arguments, its
  associated types, and the methods it defines. This is what lets a consumer
  answer "does `Customer` implement `ToJSON`?" without reading `Customer`,
  which II.4 depends on.
- **The module's `using` directives.** Not part of its surface: nothing here is
  reachable through them. Part of what its surface *means*. A signature is
  stored as the annotation the author wrote (IV.1), and `pub def handle(ctx :
  Context)` resolves `Context` through a `using` further up the file. The
  annotation travels, so what resolves it has to travel with it.
- **Exported constants.** **Built.** `pub LIMIT = 42` is reachable through the
  module's name and an unmarked constant is not, which is the same sentence an
  unmarked `def` gets. Nothing was added to the format: a module's own top
  level already travels as source text, so the mark travels by being written
  back out, exactly as `pub macro` does.

  Closing it found the hole under it, the third of its kind: a constant's
  visibility was never set from `pub`, so **every** constant a module declared
  was reachable through its name. A shard is where that shows: Kemal hands out
  every object it has through one, and the boundary in Part V item 12 could
  read 22 of its types and reach none of them.

  `pub` still refuses an `enum`. There is none in the prelude or in any sample,
  so nothing has asked. Nothing in this repository asks for either: there is
  no `enum` in the prelude or in any sample, and the three module-level
  constants that exist (`HTTP_METHODS`, `FILTER_METHODS`, `APP`) are read by
  their own module and named by nobody else. That is item 3's rule applied
  here: a thing enters because something writes it. What is worth saying is
  that the *format* has been written as though both already travel, and this
  paragraph is what keeps that from reading as a bug in the artifact rather
  than a feature the language has not been asked for.

**R-3 is refused where somebody reaches for it.** The way a Crystal programmer
adds a method to an imported type is a qualified declaration: `struct
App::A::Point` inside their own module. iyi has no open classes, so that path
does not resolve, and the compiler used to do the helpful thing and create
`Main::App`, `Main::App::A` and a second `Point` inside them. The program then
failed somewhere else with `wrong number of arguments for
'Main::App::A::Point.new'`, which names neither the rule nor the type the author
meant. It is refused at the declaration now, naming both, and pointing at the
`impl` that R-3 does allow. A file's own namespace is untouched, and so is
`module app/formal` beside `module app/greeter`, which share `App` because the
parser wrote both.

**R-2 is enforced where the artifact is written, and until recently only half
of it was.** The block rule below was checked and the rest was not: `pub def
greet(name)` compiled, the artifact recorded `def greet(name)`, and the cost
landed on somebody else. A consumer types a call from the return type alone,
since the body stays behind, so it inferred `Nil` and asked the linker for
`greet<String>:Nil` while this module had emitted `greet<String>:String`. The
module's own build was clean and the consumer's failed on a mangled symbol that
named no rule. Both halves are checked now, at the same place, and the message
names R-2 and the parameter.

Two things are exempt and both for the same reason: the type is already written
down somewhere a consumer reads. `initialize` answers the type it is defined on,
a setter answers what it was handed, and a method inside an `impl` is checked
against the trait's `abstract def`, which is where its types are.

**A block parameter is a parameter (R-2).** An exported `def` that takes a
block has to say what the block is: `pub def namespace(path : String, &)` says
a block arrives and nothing about it. Inside the module that is enough, because
the `yield` is right there. Through an artifact it is not. The body stays
behind, and what the block receives and returns is in it. Refused where the
module is compiled rather than where it is read, because that is where the
author can fix it.

The count that decided it: **one exported signature in the samples out of about
eighty**: Kemal's `Router#namespace`, which is also the case no annotation can
express, since `with sub_router yield` changes what `self` means inside the
block.

**And that one was paid rather than avoided.** The port now takes the
sub-router as a block parameter: `& : Router -> Nil`, called with `|admin|`,
which is a visible loss against Kemal's original and a smaller one than keeping
`namespace` unexported would have been. The alternative is a notation for the
block's `self`, something like `& : with Router -> Nil`, and it stays open: it
would have to say that `self` becomes the annotated type *with the caller's own
behind it*, which is what `with … yield` means. Nothing else in the samples
asks for it, and what unblocking `namespace` bought was two further findings in
IV.1g that no amount of reasoning about blocks would have produced.

**Out, deliberately:**

- Bodies of ordinary `pub` functions.
- Everything private: types, methods, fields not exposed.
- Anything that would let a consumer come to depend on an implementation detail.

**The two exceptions, both of which cost something:**

1. **Macro bodies.** `derive JSON` runs in the module declaring the type
   (II.4), so that module needs `std/json`'s macro body in order to run it.
   Macros are compile-time code; shipping them is loading a plugin, not reading
   an implementation.

   **Built, and the reason turned out to be nearer than `derive`.** A body that
   travels may call a macro of its own module, so the macros travel with it,
   all of them, on the module and on each type, as source text.

   **`pub macro` is the way to say which of them another module may run, and
   it is built.** A marked macro is reachable exactly as a `pub def` is:
   unqualified after `using`, or through the module's name. An unmarked one is
   the module's own and is refused by the same sentence an unmarked `def` gets.
   What it exports is a name and an arity rather than types, because a macro
   takes syntax and returns syntax and there is no type to write down — the one
   place R-2's "write the types" has nothing to ask for.

   Closing this found the hole under it: a macro's visibility was never set, so
   before `pub macro` existed **every** module's macros were already callable
   through its name. They travel so that a travelling body can call one, and
   that made them a surface nobody wrote and nobody could have refused.

   **Macros are not hygienic, and `pub macro` exports that too.** A macro is
   pasted text, so `pub macro shadow` writing `tmp = 99` assigns to the
   consumer's `tmp` if it has one, which was measured rather than assumed. This
   is Crystal's semantics kept whole, and it is a real hole in what R-2
   promises: an export whose surface is a name and an arity can still reach
   anything the caller can name. Hygiene is a rename of every name a macro
   introduces, it would part this fork from the macro semantics its own prelude
   is written in, and it is not built.
2. **`@[Monomorphize]` bodies.** The consumer specialises them, so it needs the
   body. This is the (b) path from II.6 and it is where incrementality is at
   risk: see IV.3.

   **Built, and wider than the annotation suggests.** The set is not the items
   somebody marked: it is every method a consumer has to compile, which the
   compiler can work out for itself. A generic type's methods, because
   instantiations belong to whoever writes them; a trait's defaults, because
   they are stencilled onto the implementing type; an impl's methods *unless*
   its target is a non-generic type this module declares, because otherwise
   they land in a unit the artifact cannot carry; and **any def that takes a
   block**, wherever it is written, because it is instantiated with the
   caller's block inside it and the caller is the consumer. `@[Monomorphize]`
   remains the annotation for choosing to specialise something that would
   otherwise be a dictionary call (II.6); it is not what decides whether a body
   travels. See IV.1g.

### IV.3a What the loop costs, against the language that does this well

The property above is a spec: a body edit does not move the interface hash, so
dependents are not rebuilt. What it was not, until now, is a number. Everything
timed in this document before this section was a *whole* build, and nobody uses
a language through whole builds.

`bench/incremental.py` builds a project rather than a file: 30 modules, 300
types, 7,208 lines, written by one generator in iyi, in Crystal and in Go, and
refused if the three binaries do not print the same number. Then it changes one
line and builds again. Best of 7, seconds, release compiler, idle machine:

| what changed | iyi | Crystal | `go build` |
|---|---|---|---|
| nothing cached anywhere | 0.61 | 1.97 | 3.09 |
| nothing at all | 0.12 | 1.14 | 0.08 |
| **one module's body** | **0.13** | **1.17** | **0.16** |
| the entry file only | 0.12 | 1.15 | 0.16 |
| the same edit, without artifacts | 0.23 | — | — |

**Four things fall out of it, and the last is the one to keep.**

**The Crystal column is the whole argument in one number, and it is this
compiler.** The same binary compiles that column; the difference is the
language it is compiling. A Crystal class is open until the last line of the
last file, so no build may trust anything it read last time, and every rebuild
of this program costs 1.17 s no matter what moved in it. The same edit under
R-1 and R-3 costs 0.13 s. **9x, on the language this is a fork of, measured
rather than argued** — and it is the number this document has been promising
since its first page.

**The loop is also where iyi holds against Go.** 0.13 s against 0.16 s for the
same edit to the same program, and 0.16 against 0.19 an hour earlier: Go's
column moves as much as iyi's, which is the answer to what a single run of
either would prove. Go is not slow at this; Go is the reason
this design exists. Being ahead by a fifth on a project this size is not the
headline: being in the same class is.

**The last row is R-1's argument with a price on it.** The same edit, built
without artifacts so that all 30 modules are read and analysed from source,
costs 0.23 s. With the artifacts it costs 0.13 s. **The rule pays 1.8x on the
loop it was written for**, and it pays it on a 7,208-line project — the figure
grows with the code that is *not* being edited, which is the whole of any real
program.

**The seconds are a machine, the columns are the language.** The table above
was measured in a state this machine's own reference accepts — starting the
compiler and doing nothing costs what it cost when 0.1.0's target was recorded.
Two sessions the reference accepts read 0.13 / 1.17 / 0.16 and 0.16 / 1.29 /
0.19 on the edited-module row, and a tired one reads 0.22 / 1.81 / 0.27:
everything moves together and the ratios stay.
`bench/incremental.py` prints that factor and says which of the two kinds of
run produced its table, because a comparison survives a slow machine and a
figure in seconds does not.

**What the rule is worth as the project grows, and where it is worth nothing.**
The table above is one project. Five, from the same generator, each timed the
same way: edit one module, rebuild with the artifacts, then rebuild the same
edit with every module read from source. A debug compiler, so read the ratios
rather than the seconds:

| project | with artifacts | from source | |
|---|---|---|---|
| 30 modules of 1 type, 997 lines | 0.13 | 0.14 | 1.1x |
| 300 modules of 1 type, 9,907 lines | 0.47 | 0.68 | 1.4x |
| 30 modules of 10 types, 7,207 lines | 0.27 | 0.48 | 1.8x |
| 60 modules of 10 types, 14,407 lines | 0.42 | 0.85 | 2.0x |
| 120 modules of 10 types, 28,807 lines | 0.77 | 1.61 | 2.1x |

**It is the lines, not the modules.** Three hundred modules of one type each buy
1.4x; thirty modules with ten types each buy 1.8x on a third of the files. And
below a certain size it is a loss: a project of 300 five-line modules rebuilt
in 0.30 s from source and 0.35 s from artifacts, because reading a `.iyimod`
costs more than parsing five lines. R-1 pays for the analysis it skips, so it
pays where there is analysis to skip, and a module small enough to read at a
glance is one the compiler can read at a glance too.

**What is left is not analysis, which is why this stops here.** Of the 0.13 s,
0.018 s is the compiler process starting and most of the remainder is the
link (0.1.0 item 2 measured the same shape on `hello`). Editing one module of
thirty costs about 0.02 s over editing nothing. There is no version of this
table where making the front end faster moves the number a person feels; the
next thing that would is not compiling at all on a rebuild, which is V.9 (d)
and is priced there at weeks.

### IV.2a The checksum, and what it is not for

**Format v19 records a 64-bit checksum per section in the table, and a section
that is read is checked.** Found by damaging artifacts on purpose: a single
flipped byte in a `.iyimod` written by this compiler used to build **seven
times out of ten**, with the program still printing the right answer because
the byte had landed somewhere that changed nothing. The other three reached the
linker, which failed with a message that never mentioned the artifact. Now all
twelve of twelve are refused, each naming the file and the section.

**Per section rather than per file**, because a front-end read seeks past the
object code and hashing the whole file would put the largest section back on
the path IV.1 exists to keep short. The consequence is stated rather than
hidden: a build with `--no-codegen` compiles happily against an artifact whose
`ObjectCode` is damaged, because it never reads it, and the build that links is
the one that refuses. A section nobody reads is a section nothing is compiled
against.

**This is not a signature.** MD5 folded to eight bytes catches a bit flip, a
truncated copy and a partial write; it catches nobody who wants to write a
`.iyimod` on purpose, and the format does not pretend otherwise. R-1 already
says a consumer trusts an artifact's declarations, so an artifact from an
untrusted source is a decision made before the reader ever sees it.

### IV.3 Hashing. The part that decides whether builds are actually incremental

**The property that matters: changing a function body must not change the
interface hash.** If it does, every dependent rebuilds and the entire benefit
evaporates.

**Written, and the property is a spec rather than a claim.** `Hashes` carries
three digests, taken over what the artifact itself carries rather than over the
file it came from, which is what makes the interface hash mean anything: it is
over the exports, so an edit that does not reach them cannot move it. Editing a
body leaves the interface and implementation hashes where they were and moves
only the source hash; adding a `pub def` moves the interface hash. Both are in
`spec/compiler/iyimod_spec.cr`.

Two things the implementation settles that the table below leaves open. The
digests are taken **from the front end alone**, before codegen: an artifact
written by `--no-codegen` and one written by a full build describe the same
module and have to hash the same, or a build that only typechecks would
invalidate what a build that generated code had just written. And the module's
**initialiser is implementation**, not interface. It is spliced into the
consuming program and runs there, so a consumer that has compiled it has to
compile it again when it changes.

Three hashes, not one:

| Hash | Covers | Changing it invalidates |
|---|---|---|
| **Interface** | exported signatures, layouts, type descriptors, trait declarations, impl records, exported constant types (when there are any: see IV.2) | every dependent must re-typecheck |
| **Implementation** | macro bodies, `@[Monomorphize]` bodies | only dependents that actually expand or specialise those items; no re-typechecking |
| **Private** | everything else: private types, all ordinary bodies | nothing outside this module; dependents relink but do not recompile |

Worked through:

- Edit a private helper → private hash only → this module rebuilds, nothing else.
- Edit a `pub def` body → private hash → this module rebuilds; dependents relink.
- Change a `pub def` signature → interface hash → dependents re-typecheck.
- Edit `@[Monomorphize] def map`'s body → implementation hash → callers of `map`
  re-codegen, but do not re-typecheck.

**This makes the real price of `@[Monomorphize]` visible.** It is not only "more
code generated": it puts the body in the metadata, so **editing a monomorphised
function rebuilds everything that uses it.** That is the mechanism behind Rust's
slow incremental builds, and iyi imports it deliberately, in exchange for speed
on the hot path. Without the interface/implementation split it would poison
incrementality outright.

**Cache key** for a module: its own source hash, plus the interface hashes of
all transitive imports, plus compiler version, target triple and build flags.

**Built, and it is what turned `--use-iyimod` from a claim into a cache.** An
artifact records, for every module it imports, what that module hashed to when
it was compiled against it, so a build can ask two questions without opening
anything it does not need: does this artifact still describe the source it was
written from, and is every module it was compiled against still the module it
was compiled against. Both are answered from the header, the hashes and the
edges. The section table earns its keep here, because a staleness check that
had to page in the exports and the object code to answer would cost more than
the analysis it saves.

**What a stale artifact means depends on what the build asked for.** A build
that only reads them is refused, and told which module moved and how: quietly
compiling the source instead would make a build that asked to be compiled
against artifacts slower than it looks and prove nothing, which is IV.5's rule
applied to a different kind of mismatch. A build that also writes them is the
incremental loop itself: there, the stale module is compiled from its source and
its artifact rewritten, and everything still true is read.

**The property, demonstrated rather than asserted.** Two programs over one
graph: `main → app/outer → app/inner` and `leaf → app/inner`, so that the
dependency can be rebuilt while the dependent is not touched. Edit
`app/inner`'s body, rebuild `leaf`: `app/outer`'s artifact is still read, and
the program links the new body through the linker. Add a `pub def` to
`app/inner` instead, and `app/outer` is refused by name. Both are in
`spec/compiler/iyimod_spec.cr`.

**One bug it found, in the build nothing had run before.** Reading one module
from its artifact while compiling another from source is what an incremental
build *is*, and it had never been done with codegen on. The closure copies a
callee the emitting module does not own into its own unit with internal
linkage, and a def read from a `.iyimod` has no body to copy, so the copy was
a declaration with internal linkage, which is invalid IR. It is the same case
the C functions already had, and the rule is now the one that covers both: a
copy is private only where there is a body to copy.

**Where it is pessimistic, and why that is the honest edge.** Within one
invocation the compiler cannot know what a module it is about to recompile will
hash to, so a dependent of a rebuilt module is recompiled too rather than
checked against a hash that does not exist yet. Across invocations the finer
answer is the one above, which is the arrangement a build driver has, and the
reason the edges carry the hashes rather than the compiler carrying the graph.

**Granularity: module-level, for Draft 0.** Adding an unused `pub def`
invalidates dependents that never call it. That is pessimistic, and acceptable,
because what re-typechecking costs is a metadata read, not body analysis: the
expensive thing is already avoided. Per-declaration hashing with used-symbol
tracking is the known refinement (this is what salsa does) and should wait until
measurement says module-level is the bottleneck.

### IV.4 A result: coherence needs no global check

R-3 says an `impl Trait for Type` must live in the module defining the trait or
the type. Separate compilation raises the obvious worry: if module T and module
Y each define `impl Show for Foo`, neither can see the other, and the clash is
only discovered at link time, or never.

**It cannot happen.** Suppose trait `Show` is in module T and type `Foo` in
module Y. The impl may live in T or in Y.

- For T to define it, T must name `Foo`, so T imports Y.
- For Y to define it, Y must name `Show`, so Y imports T.
- Both would mean T imports Y and Y imports T: a cycle, which R-1 forbids.

So at most one module can define any given impl, **by construction**. The
compiler now refuses the cycle rather than leaving that step of the argument to
the load order that happened to hide one module's names from the other (III.5
rule 1).

The argument needs both T and Y to exist, and the build found the case where
neither does: a trait the compiler owns, or a prelude type, belongs to no
module. Taking the top level to be a module in their place is what broke this,
every module counts as inside it, so nothing was ruled out and any number of
modules could write `impl Error for String`. The top level is therefore not a
module (III.1.1): where a side has no module, that side cannot be satisfied,
and an impl with no module on either side is rejected wherever it is written.
That restores the premise rather than adding a rule.

The DAG and the orphan rule together make duplicate impls unrepresentable, and
coherence is checkable locally from the impl records in IV.2. No global pass, no
link-time surprise, no cost at build time.

This is the payoff for accepting R-3's restriction, and it is worth stating
plainly because it is not obvious that the orphan rule buys anything beyond
knowing a type's method set.

### IV.6 Notes from implementing the parser

Three things only surfaced once the syntax was fed to a real lexer. Recorded
because they are the class of problem a spec cannot find by reasoning.

**1. `/` in module paths collides with regex literals.** After an identifier,
Crystal's lexer treats `/` as the start of a regex, so `module app/user` lexes as
`app` followed by `DELIMITER_START`. Module paths are the one place `/` separates
rather than divides, so the parser suppresses regex mode while reading a path.
Go sidesteps this by putting import paths in string literals; Rust by using
`::`. Keeping `/` is a deliberate choice. It mirrors the filesystem, and it
costs a two-line workaround.

**2. `abstract def` for trait requirements.** See II.6; a bare signature is not
distinguishable from a default method without unbounded lookahead.

**3. Module paths are absolute, resolved from the project root.** Not relative
to the importing file. This only surfaced when a module two levels deep
imported a sibling: a relative reading resolved `app/greeter` against
`app/`, looked for `app/app/greeter`, and failed. The deeper point is that a
relative reading makes a path's meaning depend on where it is written, so two
files can disagree about what `app/greeter` refers to, which defeats the
purpose of having module identity at all. Go takes the same position. Until iyi
has a manifest, the project root is the directory of the entry file.

**4. Namespacing makes `using` mandatory, not a convenience.** II.3 presented
`using` as the thing that keeps DSL-shaped libraries writable. Implementing
namespaces showed it is more basic than that: the moment `module app/greeter`
actually scoped its contents, every cross-module reference broke, and the
working test had to be rewritten to
`impl App::Greeter::Greet for User` / `App::Greeter.polite(name)`. Without
`using`, ordinary multi-module code is unbearable, not merely verbose.

**5. Module functions need `extend self`.** A `pub def` at module level is a
function of the module, not an instance method of a mixin: iyi modules are
compilation units, not mixins. The desugar inserts `extend self` so
`App::Greeter.polite` resolves.

**6. Declaring a module and naming one. SETTLED: the mismatch stays, and is
made reversible. Built.** A module is declared lowercase (`module app/greeter`)
but reached capitalised (`App::Greeter`), because Crystal type names must be
constants. Three answers were available: accept the mismatch, adopt Go's
convention where the last path segment is the name, or teach the type system
lowercase module names. The third is the better language and does not fit
0.1.0; the second replaces a cosmetic problem with a real one, since
`app/greeter` and `web/greeter` would then be one name.

So the mismatch stays, and stops being a wart by being made **reversible**: a
path segment is `[a-z][a-z0-9]*` with single `_` between groups, checked in
`Parser#parse_module_path`, which is the one gate `module`, `import` and
`using` all pass through. `camelcase` upper-cases the first character of each
underscore-separated group and drops the underscores, so a name splits back
into a path at every upper-case letter, and path and name determine each other.

**"Lowercase snake_case" was not the rule, and finding that out is why it was
checked rather than asserted.** `camelcase` drops an underscore that precedes a
digit, so `v_1` and `v1` both give `V1`. Two paths, one module, a collision
that survives any amount of care about naming style. Doubled, leading and
trailing underscores collide the same way (`my__greeter` with `my_greeter`,
`my_` with `my`). Requiring each group to begin with a letter removes all four
cases at once.

**7. New keywords are cheap, but not free.** `trait`, `impl`, `pub`, `import`
and `using` were added to the lexer with no regressions: `trailing`,
`implements`, `public`, `usingx` and `impl_` all still lex as identifiers. But
`impl` was in use as a local variable in two compiler tool files, which had to be
renamed. Every keyword iyi adds is a name taken away from every program; the
count should stay small.

### IV.5 Versioning

Format version in the header, and it is not migrated: a `.iyimod` whose format
number is not this compiler's is rejected and rebuilt. Cross-version metadata
compatibility is a large, permanent surface and there is no reason to take it
on before 1.0.

**What two compilers have to agree on is the release, the target and the
flags.** Every build of iyi 0.1.0 reads every other build's artifacts, on the
same target and under the same flags. That is what makes a module something to
hand to somebody: the artifact is the unit R-1 compiles against, and a unit
only its own build could open would be a cache with extra steps.

The three are one rule and not three. Macros branch on flags, so an artifact
built under one set answers questions differently from one built under
another; object code is a target's; and a release number is what names a
compiler in public.

**A development version keeps the build commit, and that is the same rule
rather than an exception to it.** `0.2.0-dev` is not a release: it names every
compiler between two of them, and two of those can disagree about anything at
all. So `0.1.0` is an identity and `0.2.0-dev+9bcbb359f` is one, while
`0.2.0-dev` on its own is not, and a build that carries it interoperates with
nothing but itself.

A build told no commit at all — compiled outside a checkout, or by something
that does not pass one — has nothing to add, so its `-dev` version stands
alone and is the weakest identity here: it will read another such build's
artifacts. That is the honest end of a best-effort answer rather than a hole
worth closing, because the case it covers is a compiler nobody released and
nobody can name.

The version is iyi's, read from `src/IYI_VERSION` at compile time rather than
from the environment, because two binaries in this repository write artifacts
and an equality test between them cannot depend on how each was invoked.

---

## Part V: Not yet specified

Named honestly, so nobody mistakes this draft for complete.

1. ~~Export metadata format.~~ **Specified in Part IV.** Remaining sub-question:
   the concrete binary encoding, which is engineering rather than design.
2. ~~Trait generics and associated types.~~ **Settled by II.6**: both forms
   exist; associated types for single-answer traits, parameters where multiple
   impls are the point.
3. ~~Trait default methods.~~ **Settled by II.6**: traits supply bodies, with
   their own type parameters and conditional `where` bounds.
4. ~~**Module initialisation order.**~~ **Specified in III.5**: DAG order, a
   relative order between independent modules that is unobservable rather than
   merely unspecified, no `init()`, no import for side effects, and
   initialisation that may not fail. All but "no import for side effects" are
   built, the shuffle that keeps the unobservable order unobservable included.
   That last one is the only rule here with a cost and no measurement.
5. ~~**Concurrency semantics.**~~ **Specified in III.4**: structured
   concurrency so a leak is unrepresentable, cancellation owned by the scope
   rather than threaded through signatures, task failure as an ordinary error
   member, and a `Share` marker that makes a data race a compile error. The
   module-level state question the Kemal port flagged is answered by III.4.5:
   the combination does not compile. Proposed, not built, and III.4.7 names the
   count that has to come first.
6. ~~**Macro cost.**~~ **Measured: see II.10.** Expansion is not a compile-time
   cost worth policing: a template macro is indistinguishable from writing the
   code, and a computing macro costs less per method than defining the method
   does. `macro_run` is the exception, at a fixed +7.4 s per distinct script on
   a cold build. The measurement record has no gaps left.
7. ~~Stdlib naming convention.~~ **Settled by III.1.7(A)**: `!` has left
   identifiers and the mutating/non-mutating pair is `sort` / `sorted`. Settled
   while no stdlib code existed yet, which was the whole point: it is a
   convention the entire library has to be designed around from the first
   commit, and it is now enforced by the compiler rather than left to style.
8. **`defer` semantics.** ~~Ordering of multiple `defer`s in a scope, and
   whether a `defer` may itself propagate with `!`.~~ **Both answered as Go
   answers them, LIFO and no**: LIFO because it is the reverse of acquisition
   order, and no because a `defer` runs while the function is already returning
   (Appendix B #7). Both are built (III.1.4), along with one departure from Go:
   the scope is the block, not the function.

9. **The link step, whose linker.** A warm build is 0.17 s and 0.13 s of it is
   `cc`, which is 76% of the wall clock and the largest single thing left
   (0.1.0 item 2). What it is *not* is iyi's own code. Linking a one-object C
   program on this machine costs the same figure, and of iyi's link, merging
   its eleven objects with `ld -r` costs **0.004 s**. Writing the 36 KB output
   is another 0.004 s. **The remaining 0.12 s is the system part**: `Scrt1.o`,
   `crti.o`, `crtbeginS.o`, `libgcc`, `libgc`, `libc.so.6`, a dynamic linker to
   name and a `.dynsym` to build.

   That decomposition is the whole design question, because an own linker
   inherits the 0.12 s rather than the 0.004 s. Four ways out were priced,
   and then the 0.12 s turned out not to be the link either.

   **Answered: it was the driver, and the compiler now builds the link
   itself.** `cc` takes 0.129 s where the command it would run takes 0.014 s
   with `ld.bfd`, 0.009 s with `ld.gold` and 0.023 s with `ld.lld`: three
   linkers within 14 ms of each other under a driver worth 0.11 s. The
   compiler asks `cc -###` once for the command, caches it as a template and
   runs `ld` from then on; the warm build goes 0.186 s → 0.081 s and the
   linking stage 0.143 s → 0.019 s (0.1.0 item 2). What follows is the
   costing as it stood before that, kept because the four routes are still the
   map, and because (b) and (d) are what is left if the remaining 0.019 s ever
   matters:

   **(a) A faster linker, which the compiler already prefers.**
   `use_modern_linker` looks for `mold`, then `ld.lld`, and passes
   `-fuse-ld=` for whichever it finds. Neither is installed here, so every
   figure above is `ld.bfd`. **Cost: nothing to build.** It is a packaging
   question, it is the first thing to try, and it is the only one of the four
   that needs no design. One wrinkle from this session: the probe's answer is
   cached against `PATH`, so a `mold` installed into a directory already on
   `PATH` is picked up when `PATH` next changes, or when the cache file is
   removed.

   **(b) lld inside the compiler's own process.** The compiler already links
   LLVM, and `lld` is the same project's linker with a library interface, so a
   build could link without spawning anything and without the driver, the
   `collect2` hop and the LTO plugin. **Cost: three to five days**: a C++ shim
   beside `llvm_ext.cc`, translation of the flags the compiler already computes,
   a fallback for platforms without it, and a build dependency on lld's
   libraries pinned to the LLVM version, which is a second version coupling to
   maintain. `liblldELF` is not installed here either, so this cannot be
   measured before it is chosen.

   **(c) iyi's own linker.** The 0.004 s says that merging what iyi emits is
   nearly free; the 0.12 s says everything else belongs to the system part, and
   an own linker has to do all of it: PIE start files, `libgcc`'s archives,
   `libc`'s symbol versions, TLS, `.eh_frame` and its index, RELRO,
   `--gc-sections`, and every dynamic table the loader reads. **Cost: months,
   and a correctness burden that never ends** (lld's ELF port is tens of
   thousands of lines; mold's is larger), for the same 0.12 s that (a) buys for
   the price of a package. Go did this, and Go could: it owns its object
   format, its runtime and its calling convention. iyi owns none of the three
   while it emits LLVM objects and links against libc.

   **(d) Not linking on a rebuild.** Patch the previous executable instead of
   producing a new one, which is where the edit-build loop actually lives.
   **Cost: weeks on top of (b) or (c)**, since it needs an in-process linker to
   patch from, and it is the hardest of the four to be sure of. A stale byte
   in a binary that runs is the worst failure mode in this document.

   **What would change this ranking is one measurement nobody here can take: a
   machine where `ld` is not this slow.** `go build` produces the equivalent
   program end to end in 0.09 s on this machine, so the link alone costs more
   than everything Go does; a native Linux box usually links this program in
   0.01–0.02 s, and at that figure the question is closed by (a) and the rest
   is not worth designing. **The recommendation is (a), then (b) if the number
   survives it, and (c) for no reason this section can find.**

10. **Two compilers at once.** Builds run while other builds were running
    failed at the link, asking for a `_main.o0.o` nobody had written, and once
    with "No such file or directory" out of the object emitter. Neither message
    named the cause, and an hour went into reading linker output for something
    the linker had not done. It was blamed on parallel codegen, because that is
    what the failing builds had in common.

    **Answered: the cache cleaner was deleting a running build's directory.**
    Crystal keeps the ten most recently modified directories in the cache and
    removes the rest, at the end of every compile. A build's directory stops
    looking recent while its units sit in an optimization pass writing nothing,
    so with ten other builds inside that window, one compiler process removes
    the directory another is writing its object files into. Reproduced
    deliberately by removing the directory mid-codegen: the same two failures,
    and the single-threaded path fails the same way, which is what cleared
    parallel codegen of the charge. It was never a race between threads; it was
    a race between processes.

    A build already declares the directory is its own. It holds `compiler.lock`
    there for the whole of codegen and linking, and the cleaner now reads it
    (`cache_dir.cr`, spec in `spec/compiler/compiler_spec.cr`). Checked against
    unpatched Crystal on the same setup: the held directory is deleted there and
    kept here, and an equally old directory nobody holds is still evicted, so
    the cache still shrinks.

    Two smaller things came out of the same hour. A codegen thread that raised
    used to print its exception and leave the build to fail later at the link,
    so the failure is now kept and raised as what it is. And it is worth saying
    what the bug was not: not the artifact's, not iyi's, and not the
    threads'. It is upstream, any Crystal user who builds two things at once can
    reach it, and that is where the fix belongs as well.

    **The same message, a second cause, and this one explains the reports that
    started it.** `Crystal.relative_filename` shortens a path by chopping the
    working directory off the front of it, and it chopped whenever the path
    merely *began with* the directory's name. Build in `/tmp/x/crystal` with a
    cache in `/tmp/x/crystal-cache` — a sibling, not a child — and every object
    file is written to `-cache/…`, which is nowhere. LLVM says "No such file or
    directory" and names nothing, so the build fails exactly as it does when
    somebody deletes the directory. Only a separator makes a prefix a
    directory; it says so now, with a spec in `spec/compiler/util_spec.cr`.

    The cleaner race above is real and reproducible by removing a directory by
    hand while a build writes into it. What it is not is the thing that caused
    the failures that started the hunt, which were runs whose cache directory
    sat beside the working directory under a name beginning the same way. Two
    confident wrong answers before the right one — parallel codegen, then the
    cleaner — and the reason both were possible is that the message named no
    file. `compile_to_object` names it now, and this is the third bug in this
    document found by making an error say what it was doing.

11. **The interpreter. Removed.** Crystal ships one, and the fork inherited it:
    11,377 lines under `src/compiler/crystal/interpreter`, 380 more of libffi
    bindings, 7,981 lines of specs, a CI workflow that builds it and runs the
    standard library's specs under it four ways, and a libffi build dependency
    on every platform.

    **What it was worth here, measured before deciding.** It was already
    compiled out: the Makefile passes `-Dwithout_interpreter` unless asked
    otherwise, so no shipped binary contained it. It cannot run iyi. Given the
    simplest program in `samples/`, it stops on line 12 with `BUG: missing
    interpret for Crystal::ModuleHeader`, which is R-1, the first rule this
    language has. And nobody had noticed: of the 153 commits between the fork
    and this one, **none** touched the interpreter, while the parser, the AST
    and the semantic passes took 7,840 lines of change. It interprets Crystal,
    and the fork stopped writing Crystal a long time ago.

    That is the argument, and it is not about the 11k lines. **An interpreter is
    a second implementation of the language's semantics.** Traits with defaults,
    `impl`, `using`, error unions, `defer`, and the module header all have to
    exist twice or the second copy quietly means something else. The fork is not
    finished changing the language, so the price is not paid once.

    The cost of losing it is one thing, named honestly: compile-time evaluation
    has to start somewhere, and `macro_run` still costs +7.4 s per script
    (II.10). But the half that would have been reused is the machine
    (instructions, primitives, memory, casts), and the half that decides what a
    program *means* is `interpreter/compiler.cr`, 3,550 lines that would have to
    be rewritten for iyi whatever happened. It is in the history, one
    `git revert` away, and it will be a better starting point when there is an
    iyi to interpret.

    What came out: the compiler is 99,253 → **87,421 lines** (11.9%), specs
    211,749 → 203,640, one CI workflow and four interpreter steps in others, the
    `reply` shard, and libffi. The shipped binary does not change size, because
    it never had it. What stays: the *macro* interpreter, which is a different
    thing that runs at compile time and is what makes `{% %}` work.

12e. **The library as an artifact. A measurement, not a plan.** IV.1d ends with
    a daemon that removes about 0.3 s of a `--crystal` build by holding the
    library analysed in a resident process. This document's own thesis says
    something else should be able to remove it: a library is a module, R-1
    compiles a module against declarations, and IV.1 already has a file for
    them. So the question was asked with a stopwatch rather than an argument.

    **The prize.** A generated module the shape of a library — 103,002 lines,
    5,000 exported methods across 1,000 types, bodies in the proportion
    Crystal's own library has them, which is *declarations at about 5% of the
    source*. Consumed from source and then from its `.iyimod`, front end only:

    | | from source | from its artifact |
    |---|---|---|
    | Semantic (top level) | 0.349 s | **0.077 s** |
    | Semantic (type declarations) | 0.043 s | **0.006 s** |
    | front end, all of it | 0.43 s | **0.11 s** |
    | peak memory | 163 MB | **25 MB** |

    Four times faster and six times smaller. Set that beside the daemon on the
    same term: 0.47 s to 0.33 s, one and a half times, *and* 200 MB resident per
    prelude held. The artifact wins on both axes, and it wins the second one in
    the other direction — it spends less memory where the daemon spends more.

    The ratio is not a property of the generator. It follows from declarations
    being 5% of a library's text, which is measured: Crystal's library is
    195,833 lines and about 10,500 of them are a `def` or a type header.

    **What it would take, also measured.** `crystal tool bind` already writes a
    `.iyimod` for a Crystal namespace compiled under Crystal's library (item
    12). Pointed at three of them, it reports how much of the public surface
    crosses with nobody's help:

    | | public methods | crossing unaided |
    |---|---|---|
    | `JSON` | 247 | **90.3%** |
    | `YAML` | 291 | **78.0%** |
    | `URI` | 105 | **58.1%** |

    What the remainder waits on is *named*: the tool prints which types are
    missing and what declaring each unlocks — `IO` +13, `Int` +12, `Tuple` +4,
    and so on. That is a work list rather than a research problem. Those are the
    corrected figures. The note below is what they were, and why.

    > **Asked again, and the work list was flattering the core.** The tool read
    > each restriction as the text somebody typed, and a method inside
    > `JSON::Token` writes `kind : Kind`. That is `JSON::Token::Kind` — the
    > shard's own, already travelling — and it was counted as a type nobody had
    > declared. `self` was counted the same way, and a method returning `self` in
    > `URI` returns `URI` and waits for nobody. Every such spelling pushed the
    > count in one direction: *towards the core*, which is the claim the count
    > was here to support. Published first: `IO` +11, `Int` +11, `Tuple` +4.
    >
    > Restrictions are resolved against the owner now, and the same three
    > namespaces answer differently — this is the boundary the tool can write
    > today, not the percentage above:
    >
    > | | crossing before | crossing now | still waiting |
    > |---|---|---|---|
    > | `JSON` | 142 | **152** | 57 → 47 |
    > | `YAML` | 142 | **158** | 60 → 44 |
    > | `URI` | 41 | **48** | 18 → 11 |
    >
    > The percentages do not move, and that is the check that this changed what
    > it claims to: they measure whether a *human* has to write a signature, and
    > resolving a name somebody already wrote does not change that. 33 more
    > signatures cross, and nothing stopped crossing except two `YAML` entries
    > returning a bare `Array` — which is a correction too, because a
    > declaration that says `Array` without saying of what is not one a consumer
    > can use.
    >
    > **And the work list, once it is true, says one word.** `IO` is first in all
    > three and by more than it was: +13 for `JSON`, +21 for `YAML`, +8 for
    > `URI`. That is 42 signatures against 21 for everything generic
    > (`Slice`, `Tuple`, `NamedTuple`, `Set`) and 20 for the whole numeric tower.
    > About four fifths of what these three ask of the top level is *not*
    > generic — `IO`, `Int`, `Time`, `Float32`, `Float` — which is to say the
    > declaration machinery this tool already has is the machinery that would
    > carry it. The generic remainder is IV.2's problem rather than this one's.

    **And the blocker that is not a percentage.** `tool bind` takes a root
    namespace, and the types every one of those signatures actually names —
    `String`, `Array`, `Int32`, `IO` — are not in a namespace. They are the
    top level. So the missing 10% of `JSON` and the missing 42% of `URI` are
    largely the *same* missing thing, and there is no root to point the tool at
    for it. Crossing a namespace is measured and mostly done; crossing the core
    is unstarted, and it is what everything else is waiting on.

    > **Most of that core was a list, and the list was wrong.** `nameable?` —
    > the question the whole count rests on — asked a literal kept beside the
    > tool: sixteen names said to be what an iyi program already has. It claimed
    > `Void`, `UInt32` and `Float64`, which iyi's prelude never declares, and it
    > left out `Slice`, `Int`, `Tuple` and `NamedTuple`, which `Program#initialize`
    > creates for *every* program before the first line of any prelude is read.
    > Those four were most of what the boundary appeared to be waiting on. The
    > list did not merely understate the answer; it invented the work it was
    > being read to size.
    >
    > It is asked of the program now — `builtin_type_names`, snapshotted where
    > those types are made, so a built-in added later is in it without anybody
    > remembering. What the same four namespaces answer:
    >
    > | | crossing | waiting on a type | taking one no variable can hold |
    > |---|---|---|---|
    > | `JSON` | 152 → **168** | 47 → **13** | 18 |
    > | `YAML` | 158 → **166** | 44 → **32** | 4 |
    > | `URI` | 48 → 48 | 11 → **9** | 2 |
    > | `IO` | 157 → **270** | 140 → **5** | 22 |
    >
    > The percentages do not move, again, and for the same reason. No signature
    > that crossed stopped crossing.
    >
    > **The third column is this correction catching itself.** Written first
    > without it, the table said 182, 168, 48 and 286 — because a name being
    > writable is not the same as a variable being able to hold it. `Int` is the
    > head of a family: a method taking one is compiled once per member, with a
    > symbol apiece and no single symbol to declare. The compiler already
    > answers this, `can_be_stored?`, and it is the same answer that decides
    > whether the keep file this tool generates compiles at all — which is how
    > it was found, by generating one and compiling it.
    >
    > **And pointing it at a class found three things a namespace never did.**
    > The tool assumed its root was a module, because a shard's root is one: it
    > reopened `IO` as `module IO`, and called `IO.write` — an instance method —
    > on the class. It declared `IO::Encoder`, which is private. And it counted
    > the signatures above. None of the three is visible from the counts; all
    > three are visible the moment the keep file it generates is compiled, which
    > is now how this is checked. `crystal tool bind -e IO` writes an artifact
    > and an object file end to end.
    >
    > It carries `IO` itself now, which took saying the difference out loud: a
    > module's own methods *are* module functions and a class's are its type's,
    > so a class root travels as one declaration holding everything under it —
    > `IO`, with `IO::Memory` and twelve more inside. 14 types, 148 methods, and
    > 311 symbols in the object file. What still stays behind is its constants,
    > which cross as functions whose symbol comes from `extend self`, and only a
    > module has that.
    >
    > Finding this also fixed something the shard path had all along: the keep
    > file never descended into nested types, so a nested declaration promised
    > symbols nothing emitted. `JSON`'s artifact holds 16 types and the file
    > reached 9 of them. It was a link error waiting rather than a compile one,
    > which is why no sample had found it.
    >
    > **`IO` is the whole of what is left, and `IO` is nearly done.** It is the
    > only name still blocking all three namespaces — 14, 22 and 9 — and pointed
    > at directly it is 442 public methods, 80.3% of them needing no human, with
    > five signatures waiting: `Time::Span` and `File::Info`, and nothing else.
    >
    > **And then the boundaries compose, which is the measurement closing.**
    > `tool bind` reads the artifacts already written — `--use-iyimod`, the same
    > switch a build uses — and a signature naming one of their types waits on
    > nobody. Each name is checked against the program rather than trusted,
    > because a class root's declarations are absolute and a module root's are
    > relative to a name the file does not record.
    >
    > | with `IO`, `Time` and `SemanticVersion` bound | crossing | waiting |
    > |---|---|---|
    > | `JSON` | 168 → **181** | 13 → **0** |
    > | `YAML` | 166 → **192** | 29 → **2** |
    > | `URI` | 48 → **55** | 7 → **0** |
    >
    > And the unlock report predicted it exactly. `JSON` reads `IO +13` and
    > gained 13; `URI` reads `IO +7` and gained 7; `YAML` reads `IO +20`,
    > `Time +5`, `SemanticVersion +1` and gained 26. The prediction is made by
    > counting what one declaration would free and the result by actually
    > freeing it, so the two agreeing is worth more than either — it is the
    > report and the composition checking each other.
    >
    > `Time` and `SemanticVersion` bind the same way — 446 public methods at
    > 86.1% and 22 at 95.5%. A `JSON` boundary written against `IO`'s is 16
    > types, 140 methods and 301 symbols, and its keep file compiles.
    >
    > **What is left, with all three bound and the count finally saying only
    > what it means.** A name that is not a type is not work, and counting `T`,
    > `self` and `_` beside `IO` said there was more waiting than there was —
    > the same inflation as the list, one layer further in. Split apart:
    >
    > | | crossing | waiting on a type | no variable can hold | not a type | block unannotated |
    > |---|---|---|---|---|---|
    > | `JSON` | **181** | **0** | 18 | 0 | 0 |
    > | `YAML` | **192** | **2** | 4 | 3 | 1 |
    > | `URI` | **55** | **0** | 2 | 1 | 1 |
    >
    > **And an artifact nothing had ever read back.** Every check this tool
    > carried was a number it printed, and a number cannot say whether anything
    > can consume the artifact printed beside it — so nothing did, and the first
    > spec written for it failed. Three things were wrong and all three are the
    > same sentence: *what an artifact declares belongs to the artifact.* A
    > module root kept the producer's prefix (`MyLib::Entry` with no `MyLib`,
    > because an iyi module path camelcases back to `Mylib` and `JSON` is not in
    > that mapping's image at all); a field crossed as `IO+`, which is dispatch
    > and not a name; and a reference to another boundary used the producer's
    > name where the consumer's was needed. A `JSON` boundary written against
    > `IO`'s is consumed by `import json` on its own now.
    >
    > **And then it linked, and the last step named its own limit.** A program
    > built from a bound shard runs: `MyGreeter.polite` called from iyi through
    > the four steps this tool prints, which had never been taken end to end
    > before and did not work when they first were. Two of the fixes were the
    > printed commands themselves — an unquoted `$(...)` that split every symbol
    > containing a space, and a module name made by `downcase` where the inverse
    > of `camelcase` was wanted.
    >
    > That second one is the whole constraint, once it is seen. Both sides mangle
    > alike — the premise the boundary rests on — so `Greeter.polite` is
    > `*Greeter@Greeter::polite<String>:String` from either language *only if the
    > consumer's module is `Greeter`*. A consumer builds that name by camelcasing
    > the path it imported, so the path has to be `camelcase` run backwards.
    >
    > **And what was written here first said an acronym could never be, which was
    > wrong.** The claim was that the mapping's image is names like `Greeter` and
    > `MyGreeter`, that `JSON`, `YAML`, `URI` and `HTTP` are outside it, and that
    > the library-as-artifact thesis waited on a question about iyi's module
    > paths. None of that is true, and the mistake was reaching for
    > `String#underscore` and then reasoning about *its* image instead of
    > `camelcase`'s. `underscore` answers `json` for `JSON`, and `json`
    > camelcases back to `Json` — but `camelcase` starts a group at every
    > upper-case letter, so the inverse of `JSON` is `j_s_o_n`, which is a legal
    > iyi path and comes back whole. So is `u_r_i`, and `h_t_t_p_server` for
    > `HTTPServer`, which `underscore` had flattened to `http_server` and lost.
    >
    > A shard named `ABC` links and runs. The wrong sentence stood for one commit
    > and named a language question that did not exist; what it was really
    > describing was a one-line inverse written with the wrong function.
    >
    > **And a second name mismatch under it, found the same way.** A module
    > written `extend self` puts its functions on the module and mangles
    > `*Widget@Widget::polite<String>:String`; one written `def self.polite`
    > puts them on the metaclass, and that has no `@`. The tool recorded both as
    > the first, so every `def self.` in a shard declared a function the consumer
    > called by a name nothing emitted. Crystal's library is written the second
    > way throughout, which is why nothing smaller than `JSON` had shown it.
    >
    > **What `JSON` still waits on is not a name but an instantiation.** With
    > both mismatches gone the two sides agree on `*JSON::parse<...>` — and
    > disagree inside the angle brackets: the producer's keep file passes the
    > declared parameter, a `(String | IO)` union, and gets
    > `<(IO+ | String)>`, while a consumer passing a string literal gets
    > `<String>`. A method's symbol carries the types at its *call site*, so a
    > union parameter has one symbol per way of calling it and a keep file forces
    > only the one it names.
    >
    > The file names all of them now — the product of the parameters' shapes,
    > which measures smaller than it sounds: a union parameter is about one in
    > twenty, 7 of `IO`'s 103 and 1 of `JSON`'s 53, so two in one signature is
    > rare and the product stays small. `JSON.parse("...")` called from iyi links
    > and the symbol is there.
    >
    > **And past the names, a hole that no name check would have found.** With
    > every symbol matching, `Store.plain(41)` answers 42 and
    > `Store.from_constant(1)` segfaults. Crystal initialises a constant from
    > `__crystal_main` and compiles the reads unguarded; the consumer has its own
    > `__crystal_main` and never calls the shard's, so the constant stays null.
    > `LIMIT = 10` survives because the compiler folds it; `TABLE = ["a", "b",
    > "c"]` has to be built at run time.
    >
    > **Written here first as a silent wrong answer, which it is not.** The exit
    > status being read was a `printf`'s rather than the program's — a mistake in
    > the measurement and not in the compiler, and the second one of that shape
    > this section has had to record. It crashes, loudly, on the first read.
    >
    > **And running the shard's initialisation does not fix it.** Renaming
    > `__crystal_main` out of the way with `objcopy --redefine-sym` and calling
    > it from the consumer segfaults *inside* the initialisation, before reaching
    > any constant: Crystal's top level expects Crystal's runtime — a thread, an
    > event loop, the exception machinery — and an iyi program, whose whole
    > prelude is 1,053 lines, is not one. So this was never about naming the
    > constants in the artifact, which is what it looked like from the outside.
    >
    > **And the other direction closes it.** A consumer built with `--crystal`
    > *is* a program with Crystal's runtime, which is what the shard's
    > initialisation was missing — so that ought to be the answer. It is not:
    > the link then fails on `Crystal::Hasher::seed`, `Thread::threads`,
    > `Fiber::fibers` and every other runtime global, defined once by the
    > consumer and once by the shard.
    >
    > So the two failures are one fact seen from either side. **The object this
    > pipeline makes is a whole program**, because a keep file is compiled like
    > one, and it carries the library with it. A program can have that library
    > once: without it the shard's state never starts, with it nothing links.
    > Neither the names nor the constants were ever the problem — the packaging
    > was.
    >
    > That is a sharper statement than "a boundary carries code that needs no
    > initialisation", and it names what would change it: the shard has to be
    > compiled the way `.iyimod` already compiles an iyi module — object code per
    > unit, against a library left external — rather than as a program somebody
    > then picks symbols out of with `nm`. `ObjectCode` is in the format for that
    > reason and `tool bind` does not write it.
    >
    > **And that was tried, one type of it, which is the cheapest question that
    > separates a wall from a work list.** An ordinary build of the keep file —
    > not `--emit obj`, which merges everything into one object — leaves 363
    > per-type units in the cache, one of them `Store`'s. Linked into an iyi
    > consumer on its own it gives a *clean* failure rather than a collision or a
    > crash, and the whole of what it asks for is twenty symbols:
    >
    > | | |
    > |---|---|
    > | type ids | 15 |
    > | constants | 4 |
    > | a main-module helper | 1 |
    >
    > Every one is a category the format already carries a section for —
    > `TypeIds`, `Constants`, and the helpers item 12d has the consumer emit with
    > its own numbering — and `tool bind` writes all three empty. The unit itself
    > carries no runtime, exports its method already global (so the `objcopy`
    > step is not needed at all in this shape), and leaves `Store::TABLE`
    > undefined for the consumer to define, which is exactly the arrangement that
    > makes an initialiser run in the right program.
    >
    > **The remaining catch is named rather than guessed at.** Four of those
    > constants are Crystal's own — `Int::DIGITS_BASE62` and its neighbours,
    > reached because `Array#[]` can raise and raising formats an integer. A
    > consumer can only define them if it has Crystal's `Int`, which is the
    > library-as-artifact question again. But it arrives here as twenty symbols
    > in three known categories rather than as a duplicate runtime, and that is a
    > different kind of problem to have.
    >
    > **And then the work list was worked, and it runs.** `--emit-bind` on the
    > keep file's build puts the per-type units into the artifact, with the type
    > ids and constants they refer to, using the collectors an iyi module's
    > artifact has always used. A consumer links what the artifact carries. So:
    >
    > ```
    > crystal tool bind -e ABCGreeter --emit-bind mods shard.cr
    > crystal build --iyi-keep ABCGreeter --emit-bind mods -o keepbin abc_greeter_keep.cr
    > iyi build --crystal --use-iyimod mods -o app app.iyi
    > ```
    >
    > That program prints what the shard returns. **Two commands, no `nm` and no
    > `objcopy`**, where the four printed steps had been and had never worked.
    > `spec/compiler-cli/bind-pipeline_spec.cr` runs it, and needs no binutils to.
    >
    > `--crystal` on the last line is the other half of what was learnt: the unit
    > numbers `Pointer(LibUnwind::Exception)` whatever the shard does, because a
    > `String#+` can raise. So the artifact is marked `crystal_library: true`,
    > which it always was — it was written `false` on the argument that a
    > boundary stands *between* Crystal's library and the consumer, and that
    > argument does not survive looking at what the unit refers to.
    >
    > **And the constants cross too, which was the last of it.** A constant
    > travels by *name* so its initialiser runs once, in the program that will
    > read it — and a name was only half, the half a bound shard was missing. Its
    > unit refers to `Store::TABLE` and defines nothing. So the assignment
    > travels as well, in the artifact's initialiser, which the reader renders
    > last and inside the module: `TABLE = [...]` under `module store` is
    > `Store::TABLE`, in the namespace the shard wrote it in and built by the
    > consumer's own program.
    >
    > `Store.word(1)` answers `one`. Two turns earlier the same call segfaulted
    > on the first read, and the turn after that it was refused by name. Its own
    > constants only: a unit refers to Crystal's as well — `Int::DIGITS_BASE62`,
    > reached because `Array#[]` can raise and raising formats an integer — and
    > those belong to the library the consumer already has.
    >
    > **And then it was given, because the premise was wrong.** iyi takes an
    > `enum` — the language has one, the compiler makes the type — and what it
    > did not take was `pub enum`, so a module could declare one and never hand
    > it out. The claim below that iyi has no enum came from grepping the prelude
    > and finding none, which is a fact about the prelude and not about the
    > language. `pub` takes one now, an artifact carries its members and the
    > integer they are numbered on, and an iyi program calls
    > `Store.bigger(Store::Kind::Large)` and is answered `true`.
    >
    > The numbers are read from what the compiler assigned rather than
    > renumbered: the object file the consumer links is what gave them their
    > numbers, and a boundary that renumbered would agree with it by luck.
    >
    > **A private type travels as private, which is a third thing from
    > travelling and from being dropped.** `JSON::PullParser` holds an
    > `Array(ObjectStackKind)`, so its object code numbers
    > `Pointer(ObjectStackKind)` — a consumer has to *number* a type it must
    > never *write*. Declared without `pub`, both are true at once. Dropping them
    > was the first answer, and the only thing that said otherwise was `ld`.
    >
    > **`JSON` binds whole now**: 21 units, 11.4 MB, 116 type ids, 28 constants,
    > with `JSON.parse` among its functions once `IO` is bound first. What it
    > does not yet do is *run*, and the reason has moved again — `--iyi-keep IO`
    > forces the whole of `IO`'s surface, and the keep binary that results does
    > not link, on `Crystal::EventLoop::Polling` internals a demand-driven build
    > would never have reached. The units are written after a successful link, so
    > `IO`'s artifact stays empty of object code. `--cross-compile` skips the
    > link and emits no per-type units either.
    >
    > That is the next thing, and it is about *when* the units are taken rather
    > than about names or types: a boundary needs the objects, not the program
    > they would have linked into.
    >
    > **So it does not link.** A build carrying both `--iyi-keep` and
    > `--emit-bind` exists to fill a boundary, and the keep file is not a program
    > anybody runs. `IO`'s artifact fills — 18 units, 14.8 MB, 92 type ids — and
    > every boundary build stops paying for a link nobody wanted.
    >
    > **And then the thing that had been measured turned out to be the wrong
    > thing.** `IO` and `JSON` are Crystal's library, and a consumer built with
    > `--crystal` *has* Crystal's library: `require "json"` and
    > `JSON.parse("[1,2,3]").as_a.size` answers 3 with no artifact anywhere near
    > it. Binding them measures how well a boundary can hand a program something
    > it already has.
    >
    > What a boundary is for is a **shard** — a library the consumer does not
    > have — which is what `tool bind -e Kemal` was written for and what the
    > fixtures in `bind-pipeline_spec.cr` are shaped like. Those cross whole:
    > functions both ways round, a union parameter, constants at the root and
    > inside a type, an enum, and a nested type with its own methods.
    >
    > For the library itself the artifact's value is *speed* rather than reach,
    > and that is 12e's question, measured at the top of this item — not
    > something the last few turns were testing.
    >
    > > **So it was asked of a shard, which is what a boundary is for.**
    > > `bench/bind_speed.py`, and the first thing it found was that `Kemal`
    > > cannot be bound at all: its object code numbers
    > > `Array(Radix::Node(Array(Kemal::FilterHandler::FilterBlock)))` — a
    > > generic instance from *another shard* — and a generic travels as bodies
    > > rather than as declarations. Binding `Radix` first does not help: it is
    > > generic throughout and its artifact carries no types. That is IV.2's
    > > problem arriving where a real library keeps it.
    > >
    > > What `tool bind` does say about `Kemal` is worth keeping: 254 public
    > > methods, **93.3% needing no human**, 26 types carrying 63 methods, and
    > > 31 units of object code.
    > >
    > > So the speed question went to a generated shard of stated size, and the
    > > answer depends on one thing:
    > >
    > > | shard | from source | from its boundary | |
    > > |---|---|---|---|
    > > | 2,167 lines | 1.11 s | 1.13 s | costs 2% |
    > > | 10,087 lines | 1.31 s | 1.20 s | saves 9% |
    > > | 29,767 lines | 1.94 s | 1.72 s | **saves 11%** |
    > >
    > > A boundary pays once compiling the shard is a real share of the build,
    > > which here is somewhere near ten thousand lines, and the share grows with
    > > size. Below that it costs a little: reading a megabyte of artifact and
    > > linking twenty objects is not free, and there was nothing to save.
    > >
    > > **And then the generics, which is what `Kemal` had stopped on.** IV.2
    > > already says what a generic does: its methods exist once per
    > > instantiation, the instantiations belong to whoever writes them, and the
    > > bodies travel as source in `MonoBodies`. `tool bind` was not using it —
    > > it skipped a generic type in three places — so `Radix` carried nothing
    > > and `Kemal` waited on a type nobody had declared.
    > >
    > > It carries them now, declaration and bodies both, and a generic crosses:
    > > `Bag.wrap(7).item` answers 7 from a consumer that compiled
    > > `Holder(Int32)#item` itself, out of source the producer sent. `new` stays
    > > behind because it is synthesized from `initialize` and a carried one
    > > would meet the consumer's own at the linker — which IV.2 had already
    > > written down.
    > >
    > > **A generic with no methods travels too**, and that was the second thing
    > > wrong: an empty one was dropped, when naming is itself what a consumer
    > > may need. `Kemal` refers to `Array(Radix::Node(...))` and calls no `Node`
    > > method. `Radix` carries three types now where it carried none.
    > >
    > > What a generic's methods must have is a **written return type**. The
    > > trick that rescues an ordinary method — instantiate it on purpose and
    > > read what comes back — has no single answer when the owner is generic, so
    > > 20 of `Radix`'s 33 methods stay behind. That is R-2 landing hardest
    > > exactly where inference cannot help.
    > >
    > > **`Kemal` still does not link, and the reason has moved again**, which is
    > > the fourth time in this item. It is no longer a generic: it is that a
    > > bound shard's `require`s do not travel. `Radix`'s units number
    > > `Hash(String, HTTP::Cookie)`, and a consumer whose prelude is Crystal's
    > > still has to `require "http/cookie"` before it can name one. The format
    > > carries `Requires` for precisely this — 12d put it there — and `tool
    > > bind` does not write it.
    > >
    > > **The first version of this measured nothing, and why is the useful
    > > part.** Its consumer called one method. Codegen is demand-driven, so a
    > > consumer that reaches one method has the compiler emit one — and a
    > > 30,000-line shard cost the same as a 2,000-line one, because 28,000 lines
    > > of it were never compiled by either arm. What a boundary saves is
    > > compiling *the code somebody uses*, so a benchmark that uses none of it
    > > measures its own consumer. The consumer calls all of it now, and the
    > > source arm scales with the shard where before it was flat — which is how
    > > the mistake was visible at all.
    >
    > One thing binding the library did leave behind, and it is only reachable
    > from there: a *class*-rooted namespace collides with its own wrapper. The
    > artifact's declarations are wrapped in `module <path>`, and for `i_o` that
    > path camelcases to `IO` — which is a class, so reopening it as a module is
    > refused. A module root has no such problem, and a shard's root is one.
    >
    > **What `JSON` waited on, before that**, was written here as "iyi has no
    > `enum`" and that was wrong. With the units, the type ids and the constants
    > travelling, `JSON` bound to 19 units and stopped on `JSON::PullParser`'s
    > `ObjectStackKind` — and the reading of it was that the language had no such
    > type, so nothing on the far side could declare one. That came from grepping
    > the prelude and finding no enum in it, which is a fact about the prelude.
    > The language takes one, and a two-line program says so.
    >
    > What was actually missing was smaller and further in: `pub` did not take an
    > enum, so a module could declare one and never hand it out. Being wrong
    > about which of those it was cost a turn, and the shape of the mistake is
    > the one this document keeps recording — a claim about a language read off
    > the contents of a directory.
    >
    > One nested inside a type under the root crosses as well, written
    > `Inner::X = ...`. That was left out for a turn on the reasoning that a
    > qualified assignment reopens rather than defines — a guess, and wrong:
    > Crystal takes one wherever the namespace exists, and the declarations
    > rendered above this text are what make it exist. Two lines of experiment
    > would have said so, which is the whole argument for running them.
    >
    > A boundary carries code that needs no initialisation. That is the bound on
    > it today, and it is a larger claim than the earlier paragraphs implied.
    >
    > What still falls outside is a name the grammar cannot spell — `Foo_Bar`
    > needs two underscores running and `camelcase` reads two as one, so it comes
    > back `FooBar`. `tool bind` says so at bind time rather than leaving it to
    > `ld`, which is what the check was worth keeping for.
    >
    > `JSON` and `URI` wait on nothing anybody could declare. `YAML` waits on
    > `Set`, which is generic, and generics travel as bodies rather than as
    > declarations — IV.2's problem and not this one's. The middle column is
    > empty of work.
    >
    > The last column is the end-to-end check earning its place a second time. A
    > block-taking method is compiled per block *type*, so one whose block nobody
    > annotated has no single symbol; `infer_return` already refused those, but
    > only when it ran, and a method that writes its own return type never
    > reaches it. Nothing in the counts showed it. `Time`'s keep file did, by
    > refusing to compile: *`Time.measure` is expected to be invoked with a
    > block*.
    >
    > So the paragraph above is wrong in its last sentence and the correction is
    > worth more than it was. Crossing the core was not unstarted work that
    > everything was waiting on. It was a hand-written list claiming that
    > everything not in it was somebody's work to do — the same shape as the
    > prelude cache key in IV.1d, and found the same way, by asking what the
    > claim was resting on.

    **What this decides.** Not that the daemon should go — it works, it is
    tested, and it is what exists. It decides which of the two is the thing to
    build next, and the numbers are not close: on the term they both address the
    artifact is three times better and costs memory instead of spending it. The
    daemon is the answer a compiler reaches for when it has no file format. This
    one has a file format.

12d. **The ecosystem and R-1, together.** Item 12a ends by saying what stood
    between a program and having both. Three things did, and they turned out to
    be one thing asked three times: *a name in the module's object code that
    only the consuming program can define.*

    That is not a new question. `TypeIds` and `Constants` are already in the
    format because of it — a type id belongs to the program rather than to the
    module, so the module carries the *name* and the consumer supplies the
    number. Everything below is that rule, applied where it had not been.

    - **The main module's helpers.** `~match<IO+>` was the symbol. A unit that
      travels calls it and an artifact carries the unit, not main. Copying it
      would have been wrong for a reason worth stating: a match against a
      virtual type compiles to a comparison against a *range of type ids*, and
      those are the producer's numbers. A copy would have compared the
      consumer's ids against the producer's range and answered wrongly, with
      nothing to see. So the consumer emits them, with its own numbering,
      exactly as it emits every type-id global — all of them rather than the
      ones an object file asks for, because a build cannot see inside an object
      file, and each is two compares.

      This is what 12a's pure/stateful split got wrong. Purity was never the
      question; the question was whose numbering, and once it is asked that way
      the stateful helpers need no separate answer either — a constant's
      initialiser already runs once, in the consumer, because `Constants`
      already carries the name rather than the code.

    - **The module's requires.** A module that requires `uri` is compiled
      against `URI`, and its object code refers to `URI::Error.class:type_id`.
      A consumer that required only `json` has no such type to number, and the
      link fails on a name from a library nobody in the program ever asked for.
      So the requires travel — `Requires`, format v20 — and the consumer
      replays them, which makes its program a superset of the producer's. The
      numbering is still the consumer's, so this adds types and imports nobody
      else's ids.

    - **The `!dbg` location**, which 12a already fixed.

    **One thing had to be measured rather than argued.** A shared library is
    only shared if there is one copy of its state, and "it linked" would be
    just as true of a program with two copies of a lazily initialised constant
    — a program that is wrong and says nothing. It is one copy: `STDOUT` and
    `PROGRAM_NAME` are the same object on both sides of the boundary. The same
    compiler mangles the same names, the linker folds the definitions, and a
    lazily initialised constant goes through the global the consumer defines.
    Both identities are asserted in the specs, because that is the property,
    not a detail of it.

    **What is refused now is a different thing, and it is sharper.** An
    artifact records which library it was built against, and importing across
    is refused by name in both directions. This one is not a limitation to be
    lifted later: both worlds are compiled by the same compiler and mangle the
    same names, so a mixed program would link — on the names that happen to
    agree. `String` is a different type in each, and neither the linker nor
    anything after it would say so.

    **What it buys, measured rather than claimed.** A program can require Kemal
    *and* compile its own modules against their declarations, which is the
    combination the two features were each half of. The speed it buys is
    small, and saying so is the point of measuring: on a twelve-module app
    (656 lines, each module importing the last) with Crystal's library,

    | build | time |
    |---|---|
    | `require "json"` and nothing else | 3.12 s |
    | twelve modules from source | 3.28 s |
    | twelve modules from artifacts | 2.96 s |

    The modules cost 0.16 s from source and nothing from artifacts. Everything
    else is the library, read from source every build, and R-1 does not reach
    it. With Kemal in front the same twelve modules move a 4.4 s build to
    4.7 s — *slower*, because reading twelve artifacts and linking twelve
    object files is not free either, and there is only 0.5 s of module in front
    of 4 s of shard to pay for it.

    So: under iyi's own prelude the library costs 0.03 s and the artifact is
    the whole build; under Crystal's it costs 3 s and the artifact is a
    rounding error. The capability is what item 12d delivers. **The fixed cost
    of the other library is now the largest number in this document, and it is
    the next thing worth attacking** — not by making artifacts better, which is
    finished work, but by asking whether a library that every build reads from
    source has to be.

12c. **Portability, moved from compiled to run.** An iyi program produced code
    for eight targets and was tested on one, which is the weakest kind of
    portability claim: the code generator not objecting. Three of the eight now
    run in CI every build — x86-64 glibc natively, x86-64 musl in an Alpine
    container, aarch64 under emulation — and the check is that each prints what
    the same program printed on the machine that compiled it.

    What makes it cheap is the same thing that makes an artifact linkable: the
    object is produced here and linked there with the target's own `cc` and
    `libgc`, which is the command `--cross-compile` already prints. An iyi
    program needs no more of a target than a C toolchain and a collector.

    Darwin and Windows are the five still unrun, and they need a linker and a
    runtime this workflow does not have.

12b. **What the library costs at run time, and the flattering answer that was
    wrong.** The tagline says Performance, and until now every number under it
    was about compiling. `bench/runtime.py` runs the same program under both
    libraries — same LLVM, same GC, same settings — and the first reading was
    that iyi's string building is **twenty times faster**. It is not. With
    `GC_DONT_GC=1` it is **1.64x slower**, and the whole of that twenty was the
    collector: a 17 KB binary has far fewer roots to scan than a 972 KB one, so
    a program that carries less collects faster. That is a real effect, it is
    the efficiency claim, and it is not a claim about `String`.

    What the honest column says: arithmetic and array work are within noise
    (0.97x, 0.90x), `String` is behind (1.64x), and `Hash` is ahead by 6x while
    doing less — iyi's does not preserve insertion order and Crystal's does.

    Kept here because the mistake is the point. A benchmark that measures a
    program and reports a library is the easiest way to publish a number that
    is true and means nothing, and the only defence is to take the thing being
    credited out and run it again.

12a. **The other answer, which is smaller.** A shard behind a generated
    boundary is one way to reach the ecosystem. The other is to give the
    program Crystal's standard library and compile the shard into it, and it
    turned out to be two small changes rather than a project.

    `require` was refused in a `.iyi` file, and the reason given was "there is
    no standard library to require: the prelude is what a program gets". That
    is true of iyi's prelude and of nothing else. `--crystal` builds a program
    against Crystal's, and there `require` means what it means in Crystal. A
    `require` also comes out of the module a header desugars to, the way
    `import` does: it is a directive about which files a build reads, and
    leaving it inside made json's `class String` mean `Site::String`.

    **The rules do not change with the library.** The module header, `pub`,
    `import`, `using`, traits, `impl`, R-2 on exports: all of them, on a
    program that requires Kemal. What changes is what a program *has*.

    **Swept across nine shards**, each built twice — as an iyi program and as a
    Crystal one, so that a difference is iyi's and a shared failure is
    the ecosystem's: `kemal`, `db`, `ameba`, `habitat`, `baked_file_system`,
    `radix`, `sqlite3`, the standard library's own `json`/`yaml`/`uri`/`http`,
    and a program that round-trips `JSON::Serializable`, parses YAML and writes
    a file. All nine behave identically in both languages. A Kemal server
    written in iyi serves HTTP.

    **One adaptation, and it is R-2 asking its question.** `habitat`'s macro
    resolves the type it was handed by name, and a class an iyi module left
    unmarked is private, so the macro could not find it. `pub class` fixes it —
    correctly, since a macro from another module reaching your type is exactly
    what `pub` governs.

    The message was `undefined macro method 'Path#constant'`, which names
    neither the type nor the rule. It is a fact about the compiler: an
    unresolved path stays a `Path`, and every method a macro would call on the
    type is undefined on that. **Fixed**: a macro method missing from a `Path`
    now asks whether the path names a type that exists and is unexported, and
    says so when it does. Only then — every other unresolved path keeps the
    message it had.

    **And then a real one was written**, because nine compiles are not nine
    programs: a small JSON API over Kemal, two iyi modules, storage in one and
    routes in the other. Creating, listing, fetching, and a miss answered
    `{"error":"no note 99"}` with a 404 — the miss travelling as `Note |
    NotFound` with an `impl Error for NotFound` on it, which is iyi's error
    union carrying a Kemal response. It found nothing of iyi's. The one thing
    it did find belongs to Crystal and reproduces there:
    `halt env, response: {error: found.message}.to_json` does not parse,
    because a `{` after a named argument in a call without parentheses is read
    as a block. A variable on the line before it is what a Crystal programmer
    writes too.

    **III.1.7(A) meets the standard library, and the bill is 49 names.** `!`
    left identifiers so that postfix `!` could mean propagation, and Crystal's
    library did not: `not_nil!`, `sort!`, `map!`, `select!`, `uniq!` and 44
    more cannot be called from a `.iyi` file. What comes back is not a mystery
    — `a.sort!` says "`!` has no error to propagate: no member of
    `Array(Int32)` implements `Error`" — and the replacements are what Crystal
    writes anyway: `a = a.sort`, `if home = maybe`, `maybe.as(String)`. Shard
    code is `.cr` and unaffected, so this is a rule about the lines somebody
    writes rather than the ones they depend on.

    Worth stating plainly because the convention was chosen (III.1.7) against a
    library iyi was going to write itself. It now also has to sit beside one it
    did not, and that is a cost the choice did not price.

    **And the prelude was not following its own rule.** `Array#sort` returned a
    copy and nothing mutated, which is Crystal's meaning under iyi's name. It
    sorts in place now and `sorted` is the copy, as III.1.7(A) says. The
    consequence is worth being blunt about: `a.sort` sorts here and copies
    under `--crystal`, silently, because Crystal calls the mutating one
    `sort!` and that name cannot be written here. It is the one call in this
    prelude that changes meaning with the library, it is noted in
    `src/iyi/array.iyi`, and `samples/iyi/basics.iyi` prints both halves.

    **What it costs.** R-1, for the required shard: it is read from source and
    the edit loop pays for it the way Crystal's does. The other cost — that a
    program could not have Crystal's library *and* its own modules as
    artifacts — was the sharpest limit here and is gone; item 12d is how.

    **Why, exactly — the first answer here was wrong.** It said the two builds
    would have "two of everything", which is not what happens. Taking the
    refusal out and looking:

    - The first failure was an LLVM module that would not verify: "inlinable
      function call in a function with debug info must have a !dbg location".
      The reads a consumer performs on an artifact's behalf (IV.1g) were
      synthesised without a location, and a call with no location inside a
      function that has debug info is invalid. Under iyi's own library the
      constants involved never landed in such a function; under Crystal's,
      `STDERR` and `String::CHAR_TO_DIGIT` did. **Fixed**: the reads carry the
      artifact's own path.
    - What is left is structural. A unit that travels can call helpers the
      compiler defines in the *main* module — `~match<IO+>` is the one that
      showed up — and an artifact carries the unit, not main. There are ten
      such helpers: type matching, constant reads and initialisers, class
      variable reads and initialisers, and a few more.

    **And the split proposed here was the wrong one.** It said the pure helpers
    could be copied into each unit and the stateful ones had to travel as
    names. Item 12d is what happened when that was tried: the axis is not
    purity, it is whose numbering — and the answer is the same for all of them.

12. **The Crystal ecosystem, and what a shard would cost.** Ten thousand
    shards exist and none of them is written to iyi's rules, so "run them
    directly" is not a compatibility problem, it is the four rules: `require`
    against R-1, inference against R-2, monkey patching against R-3, and
    Crystal's 8,161-line standard library against a 1,184-line prelude.

    What is measurable is narrower and better than that framing suggests, and
    it was measured on **Kemal 1.12.0**, which compiles under this compiler
    unchanged, dependencies and all.

    **What the surface looks like.** `crystal tool bind -e Kemal` reads a
    shard and sorts its public methods three ways: written down already,
    writable by a machine, and needing a human. Kemal's 273 come out 74, 182
    and 17. The machine's share is not a guess — the tool instantiates each
    method whose parameters carry types and reads what it returns, which
    answered **125 return types nobody had written**. The 57 it refused are
    mostly honest: 40 take a block, and what a block-taking method returns
    depends on the block.

    **What blocks the rest.** 95 signatures can be written today; 104 wait on
    a type an iyi program cannot name, and the tool sorts those by what each
    one would unlock. `HTTP::Server::Context` is first and unlocks 16, then
    `IO` (9), `HTTP::Handler` (6), `Radix::Tree` (5). **Eight declarations
    unlock 49 of the 104.** That the head of that list is `Context` is the
    same answer the hand port reached in `samples/iyi/kemal/`: the framework's
    whole user-facing surface hangs on one type.

    **What crosses, measured.** The compiler is the same compiler, so a
    Crystal object links into an iyi program and the standard library works
    inside it: a `fun` calling `{"a" => 1}.to_json` answered correctly from an
    iyi `puts`. Objects cross too, because `String` is the *compiler's* type
    in both worlds — the prelude reopens what `Program#initialize` laid out.
    Two things do not cross by themselves, and both were found by trying:

    - **A separately compiled object brings its own runtime state.** Its
      `Crystal::Once`, `Thread` and `Fiber` are not the host's, its constants
      are filled by its own `__crystal_main`, and nothing runs it: reading one
      constant segfaults. The fix is mechanical and is the shim a generator
      writes — `fun shard_init(argc, argv)` calling `Crystal.init_runtime` and
      `Crystal.main_user_code`, with the object's own `main` localised so the
      host keeps the entry point. With it, a constant and a class variable both
      answer correctly.
    - **Layout is shared and invariants were not.** Crystal reads `@length == 0`
      on a non-empty string as "not counted yet" and scans; this prelude
      returned the field. So a string built by Crystal's `to_json` printed
      correctly through iyi's `puts` and answered `size` **0**. No error, a
      wrong number. **Fixed**: `String#size` counts when the field is unset,
      which is free for every string this prelude makes itself, because it
      fills the field. The same call now answers 7.

    **What crosses is more than a `fun`, and this is the finding the rest
    rests on.** The two sides mangle names identically, being one compiler:
    `Lib::Greeter.polite(String) : String` compiles to
    `*Lib::Greeter@Lib::Greeter::polite<String>:String` from Crystal source
    and from iyi source alike. So the boundary needs no C ABI at all. Measured
    end to end: a `.iyimod` written by `--no-codegen` (declarations, no object
    code), an object compiled from Crystal source with its symbol globalised,
    and an iyi program built with `--use-iyimod` against the first and linked
    against the second. It passes an iyi `String` in, gets one back, and
    prints it. `lib`'s C-types-only rule is not in the way because nothing
    goes through `lib`.

    **Where this is going.** `lib` carries C types only — Crystal's own rule,
    and it refuses `String` — so a real API cannot cross that way. It does not
    have to: an artifact already carries declarations *and* object code, and a
    shard compiled once with generated declarations is the same shape as a
    `.iyimod`. That is the boundary worth building, and R-1 is what makes it
    cheap: the shard is compiled once and the edit loop never reads it again.

    **Built far enough to run Kemal's own code.** `crystal tool bind
    --emit-iyimod` writes the artifact and the file that makes the machine code
    exist, and an iyi program built against the first and linked against the
    second called `Kemal::ExceptionPage.for_production_exception` and printed
    the page Kemal returns in production. Four things had to be true and each
    was found by trying:

    - **Codegen is demand-driven**, so a library nobody calls compiles to
      nothing. The generated keep file names every exported method and is never
      called.
    - **A getter whose body is one instance variable is inlined** and emits no
      symbol. `--emit-iyimod` already suppressed that for iyi modules;
      `--iyi-keep NAMESPACE` says the same about a bound shard.
    - **Symbols are local until an `objcopy`** globalises them.
    - **A reference type can cross without its fields.** A pointer is a
      pointer, so a consumer that never allocates one needs nothing of what is
      inside it — 16 of Kemal's 27 types travel that way, `new` withheld.
      A struct cannot: its size is its fields.

    **Kemal hands out everything through constants, and a constant is
    storage.** `Config::INSTANCE`, one `INSTANCE` per handler: a declaration
    can name a type but not a global somebody else's object file holds. So the
    generator writes a function per constant into the shim it already
    generates, and functions cross like any other:

        module Kemal
          extend self

          def config_instance : Kemal::Config
            Kemal::Config::INSTANCE
          end
        end

    `extend self` rather than `def self.`, because that is what an iyi module
    header desugars to and the two sides have to agree on one symbol:
    `Kemal@Kemal::config_instance` against `Kemal::config_instance`, which is
    the same distinction that makes a module function what it is.

    **A block crosses when its type is written, and that is not a detail.** A
    block-taking method is compiled per block *type*, and the type is in the
    symbol — `twice<Int32, &Proc(Int32, Int32)>` — so every consumer writing a
    block of the annotated type calls the one name the shard emitted. Measured:
    `twice(21) { |n| n }` runs across the boundary.

    A block written `-> _` has no such type. Each caller's block returns
    something else, each is a different symbol, and none of them is in the
    shard's object. **That is 32 of Kemal's 43 block-takers, and it is the
    whole DSL**: `get`, `post`, `error`, the filters. The hand port in
    `samples/iyi/kemal/` answers it with `forall B : IntoBody`, which is a
    person deciding what a route may return — R-2 asking its question, not a
    gap a generator can close.

    **Measured, on Kemal 1.12.0**: 15 module functions, 22 types carrying 50
    methods, and an iyi program that reads the framework's own configuration —
    `Kemal`, `3000`, `development`, `true`. What is left is two decisions per
    API rather than any missing machinery: what a `-> _` block returns, and
    what `HTTP::Server::Context` and a dozen more become on this side. 104
    signatures wait on the second.

---

## Appendix: What measurement settled

For traceability, since several rules here rest on numbers rather than taste.

| Claim | Evidence |
|---|---|
| Separate compilation is the main prize | 1000 typed functions cost +0.08 s; ~95% of non-LLVM work is fixed prelude tax |
| A cached prelude is worth 3.4×, not 20× | fork probe: 1.58 s → 0.47 s front end; 0.09 s if the prelude did not exist (IV.1a) |
| The artifact is not the whole job | with the prelude pre-analysed, class-var initializers and `main` are 90% of what is left, because they still walk the prelude (IV.1a) |
| Prelude-aware passes are worth another 10× | a front end that never walks the prelude runs `hello.iyi` in 0.049 s vs 1.58 s, and emits an object with an identical symbol table (IV.1a) |
| The front end and codegen need the prelude for different reasons | codegen emits `fun`s by walking the AST, so the prelude's tree must reach it regardless; only the front end's need is removed by caching analysis (IV.1a) |
| Half the top-level pass is the parser | 304 prelude files, 107,719 lines: 0.57 s parse, 0.54 s visit |
| Open classes are the blocker | 77 of 484 types reopened across module boundaries; `String` by five modules |
| Traits are a viable replacement | Kemal router ports at +4% code size, structure intact |
| `using` is required, not optional | Kemal's DSL is unwritable without it |
| Dictionaries pay off at compile time | 46.6% of instantiations collapse (compiler), 47.7% (app-shaped code) |
| Dictionaries cost ~3–4 cycles per call | 17.5× on a vectorisable loop, 1.21× where neither side vectorises, 1.00× with real work per element |
| `macro_run` must go | +7.4 s per distinct script on a cold build, memoised per script but not amortised across scripts; two scripts cost twice (II.10) |
| Macro expansion is not a compile-time cost | a template macro runs at 1.00–1.05× hand-written code; a computing macro adds ~9 µs per method against the ~18 µs the method costs anyway (II.10) |
| `method_missing` is safe to cut | one occurrence in stdlib, zero in Kemal |
| Traits can carry the stdlib | `Enumerable` ported and running: 57 of its 71 method names on one `each`, implemented for two element types, every method called (`samples/iyi/std/enumerable.iyi`) |
| `Share` prices a style rather than failing | clean-sheet iyi code is 77% shareable as written and 100% given an immutable collection; the compiler, built as a mutable workspace, is 38.5% and stays there (III.4.7) |
| Module-level mutable state is already rare | 3 of 483 compiler types hold a class variable, so III.4.5 costs almost nothing |
| Coherence costs nothing at build time | the import DAG plus the orphan rule make duplicate impls unrepresentable (IV.4) |
| The gap to Go is the warm build, and it is 11× | `hello`: cold 2.20 s vs Go's 1.98 s, warm 1.96 s vs Go's 0.18 s. Crystal's cache holds codegen only, so the 1.32 s front end is paid on every build (`bench/build_speed.py`) |
| A first release's prelude is ~3.5k lines | Crystal 0.1.0 shipped 8,161 lines of library, 3,551 of it the core that a prelude is; the rest is `json`/`yaml`/`http` |
| Self-hosting only gets more expensive | Crystal self-hosted at 24,984 lines of compiler and 8,161 of library, before its 0.1.0; iyi's fork starts at 95,010 and 196,217, and is 87,421 after the interpreter came out (Appendix B.2, V.11) |
| A second implementation of the language is what an interpreter costs | Crystal's interpreter stops on `samples/iyi/hello.iyi` line 12 at the module header, and 0 of the fork's 153 commits had touched it against 7,840 lines of parser and semantic change (V.11) |
| The daemon's win did not survive the prelude | it removed prelude analysis, and iyi's prelude is 1,053 lines: one module edited in a 7,208-line project costs 0.18–0.28 s built normally and 0.20–0.24 s through the daemon (IV.1d) |
| R-1 pays for lines, not for modules | 30 modules of 10 types buy 1.8x and 300 modules of one type buy 1.4x; a project of 300 five-line modules is a 0.86x *loss*, because reading an artifact costs more than parsing five lines (IV.3a) |
| One file is one module, and it had to be said | a second `module a/b` header in a file was accepted: the file emitted one artifact under the first name carrying both modules' exports, and the second module had none (IV.6) |
| A compiled artifact needs its own checksum | one flipped byte in a `.iyimod` built silently 7 times out of 10 and reached the linker the other 3; per-section checksums in format v19 refuse 12 of 12 and name the section (IV.2a) |
| A prefix is not a parent directory | working in `/tmp/x/crystal` with a cache at `/tmp/x/crystal-cache`, every object file was written to `-cache/…`; the same "No such file or directory" the cleaner race produces, from a different cause (V.10) |
| A build's cache directory can be deleted underneath it | the cleaner keeps the ten most recently modified directories and runs after every compile; removing one mid-codegen reproduces both failures, the single-threaded path included, and reading the `compiler.lock` the build already holds fixes it (V.10) |
| A module as the unit of compilation is worth 8x to 9x over Crystal | the same program, the same compiler binary, one module edited: 1.17 s as Crystal, 0.13 s as iyi, against `go build`'s 0.16 s, and 1.29 / 0.16 / 0.19 an hour earlier (IV.3a) |
| The edit loop is where R-1 pays, and it pays 1.8x | one module edited in a 30-module, 7,208-line project: 0.13 s with artifacts, 0.23 s without, against `go build`'s 0.16 s for the same edit (IV.3a) |
| The path/name mapping needed more than snake_case | `camelcase` drops an underscore before a digit, so `v_1` and `v1` both give `V1`; requiring each group to start with a letter removes that and three sibling collisions (IV.6 #6) |

## Appendix B: Decisions awaiting your call

| # | Decision | Recommendation |
|---|---|---|
| 1 | Errors as unions at all (III.1) | yes: biggest departure from Ruby feel, so it is a taste call |
| 2 | ~~`!` in identifiers vs `!` as propagation (III.1.7)~~ | **Decided: A**: `!` dropped from identifiers, `sort`/`sorted` adopted, enforced by the compiler |
| 3 | ~~Implicit error conversion (III.1.6)~~ | **Decided: no, and not on a schedule**: the signature is the error set; a conversion the reader cannot see takes that away |
| 4 | ~~Nil-propagation operator (III.1.5)~~ | **Decided: no, and not on a schedule**: a second propagation channel ends by making `Nil` an error, which III.1.5 exists to prevent |
| 5 | `pub using` re-export (II.3) | no, for Draft 0 |
| 6 | `@[Monomorphize]` on stdlib trait defaults (II.6) | yes: mark `each`/`map`/`select`/`reduce`, stencil the rest. Accepts that the library author owns a per-method performance decision |
| 7 | ~~`!` inside a `defer` (III.1.4, V.8)~~ | **Decided: no**: a `defer` runs while the function is already returning, so propagating from one needs error-during-error semantics |
| 8 | Structured concurrency only, no bare spawn (III.4.1) | yes. It is `defer` applied to a task set, so it costs no new mechanism, and it makes Go's commonest bug unrepresentable. The price is that a task cannot outlive its scope, which is a taste call |
| 9 | ~~`Share` marker vs Erlang-style no sharing (III.4.4)~~ | **Decided: `Share`, on the count**: III.4.7 found the feared class empty and clean-sheet iyi code 77% shareable as written, 100% given a shareable immutable collection. That collection is now a stdlib obligation, not a nicety |
| 10 | ~~**Is iyi ever meant to be self-hosted?**~~ | **Decided: no.** iyi's compiler is and remains a Crystal program. The language's claim is what it compiles, not what compiles it. See B.2 |
| 11 | ~~**Keep Crystal's interpreter?**~~ | **Decided: no, and removed.** It was compiled out already, it cannot run an iyi program past the module header, and no commit of this fork had touched it in 153. An interpreter is a second implementation of the semantics, and the semantics are still moving. See V.11 |

### B.2: The one decision the fork already made: **SETTLED: not a self-hosting project**

Crystal's compiler was written in Crystal before its 0.1.0, when the compiler
was 24,984 lines and the library 8,161. iyi begins from a fork: 95,010 lines of
compiler and 196,217 of library, none of it written in iyi, and none of it
compilable by iyi's own rules. The compiler is 87,421 lines since V.11 took the
interpreter out, which is the same decision read forward: a second
implementation of the language is a cost, and this fork does not pay it twice. The Appendix's own count says 77 of 484 types
are reopened across module boundaries, `String` by five modules.

The fork was the right call and it is why iyi has a working backend, a GC and a
measured thesis at 75 commits. It also bought that with something, and the
something is this: **self-hosting is the one cost that only rises.** Crystal
paid it at 33k lines total. iyi would pay it at 291k, against rules that forbid
the style most of those lines are written in.

So this is not a task that gets scheduled later; it is a door that is already
mostly shut, and the honest thing is to say so rather than leave it implied.
**Settled: iyi is not a self-hosting project.** Its compiler is and remains a
Crystal program, and the language's claim is what it compiles rather than what
compiles it. Go
is again the evidence for why that is survivable: `gc` stayed a C compiler
until Go 1.5 in 2015, nearly six years after the language was announced and
four point releases into Go 1, and nobody held it against the language.

The alternative (deciding that self-hosting matters) would have changed the
plan rather than added to it: it would make the compiler's own shape a design
input from here on, and III.4.7's measurement that the compiler is 38.5%
shareable *and stays there* is the first thing it would have collided with.
Deciding it now costs nothing; deciding it after the library exists would have
cost the library.

### B.1: Why #3, #4 and #7 are one decision

They are three requests for the same thing: **more reach for `!`**. Each is
individually reasonable and the three of them together are how this design
fails, so it is worth writing down once what they have in common rather than
answering each on its own merits.

`!` does exactly one thing: return early. It does not convert, does not widen,
does not reach into a second kind of absence, and does not run during unwind.
That is the whole of it, and the value of the design is in what the operator
**refuses** to do, not in what it does, because everything it refuses is a way
for a function's real error set to stop being the one written in its signature.

Go's own answer to this question is the evidence. The `try` proposal
(golang/go#32437, 2019) was not declined for being hard to implement. It was
declined because it hid control flow and made adding context to an error worse,
and Go took error *wrapping* instead. That is a language with the same taste as
this one deciding that the operator was the wrong place to spend the budget.

Taken one at a time:

- **#3, implicit conversion.** This is the decision that separates this design
  from Rust's. `?` plus `From` means the set of errors a function returns is
  computed by a trait resolution the reader cannot see, which is why that
  ecosystem grew libraries whose entire job is to make error types writable.
  Here the signature is the truth, and it stays the truth only if nothing
  silently rewrites an error on the way out. The replacement is not a
  conversion mechanism: error sets are aliases (III.1.2), so widening a return
  type covers most of what conversion is asked for, and it is free. Genuine
  conversion (deliberately *hiding* one error behind another) is rare, should
  look rare, and is an ordinary function call.
- **#4, nil propagation.** `T?` and error unions are different questions, and
  III.1.5 keeps them different. A `?`-propagating operator would put them in the
  same shape, and the pressure would then be to unify them: at which point
  `Nil` implements `Error` and the distinction is gone. Flow typing already
  handles absence, and it is the better tool: it forces the branch to be written
  where the absence means something, which is the whole reason absence is not an
  error.
- **#7, `!` in a `defer`.** A `defer` body runs while the function has already
  decided to return, and possibly while it is carrying an error of its own.
  Propagating a second error from there is the error-during-error problem, which
  is the ugliest corner of every language that has taken it on. A `defer` body
  handles its own failure, explicitly: `.or_panic` or ignore it.

None of the three is blocked on anything. They are not deferred to Draft 1; they
are answered.
