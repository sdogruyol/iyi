# iyi Website Fact Base

This document contains facts about iyi drawn from the repository itself. Every claim is traceable to a source file or is explicitly labeled as inference.

---

## 1. What iyi Is (from the repository)

### Core Definition

From README.md, lines 6-13:

> A language built for Developer & Agentic Experience, Portability, Performance, and Efficiency. (*iyi* is Turkish for "good".)
> 
> Those four are one design decision seen from four sides. A module is the unit of compilation and it is compiled against its dependencies' **declarations**, never their bodies — so a build reads less, a program carries less, a tool can read an interface without a repository, and a person waits less. Everything below is that rule and what it costs.

### Relationship to Crystal

From README.md, lines 23-30:

> iyi is its own language, and it is compatible with Crystal. Compatible in a way you can check: the same compiler builds `.cr` files, `iyi build --crystal` gives a program Crystal's standard library, and `require "kemal"` in an iyi file serves HTTP. Its own in a way you can also check: a `.iyi` file has rules Crystal does not have and refuses things Crystal accepts, and those rules are the whole of what follows. The compiler is built on Crystal's, which is recorded where it belongs — the licence and NOTICE.md.

### Version

Current development version: 0.3.0-dev (from src/IYI_VERSION)

---

## 2. How iyi Differs from Upstream Crystal

### The Core Distinction: Separate Compilation

The fundamental difference is stated in SPEC.md, Part I:

**Rule 1 (R-1):** A module is the unit of compilation. `import` forms a DAG. Compiling a module reads only its dependencies' export metadata, never their bodies.

This enables:
- Incremental rebuilds by skipping modules the user did not edit
- Type-checking against published signatures without source code
- Agentic tooling that can analyze modules without repository access

### The Artifact Format

iyi introduces the `.iyimod` artifact format, which carries:
- Declarations (export metadata) 
- Machine code (object code from a module)
- Pointer maps for garbage collection (Layouts section, format v24+)

From CHANGELOG.md (Unreleased section):

> The collector's first stage: pointer maps travel in the artifact. `.iyimod` is format v24 and carries a `Layouts` section, numbered 14: per type a module owns, its allocation size, its unrounded instance size, and the byte offsets of its pointer fields.

### The Compilation Rules

Five additional rules replace or constrain Crystal's open-class model:

**R-2:** Everything a module exports (`pub`) carries full parameter and return types. Non-exported code infers.

**R-2b:** `using` brings exported names into unqualified scope, written by the consumer (not the library).

**R-3:** No open classes. `impl Trait for Type` must live in the module defining the trait or the type (orphan rule).

**R-4:** Generic calls crossing module boundaries pass a dictionary keyed on GC shape. Within a module, monomorphisation applies.

**R-5:** Macros are derive-scoped: they see only the declaration they are attached to.

### Prelude Size

iyi's own prelude is small by design. From SPEC.md, section 0.1.0:

- iyi's prelude: 2,872 lines (measured via `wc -l src/iyi/*.iyi`). Designed to stay under 3,551 lines, which was Crystal's 0.1.0 prelude size (the historical ceiling).

From CHANGELOG.md: iyi's prelude is written in iyi itself and deliberately minimal. From README.md, lines 97-99:

> iyi's own prelude has no IO beyond `puts` and no concurrency; `--crystal` supplies Crystal's standard library, IO, `require` and the ecosystem. Neither mode supplies a package manager.

### Regex Engine

The regex implementation is entirely within iyi (not delegated to PCRE2). From CHANGELOG.md (Unreleased):

> Stop treating pcre2 as one oracle. Hand a macro the named captures it wrote. The compiler turns a regex literal into a program-level constant.

This was completed in PR #20 "feat/rx-pcre2-gaps" which closed pcre2 compatibility gaps by implementing them in iyi's own regex engine in src/compiler/iyi/rx.cr.

### Garbage Collector

**DESIGN, not yet shipped.** From GC_DESIGN.md, Status line:

> Status: Stages 1 and 2 built. Stages 3 onward are design.

What is built:
- **Stage 1:** Pointer maps in artifacts (`.iyimod` Layouts section), object headers with mark words, CAS-safe tri-color marking infrastructure.
- **Stage 2:** Size-class arena allocator (`-Dgc_iyi`), mmap-backed arenas, free lists, large objects released via `munmap`. Platform support: Linux x86_64 and aarch64, macOS. Windows and wasm32 keep existing allocators.

From CHANGELOG.md unreleased section:

