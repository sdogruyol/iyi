# Changelog

## Unreleased

### Added

- **`pub enum`, and an enum crosses a boundary.** iyi took an `enum` already —
  the language has one and the compiler makes the type — but `pub` did not, so a
  module could declare one and never hand it out. It does now, and
  `crystal tool bind` writes the enum's members with the integer they are
  numbered on, read from what the compiler assigned rather than renumbered: the
  object file a consumer links is what gave them their numbers. An earlier note
  said iyi had no `enum` at all, which came from grepping the prelude and was
  wrong about the language.

- **A private type travels as private.** `JSON::PullParser` holds an
  `Array(ObjectStackKind)` and its object code numbers
  `Pointer(ObjectStackKind)`, so a consumer has to *number* a type it must never
  be able to *write*. Declaring it without `pub` is exactly that, and R-2b keeps
  the name unreachable. Dropping such types was the first answer and only the
  linker said otherwise.

- **A rebuild of a type declaration carries all of it.** Pruning and renaming
  both reconstructed a `TypeDecl` and left `value` and `macros` behind, which is
  how an alias lost its right-hand side and, once enums arrived, how one lost
  its members.

- **A generic type crosses a boundary.** Its methods exist once per
  instantiation and the instantiations belong to whoever writes them — a
  consumer that writes `Holder(Float64)` needs a method the producer never made
  — so what travels is the declaration with its type parameters and the
  *source* of its methods, in `MonoBodies`, which is the answer IV.2 already
  names and `crystal tool bind` was not using. `new` stays out: it is
  synthesized from `initialize`, so a consumer makes its own and a carried one
  would meet it at the linker.

  A generic travels even with no methods to carry, because a consumer may need
  only to *name* it: `Kemal` refers to `Array(Radix::Node(...))` and calls no
  `Node` method. `Radix` carries three types where it carried none.

  What a generic's methods must have is a written return type. The trick that
  rescues an ordinary method — instantiate it on purpose and read what comes
  back — has no single answer when the owner is generic, so 20 of `Radix`'s 33
  methods stay behind.

- **A harness for what a consumer pays for a shard** (`bench/bind_speed.py`),
  from its source and from its boundary, at three sizes. A boundary pays once
  compiling the shard is a real share of the build — near ten thousand lines
  here — and costs a little below that: 2,167 lines costs 2%, 10,087 saves 9%,
  29,767 saves 11%.

  It could not be asked of `Kemal`, which cannot be bound: its object code
  numbers `Array(Radix::Node(...))`, a generic instance from another shard, and
  a generic travels as bodies rather than declarations. What `tool bind` says
  about `Kemal` stands on its own — 254 public methods, 93.3% needing no human,
  31 units of object code.

- **A private constant is not handed out.** The keep file read
  `Kemal::FilterHandler::WILDCARD_PATHS` through a generated accessor, which is
  what the shard's own compiler refuses. It still travels in the artifact's
  initialiser, because *defining* one is not *reading* it and the object code
  refers to it either way.

- **A build that fills a boundary does not link.** The keep file is not a
  program anybody runs — it exists so codegen emits the methods a consumer will
  call — and what the boundary needs is the objects, not the executable they
  would have gone into. Forcing the whole of `IO`'s surface produces a program
  that will not link, on `Crystal::EventLoop::Polling` internals a demand-driven
  build never reaches, and the units are written after the link. `IO`'s artifact
  fills now — 18 units, 14.8 MB — where it had been empty.

- **Measured what the library would be worth as an artifact** (SPEC.md Part V
  item 12e). A generated module the shape of a library — 103,002 lines, 5,000
  exported methods, declarations at the 5% of the source that Crystal's own
  library has them at — reads back from its `.iyimod` in 0.11 s against 0.43 s
  from source, in 25 MB against 163 MB. The daemon, on the same term, is 0.47 s
  to 0.33 s and costs 200 MB rather than saving it.

  `crystal tool bind` already writes a `.iyimod` for a Crystal namespace:
  `JSON` crosses 90.3% of its public surface unaided, `YAML` 78.0%, `URI`
  58.1%. What the rest waits on is the core types — `String`, `Array`, `IO` —
  which are not a namespace and so have no root to point the tool at.

- **The ecosystem and R-1, together: `--crystal` and `.iyimod` now work in one
  build.** A module that requires `json` compiles once into an artifact, and a
  program that requires Kemal links against it without opening its source. The
  two features were each half of the thing anybody actually wants.

  Three things had to be answered, and they were the same question three times
  — *a name in the module's object code that only the consuming program can
  define*, which is the rule `TypeIds` was already in the format for.

  - The main module's helpers, `~match<IO+>` first. The consumer emits them
    with its own numbering rather than the artifact carrying them, because a
    match against a virtual type compares against a range of type ids and those
    numbers belong to the program. A carried copy would have compared the
    consumer's ids against the producer's range and answered wrongly with
    nothing to see.
  - The module's requires. A module that required `uri` and a consumer that did
    not left `URI::Error.class:type_id` undefined at link time. They travel now
    — the new `Requires` section, format v20 — and the consumer replays them.
  - The `!dbg` location, fixed below.

  There is one copy of the library in the result, which was measured rather
  than assumed: `STDOUT` and `PROGRAM_NAME` are the same object on both sides
  of the boundary, and the specs assert it.

  What it saves is small and is written down as such: on a twelve-module app
  the modules cost 0.16 s from source and nothing from artifacts, against
  3.1 s for Crystal's library, which every build still reads from source.

- **`iyi daemon`.** A single-threaded `iyi-daemon` is built and shipped beside
  `iyi`; `iyi daemon start` holds Crystal's library analysed between builds. It
  takes about 0.3 s off the front end of a `--crystal` build — 0.81 s to 0.47 s
  on a twelve-module app — and costs about 200 MB resident per prelude it holds.

  Name your shard in a `--prelude` file of your own and it is held too, which is
  the largest effect by some way: 1.28 s to 0.60 s on the same app with Kemal.
  What the daemon is good at is holding the program's *dependencies*, not the
  library underneath them.

  Not offered before because iyi's own prelude takes 0.03 s to analyse and
  there was nothing to hold. `--crystal` gave it something.

- **A `.iyimod` records which library it was built against**, and importing
  across the two is refused by name in both directions. This replaces the old
  refusal, which was blunter and aimed at the wrong thing: `--emit-iyimod` and
  `--use-iyimod` no longer need iyi's own prelude. What they need is for the
  module and the program to agree on which library they mean. Both worlds are
  compiled by the same compiler and mangle the same names, so a mixed program
  would link — on the names that happen to agree.

- **`samples/iyi/calc`: a language, in the language.** Three modules — a
  scanner, a parser and an evaluator — reading a program from standard input,
  written against iyi's own 1,184-line library and nothing else. Every other
  sample is a page long, and a language that has only been used for pages has
  not been used.

  It grew the prelude by exactly what it asked for, which is the rule the
  prelude grows by: `String#[]`, `String#[](start, count)`, `String#to_i` and
  `read_input`. Nothing else was missing. `/` was not added, and that is the
  interesting one: iyi has no floats, Crystal's `/` on integers returns a
  `Float64`, and a name that means two things is what III.1.7a settled against
  — so integer division stays `//` in both.

### Added

- **A Crystal namespace can be bound, built and called from an iyi program, in
  two commands.** `--emit-bind` on the keep file's own build puts the per-type
  units into the artifact, with the type ids and constants they refer to, using
  the collectors an iyi module's artifact has always used — and the consumer
  links what the artifact carries:

  ```
  crystal tool bind -e ABCGreeter --emit-bind mods shard.cr
  crystal build --iyi-keep ABCGreeter --emit-bind mods -o keepbin abc_greeter_keep.cr
  iyi build --crystal --use-iyimod mods -o app app.iyi
  ```

  No `nm` and no `objcopy`, where four printed steps had been and had never
  worked at the end. The object `--emit obj` makes is a whole program and
  carries Crystal's library with it; an ordinary build leaves one object per
  type and the ones a namespace owns carry no runtime at all.

  `--crystal` on the consumer is not decoration: the unit numbers
  `Pointer(LibUnwind::Exception)` whatever the shard does, because a `String#+`
  can raise. The artifact is marked `crystal_library: true` for the same reason,
  which it always was — it was written `false` on an argument about what a
  boundary stands between, and that argument does not survive looking at what
  the unit refers to.

  A constant crosses as the assignment that makes it, so the consumer builds it
  in its own program at the time III.5 says — which is what the unit needs,
  referring to `Store::TABLE` and defining nothing. `Store.word(1)` answers
  `one`, where the same call used to segfault on the first read. Its own
  constants only: a unit refers to Crystal's as well, and those belong to the
  library the consumer already has.

  What a boundary cannot carry is an enum, and `crystal tool bind` says so by
  name instead of calling it a namespace skipped whole. iyi has no `enum`, so
  nothing on the far side declares one: a signature naming an enum cannot cross
  and neither can a type holding one. It is what `JSON` waits on — it binds to
  19 units and 7.5 MB and then stops on `JSON::PullParser`'s `ObjectStackKind` —
  and it is a language feature rather than another thing about object files.

  One nested inside a type under the root crosses as well, written
  `Inner::X = ...` — which defines rather than reopens wherever the namespace
  exists, and the declarations rendered above it are what make it exist.

### Fixed

- **`crystal tool bind` says why a bound shard cannot be linked into a program
  that has Crystal's runtime either.** A consumer built with `--crystal` is the
  program that *has* the runtime the shard's initialisation was missing, so it
  ought to be the answer; instead the link fails on `Crystal::Hasher::seed`,
  `Thread::threads`, `Fiber::fibers` and every other runtime global, defined
  once by each side. The object this pipeline makes is a whole program — a keep
  file is compiled like one — so it carries the library with it, and a program
  can have that library once. Without it the shard's state never starts; with
  it, nothing links. The names were not the problem and neither were the
  constants: the packaging was.

- **A harness for what the daemon takes off a whole build**
  (`bench/daemon_full_build.py`), which SPEC.md IV.1d had said was too noisy to
  publish. Twelve modules under `--crystal` with codegen and a link, eight
  alternating pairs, a module edited before every build, and it refuses to run
  on an unoptimised binary — the three corrections IV.1d had to make, built in
  so they cannot be forgotten again. **0.63 s to 0.46 s, or 26%**, with two runs
  agreeing to a hundredth.

  What was called noise was largely the measurement: `/usr/bin/time`, whose
  negative elapsed times IV.1d records, is not installed on this machine. The
  app here is lighter than the one the published table was made from — its
  front end is 0.35 s against 0.81 s — so this is a new row rather than that
  row measured further.