> Opt-in on purpose. The default on every target is unchanged, and switching it is a separate decision backed by measurement rather than something to slip in.

What is NOT yet implemented:
- No object is allocated with the GC header
- Nothing marks live objects
- Nothing collects dead objects
- No collection actually runs

From GC_DESIGN.md, Stage 2 section:

> -Dgc_boehm is still the only way to get collection and every default path still allocates and never frees.

---

## 3. Feature and Status Inventory

### What Works Today (0.3.0-dev)

From README.md metrics (measured 2026-08-17, rows 15-21):

| Feature | Measured Result |
|---------|-----------------|
| Edit one module, rebuild (30 modules, 7,207 lines) | iyi 0.13 s, Crystal 1.17 s, Go 0.16 s |
| Warm full build, hello / 6,900-line pair | 0.07 s / 0.24 s vs Go's 0.08 s / 0.09 s |
| Front end speed (hello.iyi) | 0.031 s (target: 0.050 s, MET) |
| Binary size (hello) | 36 KB, starts in 1.6 ms |
| Portability | Compiles for 9 targets, runs on 4 (x86-64 glibc, x86-64 musl, aarch64 under emulation, wasm32-wasi) |

## Structural Measurements (Machine-Independent, CI-Gated)

These nine measurements are checked by `python3 bench/doc_numbers.py` on every build. Silent drift is structurally impossible: the script fails if a quoted number diverges from the source. Measured at commit 03d013243, 2026-08-23 22:43:42 UTC:

| Measurement | Value | Source | Measured By |
|---|---|---|---|
| iyi prelude lines | 2,872 | wc -l src/iyi/*.iyi | bench/doc_numbers.py |
| samples/iyi/std lines | 777 | wc -l samples/iyi/std/*.iyi | bench/doc_numbers.py |
| compiler implementation | 91,337 | wc -l src/compiler/**/*.cr | bench/doc_numbers.py |
| sample programs | 13 | count of samples/iyi/*.iyi | bench/doc_numbers.py |
| prelude disk size | 100 KB | sum(stat().st_size) / 1024 | bench/doc_numbers.py |
| Crystal stdlib bang-methods | 51 | distinct `def name!` in Crystal source | bench/doc_numbers.py |
| generated benchmark project | 7,207 | lines from bench/incremental/generate_project.py | bench/doc_numbers.py |
| iyi spec files | 8,924 | wc -l iyi-specific spec files | bench/doc_numbers.py |
| CI type-check targets | 9 | parsed from .github/workflows/iyi.yml | bench/doc_numbers.py |

These numbers move only when the tree changes, never with machine or LLVM version.

## Machine-Dependent Measurements

Timing and binary sizes move with the platform, LLVM version, and compiler state. The README quotes ratios as the claim, not absolute seconds, because build time has noise and the minimum of N runs estimates a floor.

**Edit-loop benchmark:** `python3 bench/build_speed.py`
Machine: AMD Ryzen AI 9 465 under WSL2, LLVM 19.1.7, Go 1.25.2
Method: best of 7 runs, release compiler, one idle machine

| What changed | iyi | Crystal | Go |
|---|---|---|---|
| one module's body | 0.13 s | 1.17 s | 0.16 s |
| entry file only | 0.12 s | 1.15 s | 0.16 s |
| nothing at all | 0.12 s | 1.14 s | 0.08 s |
| tired session | 0.22 s | 1.81 s | 0.27 s |

The ratios hold constant across machine states. Read columns against each other since they measure on the same machine.

**Full build benchmark:** `python3 bench/build_speed.py`
Same machine: AMD Ryzen AI 9 465 under WSL2, LLVM 19.1.7
Method: best of runs, cold and warm cache

| Program | iyi | Go |
|---|---|---|
| hello (147 lines) | 0.07 s | 0.08 s |
| generated pair (6,912 lines) | 0.24 s | 0.09 s |

**Binary size and startup time:** `python3 bench/machine_probe.py`
Machine: macOS arm64 with LLVM 22

| Program | iyi | Crystal |
|---|---|---|
| hello binary size | 36 KB | 1,553 KB |
| hello startup time | 1.6 ms | 3.2 ms |

**Front end timing:** `python3 bench/machine_probe.py`
Machine: macOS arm64 with LLVM 22
Measurement: parse and semantic analysis only (--no-codegen)
- iyi hello: 0.031 s (target: 0.050 s, MET)

Repeat with `python3 bench/machine_probe.py <label>` across machine states to distinguish code changes from machine variance.

## Verified Drifts and Their Sources

Three drifts were found in prose claims about what the tree does. Numbers are gated by bench/doc_numbers.py, but prose claims are not.

**Drift 1: Sample count (CONFIRMED)**
README.md line 718: "Nine programs in `samples/iyi`"
README.md line 922: "thirteen programs"
Actual tree: 13 .iyi files (bench/doc_numbers.py measured().samples = 13)
Verdict: Line 718 is stale. It contradicts line 922 and the measured count.

**Drift 2: Import count (CONFIRMED)**
README.md line 727: "the five samples that import anything"
Source: bench/samples_roundtrip.sh line 29
Actual list: `SAMPLES="modules immutable collections init_order webapp derive"`
Count: six samples, not five
Verdict: README.md line 727 is off by one. The script lists six.

**Drift 3: Artifact build capability (STALE COMMENTS)**
samples/iyi/modules.iyi lines 121-122: artifact build "cannot yet produce a program"
samples/iyi/hello.iyi lines 136-137: artifact build "cannot yet produce a program"
README.md lines 383-387: demonstrates artifact build producing a working binary
Evidence: bench/samples_roundtrip.sh lines 50-65 builds each sample from artifacts (--use-iyimod) and runs the resulting binary, diffing output against source-built version
Verdict: The sample comments are stale. The script proves artifact builds produce runnable programs. These comments state the opposite of what the tree does.

### The Prose Claims Gap

bench/doc_numbers.py gates NUMBERS: line counts, sample counts, target counts. When a number drifts from the source, the script fails and blocks merge. But it does not gate PROSE CLAIMS about what the compiler does, what is implemented, or what is possible.

Two of these three drifts are in README.md itself, the very file doc_numbers.py exists to keep honest. The third is in sample files that function as documentation. All three are false claims that contradict evidence in the tree: the script, the running programs, the measured counts.

A website that hand-copies these claims inherits all three drifts. The site must either regenerate numbers from doc_numbers.py (already documented) or develop a separate gate for prose claims that compares README.md against the actual tree state (compiler capabilities, what samples do, what the gate measures).

## Primary Checkout Status

The primary checkout at /Users/jwaldrip/dev/src/github.com/jwaldrip/iyi is on branch gc/stage2-allocator with active uncommitted work (bench/arena_exercise.iyi modified). This branch is 32 commits ahead of origin/master (the current main branch). The branch carries the Stage 2 GC allocator implementation and has not yet been merged to master.

**Implemented language features:**
- Union types and nil-safety (from Crystal, unchanged)
- Flow typing
- Blocks
- Local type inference
- Traits with abstract methods
- impl blocks (R-3 orphan rule enforced)
- Generics with type parameters
- Associated types on traits
- Trait bounds and requirements (`where` clauses)
- Modules with `import` and `using`
- Selective `using` (import specific exports)
- Full signatures on exported methods (R-2)
- Error types (union members implementing Error trait)
- Error propagation operator (`!`)
- defer statements for cleanup
- case/in pattern matching

**Samples that compile and run from artifacts:**
From SPEC.md section 0.1.0, item 1:

- `modules.iyi` (imports across files)
- `immutable.iyi` (generic type with 575-line trait, associated types)
- `collections.iyi` (trait implemented by foreign types)
- `init_order.iyi` (declaration ordering)
- `webapp.iyi` (Kemal router port, requires Crystal's library)

All five rebuild from `.iyimod` artifacts with their imported modules' source deleted.

**Shards and ecosystem:**
- Requires work with `--crystal` flag
- Tested: Kemal 1.12.0 (HTTP framework)
- From CHANGELOG.md: A real shard is installed, built against and asked for two pages every build.

### What Is Designed But Not Built

**Garbage Collector Stages 3-6:**
- Stage 3: Root discovery (conservative, precise in scope)
- Stage 4: Stop-the-world synchronization
- Stage 5: Marking phase (point of no return)
- Stage 6: Sweep phase and finalizers

From GC_DESIGN.md, Owner's Decision section:

> Point of no return: Stage 5 (Marking). Once the compiler emits pointer maps and marks live objects, bdw-gc can no longer be the fallback.

**Dictionary-passing generics:**
From samples/iyi/hello.iyi lines 124-132:

> Dictionary-passing generics is unimplemented: `announce` above is monomorphised the way Crystal monomorphises it.

**Trait bounds on generic impl parameters:**
From samples/iyi/generics.iyi, "Not yet implemented" section:

> forall T : Show parses but is rejected. A bound makes the impl conditional, and a conditional impl has to be checked where the type is instantiated rather than where the impl is written.

**Specialised impls:**
From samples/iyi/generics.iyi:

> iyi has no specialised impls. Overlapping impls need a rule for which one wins, and that rule has to stay sound when the two live in modules compiled separately.

**Windows runtime support:**
From README.md, lines 298-303:

> Darwin is still "the code generator has no objection", and needs a runner this workflow does not have. Windows is worse than that and gets its own entry below: it compiles, it links, and what it prints at run time cannot be trusted.

### What Is Explicitly Unsupported

**Package management:**
From README.md, lines 97-99:

> Neither mode supplies a package manager.

**No open classes:**
From samples/iyi/hello.iyi lines 69-71:

> `impl Trait for Loud` — a blanket impl in disguise

The repo does not state whether open classes are planned or permanently rejected.

**Panics (exception handling):**
From samples/iyi/errors.iyi, "Not yet implemented" section:

> Panics (III.1.4). They are meant to be catchable only at task boundaries, and what a task boundary is belongs to Part V.5. Until then `.or_panic` raises a Crystal exception, and `defer` runs on that unwind either way.

**Floating-point support:**
The repo does not state whether Float types are implemented.

---

## 4. Language Surface: Code Samples

All samples below are from the repository's own sample files. Each compiles with the iyi compiler.

### Sample 1: Basic I/O and Collections

From samples/iyi/basics.iyi:

```crystal
module samples/basics

total = 0
(1..10).each { |i| total = total + i }
puts total # => 55

numbers = [3, 1, 4, 1, 5, 9, 2, 6]
puts numbers.first                          # => 3
puts numbers.select { |n| n > 3 }.join(",") # => 4,5,9,6

counts = {} of String => Int32
["a", "b", "a"].each do |word|
  counts[word] = (counts[word]? || 0) + 1
end
puts counts["a"]
```

Source: samples/iyi/basics.iyi lines 13-61
Status: Compiles and runs under iyi

### Sample 2: Traits and Impl Blocks

From samples/iyi/hello.iyi:

```crystal
module samples/hello

pub trait Greet
  abstract def greet : String
end

pub struct User
  getter name : String

  def initialize(@name : String)
  end
end

impl Greet for User
  def greet : String
    "Hello, #{name}!"
  end
end

puts User.new("iyi").greet
```

Source: samples/iyi/hello.iyi lines 17-50
Status: Compiles and runs under iyi

### Sample 3: Error Types and Propagation

From samples/iyi/errors.iyi:

```crystal
module samples/errors

pub struct IOError
  getter path : String
  def initialize(@path : String)
  end
end

impl Error for IOError
  def message : String
    "no such file: #{path}"
  end
end

pub def read(path : String) : String | IOError
  return IOError.new(path) if path == "missing"
  path
end

pub def load(path : String) : Int32 | IOError
  text = read(path)!
  text.to_i? || IOError.new(path)
end

case load("config")
in Int32      then puts "read #{it}"
in IOError    then puts "io: #{it.message}"
end
```

Source: samples/iyi/errors.iyi lines 9-68
Status: Compiles and runs under iyi

### Sample 4: Modules, Import, and Using

From samples/iyi/modules.iyi:

```crystal
module samples/modules

import app/greeter
import app/formal

using app/greeter
using app/formal::{address}

pub struct User
  getter name : String
  def initialize(@name : String)
  end
end

impl Greet for User
  def greet : String
    shout(polite(name)) + " " + address(name)
  end
end

def shout(text : String) : String
  text.upcase
end

puts User.new("iyi").greet
puts App::Greeter.title
```

Source: samples/iyi/modules.iyi lines 8-64
Status: Compiles and runs; imports from app/greeter and app/formal; rebuilds from .iyimod artifacts with source deleted

### Sample 5: Generics and Associated Types

From samples/iyi/generics.iyi:

```crystal
module samples/generics

pub trait Show
  abstract def show : String
end

pub struct Box(T)
  getter value : T
  def initialize(@value : T)
  end
end

impl Show for Box(T) forall T
  def show : String
    "Box(#{value})"
  end
end

pub trait Container
  type Elem

  abstract def first : Elem

  def pair : Array(Elem)
    [first, first]
  end
end

pub struct Names
  def initialize
  end
end

impl Container for Names
  type Elem = String
  def first : String
    "ada"
  end
end

puts Box.new(42).show
puts Names.new.pair.join(", ")
```

Source: samples/iyi/generics.iyi lines 5-113
Status: Compiles and runs under iyi

### Sample 6: Defer and Cleanup

From samples/iyi/errors.iyi:

```crystal
pub def session(path : String) : Int32 | IOError | ParseError
  puts "  open outer"
  defer puts "  close outer"

  text = read(path)!

  puts "  open inner"
  defer puts "  close inner"

  to_number(text)!
end

puts "success:"
puts session("config").or(-1)
puts "propagating:"
puts session("missing").or(-1)
```

Source: samples/iyi/errors.iyi lines 110-129
Status: Compiles and runs under iyi

### Sample 7: Trait Bounds

From samples/iyi/generics.iyi:

```crystal
pub trait Cmp
  abstract def cmp(other : self) : Int32
end

pub trait Ord : Cmp
  type Item
  abstract def item : Item

  def beats(other : self) : Bool
    cmp(other) > 0
  end

  def best : Item where Item : Cmp
    item
  end
end

pub struct Ranked
  getter n : Int32
  def initialize(@n : Int32)
  end
end

impl Cmp for Ranked
  def cmp(other : self) : Int32
    n - other.n
  end
end

impl Ord for Ranked
  type Item = Score
  def item : Score
    Score.new(n)
  end
end

puts Ranked.new(2).beats(Ranked.new(1))
```

Source: samples/iyi/generics.iyi lines 124-186
Status: Compiles and runs under iyi

### Sample 8: Web Framework Bindings

From samples/iyi/webapp.iyi (Kemal router port):

```crystal
module samples/webapp

import kemal/dsl
import kemal/router

using kemal/dsl
using kemal/router::{Router, Context}

get "/" do |env|
  "home"
end

get "/count" do |env|
  42
end

users = Router.new
users.namespace "/admin" do |admin|
  admin.get "/dashboard" do |env|
    "dashboard"
  end
end

mount "/v1", users
```

Source: samples/iyi/webapp.iyi lines 108-132 (from README.md)
Status: Compiles and runs under `iyi build --crystal` with Crystal's library; binds to Kemal 1.12.0

---

## 5. Naming and Branding

### Name Meaning

From README.md, line 7:

> (*iyi* is Turkish for "good".)

### Author and Ownership

The repository shows:
- Owner: github.com/jwaldrip (Jason Waldrip)
- Primary remote: git@github.com:jwaldrip/iyi.git
- Upstream: https://github.com/sdogruyol/iyi.git

### License

Apache License 2.0 with Runtime Library Exception (from LICENSE file)

From README.md, line 4:

> licence badge: Apache-2.0

### Logo and Branding Assets

The repo does not contain any logo files, icon files, or brand asset directories. No official branding visual is present in the repository.

### Project Status Statement

From SPEC.md, line 13:

> Status: draft for discussion. Parts of it are built. Each section says which, and a heading that does not say so is a heading to distrust.

The current compiler reports version 0.3.0-dev.

---

## Notes for Website Authors

**Do NOT state time estimates.** The repo and this fact base contain no timelines or delivery dates for unfinished work.

**Verify measurements.** Speed, binary size, and compatibility claims in the README are measured with specific commands documented in the bench/ directory. They are repeatable and load-bearing.

**Distinguish design from implementation.** GC_DESIGN.md and SPEC.md Part II contain design; the code and samples show what is built. The CHANGELOG.md "Unreleased" section documents what is shipping next.

**Crystal compatibility is checked.** The samples run identically to their Crystal equivalents, verified by the benches' own output comparison.
**Em-dashes in README.** Verbatim quotes from README.md preserve em-dashes as they appear in the source. When writing site copy, use commas, colons, or full stops instead of em-dashes or en-dashes.

**Numbers are gated.** The script `bench/doc_numbers.py` runs on every build and fails if quoted numbers drift from the source. It measures:
- prelude: 2,872 lines (src/iyi/*.iyi)
- samples_std: 777 lines (samples/iyi/std/*.iyi)
- compiler: 91,337 lines (src/compiler/**/*.cr)
- samples: 13 (count of samples/iyi/*.iyi)
- prelude_kb: 100 KB on disk
- bang_names: 51 distinct method names ending in ! in Crystal stdlib
- generated: 7,207 lines (benchmark project from bench/incremental/generate_project.py)
- spec_iyi: 8,924 lines
- targets: 9 (CI type-check targets from .github/workflows/iyi.yml)

A website build can consume `python3 bench/doc_numbers.py --list` to emit these numbers as structured data, making site numbers generated rather than hand-copied and eliminating silent drift.