- **The prelude cache key is checked by the compiler now, not by whoever
  remembers.** A cache key is a claim that everything not in it does not matter,
  and this one was written when the only thing reading it was prelude analysis;
  every switch added since had to be checked against it by hand, silently.
  `--use-iyimod` is what happened when somebody did not — accepted, ignored, and
  the build compiled every module from source without a word. Each of
  `Compiler`'s switches is now written down as one of three things: in the key,
  re-applied when a build adopts a preanalysed prelude, or reaching neither.
  Adding a property fails the build until it is given one of them.

  Two of the classifications are judgements rather than facts, and saying so is
  the point: `mcpu`, `mattr` and `mcmodel` reach codegen and not analysis, and
  `progress_tracker` and `stderr` are where output goes — `new_program` sets the
  first and the adopt path sets neither.

- **`crystal tool bind` asked a hand-written list what an iyi program can name,
  and the list was wrong in both directions.** It claimed `Void`, `UInt32` and
  `Float64` — which iyi's prelude never declares — and left out `Slice`, `Int`,
  `Tuple` and `NamedTuple`, which `Program#initialize` creates for every program
  before any prelude is read. Those four were most of what the boundary appeared
  to be waiting on, so the list invented the work it was being read to size.

  `Program#builtin_type_names` records those types where they are made, and the
  tool asks it. `JSON` crosses 152 → 168 signatures, `YAML` 158 → 166, `IO`
  157 → 270 with what it waits on falling 140 → 5. The percentages do not move
  and nothing that crossed stopped crossing. What is left of "the core" is `IO`
  — nearly done itself — and then `Time`, `Time::Span`, `Set`, `File::Info`.
  See SPEC.md Part V item 12e.

- **CI could not package the tarball, and the guard that stopped it was right.**
  `iyi-tarball` carries `release := 1` and make applies that to what it builds
  for that goal — so the workflow naming `iyi` first built an ordinary one, and
  the tarball found it up to date by file times and refused. That refusal is
  exactly what `check_iyi_is_release` was added for; what was missing was the
  workflow catching up with it. It asks for `iyi-tarball` alone now.

- **The four steps `crystal tool bind` prints are taken by a spec now**
  (`spec/compiler-cli/bind-pipeline_spec.cr`): bind a shard, compile its keep
  file to an object, read the symbols, globalise them, and build an iyi program
  that links against it — then run the program and read what it printed. Three
  of the four steps were wrong when they were first run by hand, and each was
  invisible until something later failed, the later thing being `ld`. It skips
  itself where binutils is missing, or where `crystal` and `iyi` were built from
  different commits, since an artifact is read only by the build that wrote it.

- **`crystal tool bind` says that a bound shard's run-time state does not
  cross.** Crystal runs a constant's initialiser from `__crystal_main` and
  compiles the reads unguarded; a consumer has its own `__crystal_main` and
  never calls the shard's, so the constant stays null and the first read
  segfaults. A folded constant is fine — `LIMIT = 10` reads 10 — and one built
  at run time is not.

  Calling the shard's `__crystal_main` does not fix it, which was tried:
  renamed out of the way with `objcopy --redefine-sym` and called from the
  consumer, it segfaults *inside* the initialisation, before reaching any
  constant. Crystal's top level expects Crystal's runtime — a thread, an event
  loop, the exception machinery — and an iyi program is not one. So a boundary
  carries code that needs no initialisation, and that is the bound on it today.

  An earlier draft of this entry said the failure was silent — "no error at any
  step, the program answers wrongly". That was a measurement mistake: the exit
  status being read was a `printf`'s rather than the program's. It segfaults.

- **A method has as many symbols as it has ways of being called, and the keep
  file named one.** The mangled name carries the types at the *call site*, not
  the types in the declaration: `JSON.parse(input : String | IO)` is one
  declaration and three symbols, and the file named only the one where the
  argument is the declared union. Every consumer that passed a plain string
  linked against nothing. It emits the product of the parameters' shapes now,
  which measures smaller than it sounds — a union parameter is about one in
  twenty, 7 of `IO`'s 103 and 1 of `JSON`'s 53 — with a cap that reports itself
  rather than expanding without limit.

- **A `def self.` module function crossed under the wrong symbol.** A module
  written `extend self` puts its functions on the module and mangles
  `*Widget@Widget::polite<String>:String`; one written `def self.polite` puts
  them on the metaclass, which has no `@`. Both were recorded as the first, so
  every `def self.` in a shard produced a declaration the consumer called by a
  name nothing emitted — and Crystal's own library is written the second way
  throughout. The receiver is recorded now, which the artifact's format already
  had a field for and the type path already used.

- **A bound shard's module path is `camelcase` run backwards, and using
  `String#underscore` for it broke every acronym.** `underscore` answers `json`
  for `JSON`, and `json` camelcases back to `Json` — so the producer emitted
  `*JSON@JSON::...` while the consumer asked for `*Json@Json::...`, and `ld` was
  the only thing that ever said so. `camelcase` starts a group at every
  upper-case letter, so the inverse of `JSON` is `j_s_o_n`, which is a legal iyi
  path and comes back whole; `HTTPServer` is `h_t_t_p_server`, which
  `underscore` had flattened to `http_server` and lost. A shard named `ABC`
  links and runs.

  This corrects what the previous release notes said. They claimed `JSON`,
  `YAML`, `URI` and `HTTP` were outside the mapping's image and that the
  library-as-artifact thesis waited on a question about iyi's module paths.
  There was no such question: the mistake was reasoning about `underscore`'s
  image rather than `camelcase`'s.

- **`crystal tool bind` says when a root's name cannot survive the trip.** What
  actually falls outside is a name the grammar cannot spell — `Foo_Bar` needs
  two underscores running and `camelcase` reads two as one, so it comes back
  `FooBar`. Both sides mangle alike, so such a root produces an object file
  whose symbols no consumer will ever ask for, and `ld` is four steps too late
  to hear it.

- **A bound shard's iyi module name was the root downcased, and the symbol is
  what that broke.** Both sides mangle alike, so `Greeter.polite` is
  `*Greeter@Greeter::polite<String>:String` compiled from either language — but
  only if the consumer's module *is* `Greeter`, and a consumer builds that name
  by camelcasing the path it imported. `MyGreeter` became `mygreeter` became
  `Mygreeter`, which mangles to a symbol the shard's object file does not
  contain, and nothing said so until the linker did. The name is `underscore`d
  now, which is what `camelcase` inverts, with `::` as `/`.

  With it, a program built from a bound shard links and runs — the first time
  the four steps this tool prints have been taken end to end.

- **The pipeline `crystal tool bind` prints did not run.** A mangled name
  carries the types it was compiled for and a union prints with spaces in it —
  `*JSON::Any#as_a?:(Array(JSON::Any) | Nil)` — so the unquoted `$(...)` in the
  `objcopy` line split 50 of `JSON`'s 301 symbols into fragments and objcopy
  answered with its usage. It is an `xargs -0` now, and the four lines run as
  printed.

- **A boundary can now name another boundary's type, which is what `IO` was
  for.** `JSON`, `YAML` and `URI` all take an `IO`, so binding them is worth
  nothing unless the artifact can say so. The producer calls the type `IO`; a
  consumer that imported it calls it `Io::IO`, and an artifact that wrote the
  first resolved to nothing. Names from the boundaries passed in `--use-iyimod`
  are written the way the consumer will see them, and the modules they came from
  travel as the artifact's `imports`, so `import json` alone is enough — the
  consumer does not have to work out that it needs `import io` as well.

- **A field's type crossed as `IO+`.** That is how a virtual type prints — a
  fact about this build's dispatch rather than a name anybody can write — and a
  field declared `IO+` is one no consumer can read back. `infer_return` had
  devirtualised its answers since it was written; the field walk never did.

- **A bound namespace's artifact named types the consumer could not resolve, and
  nothing had ever tried to read one back.** The tool had no spec at all: every
  check it carried was a number it printed, and a number cannot say whether
  anything can consume the artifact printed beside it. `spec/compiler/bind_spec.cr`
  is that check, and it failed the first time it ran.

  An artifact's module name is the root downcased, and a consumer builds a type
  back out of it by camelcasing — a mapping iyi keeps reversible on purpose
  (SPEC.md IV.6 #6), so `MyLib` returns as `Mylib` and `JSON` is not in its image
  at all. Meanwhile the declarations inside still said `MyLib::Entry`. A class
  root never showed it, because its own name is a declaration in the file and
  `MySink::Entry` resolves against that wherever the module lands. The producer's
  prefix comes off a module root's declarations now, which is the same property
  said directly: what an artifact declares belongs to the artifact.

- **`crystal tool bind` exported methods that take a block nobody annotated.**
  A block-taking method is compiled per block *type*, so one whose block has no
  written type has no single symbol to declare. `infer_return` refused these
  already — but only when it ran, and a method that writes its own return type
  never reaches it. No count showed it; `Time`'s generated keep file did, by
  refusing to compile with *`Time.measure` is expected to be invoked with a
  block*. They are refused and reported on their own line now.

- **`crystal tool bind` can be pointed at the boundaries already written.**
  `--use-iyimod DIR` — the same switch a build uses — reads the `.iyimod` files
  there, and a signature naming one of their types is no longer waiting on
  anybody. Each name is checked against the program rather than trusted, since a
  class root's declarations are absolute and a module root's are relative to a
  name the file does not record; what is dropped is counted and printed.

  It is what closes the question item 12e opened. With `IO`, `Time` and
  `SemanticVersion` bound, `JSON` crosses 168 → 181 signatures, `YAML`
  166 → 192 and `URI` 48 → 55 — the exact gains the unlock report predicts, and
  it predicts them by a different route, which is the two checking each other.

  The counts also stopped calling a free variable a type. `T`, `self` and a
  block returning `_` are not types anybody can declare, and counting them
  beside `IO` said there was more waiting than there was; they have their own
  line now. What is left: `JSON` and `URI` wait on **nothing** anybody could
  declare, and `YAML` waits on `Set` alone — which is generic, so it travels as
  bodies rather than declarations and belongs to a different piece of work.

- **`crystal tool bind`'s keep file never descended into nested types.** A
  nested type travelled as a declaration while its methods were named by
  nobody, so the artifact promised symbols the object file did not carry — a
  link error rather than a compile one, and invisible until something linked.
  `JSON`'s artifact holds 16 types and the keep file reached 9 of them, leaving
  16 methods on the other 7 unemitted. The walk recurses now, and the counts
  printed beside the artifact are counted through the nesting too, having read
  as top-level-only for the same reason.

- **`crystal tool bind` generated a keep file that could not compile when
  pointed at a core type.** A shard's root is a module — `Kemal`, `JSON` — and
  the tool assumed one everywhere: it reopened the root as `module IO`, which is
  a class, and called `IO.write`, which is an instance method. A class root's
  own surface and its constants now stay behind and are reported by name and
  count, rather than being declared with no symbol to link against. What travels
  is the types under it, which is enough to make `crystal tool bind -e IO`
  produce an artifact and an object file end to end.

  It carries the root itself now. A module's own methods are module functions
  and a class's are its type's, so a class root travels as one declaration
  holding everything under it — `IO` with `IO::Memory` and twelve more inside:
  14 types, 148 methods, 311 symbols. Its constants still stay behind.

- **`crystal tool bind` declared private types.** `IO::Encoder` is private, and
  an artifact naming it names a constant the consumer is not allowed to write.
  Method visibility was already checked; the type's was not. The generated keep
  file is what found it, being the first thing outside the shard to say the name
  out loud.

- **`crystal tool bind` counted a signature as crossing when a variable could
  not hold its parameters.** A name being writable is not the same as a value
  being holdable: `Int` is the head of a family, and a method taking one is
  compiled once per member with a symbol apiece, so there is no single symbol
  to declare. `can_be_stored?` is the compiler's own answer and the tool asks
  it now, reporting those signatures on their own line rather than as types
  nobody has declared. It is what the counts above are corrected by — they
  read 182, 168 and 286 before it.

- **`crystal tool bind` read restrictions as text, and it flattered the core.**
  A method inside `JSON::Token` writes `kind : Kind`, which is
  `JSON::Token::Kind` — the shard's own type, already travelling — and the tool
  counted it as a type nobody had declared. `self` went the same way: a method
  returning `self` in `URI` returns `URI` and waits for nobody. Every such
  spelling pushed the "what this boundary is waiting on" list in one direction,
  *towards the core*, which is the claim that list was being used to support.

  Restrictions are resolved against the owning type now. The boundary the tool
  can already write grows by 33 signatures — `JSON` 142 → 152, `YAML` 142 → 158,
  `URI` 41 → 48 — and the percentages of surface needing no human do not move,
  because those measure a different thing and resolution does not touch it. Two
  `YAML` signatures returning a bare `Array` stopped crossing, which is a
  correction rather than a loss: a declaration that says `Array` without saying
  of what is not one a consumer can use.

  With the list true, `IO` is first for all three namespaces and by more than
  before — +13, +21, +8 — against 21 for everything generic. See SPEC.md Part V
  item 12e.

- **The tarball could be built from an unoptimised compiler, and was.** `build:`
  sets `release := 1`; `iyi-tarball` did not, and even asking would not have
  been enough — make rebuilds on file times, so a `.build/iyi` left over from an
  ordinary `make iyi` is newer than every source and gets packaged as it is.
  Nothing about the tarball would look wrong; every build every user ran would
  simply go through an unoptimised compiler. The target now asks the binary
  rather than the build: `--version` says which it is, and packaging refuses
  otherwise.

  This is also why the daemon numbers first published here were about three
  times too generous — they were measured with one of those binaries. See
  SPEC.md IV.1d for the corrected table and for the other two ways the
  measurement was wrong.

- **The tarball could not build a program that requires Kemal.** `install_iyi`
  cut `compiler/` from the copy of Crystal's library it ships, and the standard
  library requires it: `crystal/syntax_highlighter` requires
  `compiler/crystal/syntax`, the exception page requires the highlighter, and
  Kemal requires the exception page. README's headline example did not work in
  the thing people download, and 0.2.0 shipped that way. CI now builds a shard
  out of the unpacked tarball.

- **The build daemon died after serving one build from another directory**, and
  could not find `lib` in the client's project. Three bugs, all older than this
  release and all the same fact forgotten — the daemon runs in its own
  directory and the client does not. The third was that `CrystalPath` is a
  struct, so fixing the second through a getter mutated a copy and changed
  nothing. Every existing daemon spec passed through all three, because each
  passes an absolute path and starts the daemon where the runner is.

- **A build that adopted a preanalysed prelude ignored `--use-iyimod`.** That
  path never runs `new_program`, so a build's switches were whoever analysed
  the prelude's — none. The flags, the target and the prelude are in the
  analysis's cache key and so are safe; `--use-iyimod` is not, and was accepted
  and silently ignored while every module was compiled from source.

- **A constant an artifact reads carries a location.** The reads a consumer
  performs on an artifact's behalf were synthesised without one, and LLVM
  refuses a call with no location inside a function that has debug info. It
  never fired under iyi's own library and fired at once under Crystal's, which
  is where it was found — while looking at whether artifacts and `--crystal`
  can be used together. They now can; this was the first of the three things in
  the way.

### Changed

- **A module path is read from the root, not from where it is written.** A
  module called `samples/calc` importing `calc/lexer` resolved `Calc` to
  itself, then said the module was not imported: a true-looking sentence about
  the wrong thing. A module's path is its file's path (R-1), so it cannot mean
  something different depending on where it appears. Found by writing the
  sample above, which is called `calc`.

- **`Array#sort` is `sort_in_place`, and `sorted` is the copy.** A plain `sort`
  meant the opposite thing in the two libraries — it sorted the array under
  iyi's and returned a copy under Crystal's — with no error either way, which
  is the worst shape a difference can take. The plain verb is not in this
  library now, so the same call is an error under one and Crystal's meaning
  under the other.

  Measured before deciding: of everything iyi's library mutates — `<<`, `[]=`,
  `concat`, `shift`, `sort` — only `sort` disagreed, because Crystal writes `!`
  on the mutating member of a *pair* and plainly for the rest. One method
  today, and the shape every future pair would have had. SPEC.md III.1.7a has
  the three options that were on the table.

  The error teaches the rule: a missing name whose participle exists says so,
  which the suggestion machinery could not — `sort` to `sorted` is two edits.

Master is `0.3.0-dev`. Under the artifact rule 0.2.0 introduced, that means
every build of it interoperates with nothing but itself: a version between two
releases names no compiler, so it cannot be handed one released artifact and
told they match.

## 0.2.0 — 2026-08-20

**A program chooses its library.** 0.1.0 had one, 1,184 lines of it, and that
was most of what stood between the language and anybody's real program. It
turned out not to be a library problem: a prelude is a library and the rules
are the language, so a program can keep one and change the other. `--crystal`
does, and there `require` means what it means in Crystal. Nine shards were
swept through it and a Kemal server written in iyi serves HTTP; how many of the
rest work is not something this release measured.

Two more entries take the rules further out — `pub` reaches a macro and a
constant — and closing each found the same hole underneath: a surface nobody
wrote and nobody could refuse.

Artifacts written by this release are read by every other build of it, on the
same target and under the same flags. A `-dev` version between two releases
names no compiler and interoperates with nothing but itself, which is the rule
below doing its job rather than an exception to it.

### Changed

- **The tarball carries Crystal's library, so `--crystal` works in what people
  download.** It shipped iyi's own 56 KB and nothing else, so the release's
  headline feature answered `require "json"` with "can't find file" outside a
  checkout. It ships both now — 13.4 MB to 14.9 MB — and CI runs a `--crystal`
  program out of the unpacked tarball, which is where this was found and where
  it would have been found again.

- **`make cli_spec` says once when the daemon and the compiler are different
  builds.** The daemon refuses a client built from another compiler, correctly
  — it holds an analysed prelude — but the spec saw that as nine failures, each
  printing two version strings, with the reason in none of them. It is easy to
  arrive at, too: the build commit comes from git HEAD while make compares file
  times, so a commit can leave two binaries disagreeing about a commit while
  agreeing about every line of code.

- **`iyi mod diff` says whether a change reaches a module's consumers.** The
  three hashes an artifact carries already answered it and nothing asked them.
  It compares two `.iyimod` files, says which of interface, implementation and
  source moved — with what each of the three means, because the middle one is
  the surprising one — and names the exports that came and went when the
  interface is what moved. `--exit-code` exits 1 in that case, which is
  `git diff`'s spelling and its reason: the answer is not a failure.

- **An iyi program is run on three targets every build, not one.** It compiled
  for eight and was tested on one, which is a weak thing to call portability.
  CI now cross-compiles `hello.iyi` for musl and for aarch64, links each with
  the target's own `cc` and `libgc` — the command `--cross-compile` prints —
  and runs them: in an Alpine container and under emulation. The check is that
  each prints what the same program printed on the machine that compiled it.

- **`bench/runtime.py` measures what the library costs at run time.** The two
  libraries are within noise where they do the same work; `Hash` is 6x ahead
  and does less; `String` is 1.64x behind. The first reading said string
  building was twenty times faster, and it was the collector — a 17 KB binary
  has fewer roots to scan than a 972 KB one — so the bench reports both columns
  and the honest one is the second.

- **iyi describes itself as its own language, compatible with Crystal.** "A
  language built for Developer & Agentic Experience, Portability, Performance,
  and Efficiency", and README says what stands behind each of the four and what
  does not: the edit loop and the artifact are built, portability means eight
  targets that compile and one that is tested, the run-time measurement is new
  and says the two libraries are within noise where they do the same work, and
  the agentic claim is a mechanism rather than a result.

  Compatibility is stated as something checkable and in one direction: the same
  compiler builds `.cr` files, an iyi program can `require` a shard with
  `--crystal`, and a Crystal program cannot require an iyi module, because R-2's
  written types and R-3's closed types are what an artifact is made of.

  `iyi version` reads `iyi 0.2.0-dev (built on Crystal 1.22.0-dev …)`: the
  language first and what it is built on after. The licence and NOTICE.md are
  unchanged, because Apache 2.0's attribution is an obligation rather than a
  description.

- **An artifact is read by the release that wrote it, not by the build.** A
  `.iyimod` was locked to the exact compiler build, commit and all, so two
  builds of the same version refused each other's modules and handing one to
  somebody meant handing them your compiler too. The identity is now the
  released version, the target and the flags: every build of iyi 0.1.0 reads
  every other build's artifacts on the same target under the same flags. A
  `-dev` version keeps the commit, because it names no release. The version
  comes from `src/IYI_VERSION`, which is also what the binary reports and what
  the tarball is named after.

### Added

- **`iyi build --crystal` compiles a program against Crystal's standard
  library, so `require` reaches the ecosystem.** A `.iyi` file refused
  `require` because there was nothing to require: the prelude is what a program
  gets. That reason stops being true when the prelude is Crystal's. The rules
  do not change with the library — the module header, `pub`, `import`, `using`,
  traits and `impl` are all still there, and a shard is ordinary Crystal
  compiled into the program.

  A Kemal server written this way serves HTTP. What it gives up is R-1 for that
  dependency: the shard is read from source, so the edit loop pays for it the
  way Crystal does. Your own modules are unaffected, and `--emit-iyimod` still
  writes them.

  `crystal tool bind` writes what it generates with `--emit-bind`, its own
  switch, because what it writes is a boundary for a shard rather than this
  build's own modules.

  The two libraries are two modes and do not mix on the artifact side:
  `--use-iyimod` and `--emit-iyimod` need iyi's own prelude. An artifact's
  object code numbers the types its module made, which under Crystal's library
  include the standard library's own, and a consumer compiling its own copy of
  that library has two of everything. That was an LLVM module which would not
  verify; it is a sentence now.

  **Nine shards were swept through it**, each built twice — as an iyi program
  and as a Crystal one, so that a difference is this fork's and a shared
  failure is the ecosystem's. `kemal`, `db`, `ameba`, `habitat`,
  `baked_file_system`, `radix`, `sqlite3`, the standard library's own
  `json`/`yaml`/`uri`/`http`, and a program that round-trips
  `JSON::Serializable` and writes a file. All nine behave the same in both
  languages. One needed a word changed and it was the rule working: `habitat`'s
  macro resolves the type it is handed by name, and a class an iyi module
  leaves unmarked is private, so it needs `pub class`.

  `samples/crystal/stdlib.iyi` is the program CI builds to keep this true: a
  trait with a default, an `impl` on a generic, an error union with `!` and
  `.or`, a `defer`, and JSON, YAML and URI in the same file.

- **`pub` takes a constant.** `pub LIMIT = 42` is reachable through the
  module's name; an unmarked constant is the module's own and is refused by the
  sentence an unmarked `def` gets. Nothing was added to the artifact format,
  because a module's top level already travels as source and the mark travels
  with it.

  The hole under it is the same one `pub macro` found: a constant's visibility
  was never set, so every constant a module declared was reachable. That is
  what a real shard leans on — Kemal hands out every object it has through one.

- **`pub macro`, so a macro can cross a module boundary.** Every macro a module
  writes already travelled in its artifact, because a body that travels may
  call one, but none of them was reachable: `pub` did not take a macro. A
  marked one is now reachable exactly as a `pub def` is, unqualified after
  `using` or through the module's name, and it works against an artifact with
  the module's source deleted. What it exports is a name and an arity, because
  a macro takes syntax and returns syntax.

  Two things worth knowing. Closing this found the hole under it: a macro's
  visibility was never set, so **every** module's macros were already callable
  through its name — that is refused now, with the sentence an unexported `def`
  gets. And macros are not hygienic, so a `pub macro` that writes `tmp = 99`
  assigns to the consumer's `tmp`; SPEC.md IV.4 says so in full.

- **`iyi tool format` formats iyi.** The formatter is Crystal's and knew none
  of iyi's syntax, so a module header, a `pub`, a `trait`, an `impl`, a
  `using`, a bounded `forall`, a `where`, a `defer`, a `!` or an `.or` sent it
  into "there's a bug formatting this file". It knows all of them now, and a
  directory is searched for `.iyi` files as well as `.cr` ones. The prelude and
  the nine samples format to themselves, which is the test that made the last
  three of those show up.

### Fixed

- **A generic imported from an artifact links again when its type argument is
  inferred.** `Box(Int32).new(42)` always worked and `Box.new(42)` did not.
  Inference makes `new` a method on `Box(T)`, which is the artifact's own type,
  and the rule that says "this type's machine code is in the artifact" was
  reading the generic itself. An artifact carries a unit for every non-generic
  type a module declares and none for a generic one, because a generic has
  machine code only once somebody picks its arguments, and the consumer is who
  picks them. So the consumer declared a `new` that nothing defined and the
  program failed to link, saying `undefined reference to Box(T)::new<Int32>`.
  The consumer's rule now matches the producer's. Reported after 0.1.0 went
  out.

- **`Array#sort` sorts the array, and `sorted` hands back a copy.** SPEC.md
  III.1.7(A) settled that pair — the plain verb mutates, the participle copies,
  Swift's convention adopted because `!` had to leave identifiers so postfix
  `!` could propagate an error — and the prelude did not implement it: `sort`
  returned a copy and nothing mutated. It does now, and `sorted` is one line
  over it.

  Worth knowing when moving between the two libraries: Crystal names the same
  pair `sort!` and `sort`, so `a.sort` copies there and sorts here. It is the
  one call in this prelude that means something different under `--crystal`,
  and the note is in `src/iyi/array.iyi` where somebody is standing when it
  matters.

- **A `using` that cannot deliver is refused where it is written.** A module
  header makes a type, and inside it that name means the module — so
  `using app/count::{Tally}` in a module called `tally` asks for a name it
  cannot have. What it said before was that `Tally` was not
  `App::Count::Tally`, at the first line that used one, with nothing pointing
  at the directive. Found by writing a command-line program.

- **`String#size` counts when nobody counted.** Crystal reads `@length == 0` on
  a non-empty string as "not counted yet" and scans; this prelude returned the
  field. A string built by Crystal's own `to_json` therefore printed correctly
  through iyi's `puts` and answered `size` **0** — no error, a wrong number.
  Free for every string this prelude makes, because it fills the field. Found
  while measuring what crosses between the two languages.

- **A macro that cannot see a type says why.** An unresolved path stays a
  `Path`, so every method a macro would call on the type is undefined on that,
  and the message named `Path` rather than the type or the rule:
  `undefined macro method 'Path#constant'`. It now asks whether the path names
  a type that exists and is unexported, and says so when it does. Found by
  `habitat`.

- **The front end reads a `.iyi` file again.** Refusing `require` in a `.iyi`
  file spares the prelude's own, and the flag that says so was set in the
  driver but not in `crystal-front`, so the front-end binary refused the line
  it had just written itself. It is bench-only and ships in nothing.

- **A version bump takes effect.** `src/VERSION` and `src/IYI_VERSION` are
  compiled in with `read_file`, and the build did not depend on them, so
  changing the number changed nothing until something else did.

## 0.1.0 — 2026-08-18

The first release. There is nothing to compare it against, so this says what is
in it rather than what changed, and what a later version will have to keep
faith with.

### The language

Four rules, and everything else follows from them (SPEC.md):

- **R-1** A module is the unit of compilation. `import` forms a DAG, and
  compiling a module reads its imports' declarations, never their bodies.
- **R-2** Everything a module exports (`pub`) writes down full parameter and
  return types.
- **R-2b** `using` brings exported names into unqualified scope, written by the
  consumer.
- **R-3** No open classes. `impl Trait for Type` lives in the module that
  declares the trait or the one that declares the type.

Traits with defaults and associated types, generic impls with `forall`, errors
as ordinary union members with `!` propagation, `defer` scoped to the block,
and Crystal's syntax otherwise: union types, nil-safety, blocks, local
inference, macros.

### The artifact

`.iyimod` **format v19**. A module's declarations, its macros, the bodies that
have to travel, its object code, and a checksum per section. Artifacts are
version-locked: one written by another build of the compiler is refused and
rebuilt, never migrated, so a later version bumping this number is expected
rather than a breakage.

`iyi build --emit-iyimod DIR` writes them, `--use-iyimod DIR` builds against
them, and `iyi mod dump` prints one as text.

### The tool

`iyi` takes `build`, `run`, `mod`, `env`, `clear_cache`, `tool`, `version` and
`help`. `crystal` is the same compiler under its own name, and it still
compiles `.cr` files. `eval` is deliberately not on iyi's list: it has no
filename, so it gets Crystal's prelude and Crystal's rules, and a command that
answers in another language is worse than one that says where it went.

### Measured

One machine, release compiler, best of seven, seconds. A 30-module,
7,208-line project, rebuilt after changing one line in one module:

| | iyi | Crystal | `go build` |
|---|---|---|---|
| rebuild after one edit | **0.13** | 1.17 | 0.16 |

The same edit with every module read from source instead of from artifacts
costs 0.23 s, which is what R-1 is worth on this project. A full build of a
6,900-line program from scratch is 0.24 s against `go build`'s 0.09 s, which is
where iyi loses. `python3 bench/incremental.py` and `python3
bench/build_speed.py` print both, and refuse to time programs that do not agree
on their output.

### Not in this release

No IO beyond `puts`. No concurrency: SPEC.md III.4 specifies it and none of it
is built. No package manager, no standard library, no self-hosting. Linux
x86-64 only. `derive` macros do not cross modules. The prelude is 1,184 lines
and its collections are small, and `a[-1]` raises rather than indexing from the
end. The formatter is Crystal's and does not know iyi's syntax: `iyi tool
format` says so and leaves `.iyi` files alone.

### Provenance

A fork of [Crystal](https://github.com/crystal-lang/crystal) at 1.22.0-dev,
Apache 2.0 with Swift exception, Copyright 2012-2026 Manas Technology
Solutions. The backend, the GC and the type checker are Crystal's work. The
compiler reports itself as `Crystal 1.22.0-dev` because that is what it is, and
it is bootstrapped by released Crystal 1.21.0, which is the version CI pins
and the one to install if you are building this from source.

Two bugs in Crystal's own compiler were found here and fixed in this fork; they
belong upstream and are separate commits for that reason:

- `Crystal.relative_filename` chopped the working directory off any path that
  merely began with its name, so a build in `/x/crystal` with a cache in
  `/x/crystal-cache` wrote its object files to `-cache/…`.
- The cache cleaner deleted the directory of a build that was still running,
  because it keeps the ten most recently modified directories and a build stops
  looking recent while its units sit in an optimization pass.
