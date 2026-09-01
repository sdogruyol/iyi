# A playground on GitHub Pages: what iyi can and cannot do client side

GitHub Pages serves bytes. There is no server-side compute, so anything the
visitor "runs" has to run in their browser. The proposal was a playground plus
an interactive learning section, on the assumption that "since we compile to
wasm, we can run the playground completely client side".

That sentence conflates two different claims, and they have different answers:

- **(A) iyi compiles programs that target wasm.** True, and already in CI.
- **(B) The iyi compiler itself runs inside a browser.** Not today. The
  measurements below say exactly what stops it.

A live playground in the ordinary sense needs (B). What (A) buys is different
and, as it turns out, more than expected: it is enough for a learning section
whose examples genuinely execute in the visitor's browser.

## Verdict

Two tiers, and they are independent.

| Tier | What the visitor gets | Reachable client side today |
|---|---|---|
| Two | Curated examples that actually run, with real output | **Yes. Measured, working, nothing new required.** |
| One | Live type checking, real iyi diagnostics, as they type | **No. Six named blockers, one of them structural.** |
| Three | Live full compilation to a binary in the browser | **No, and not worth pursuing.** |

Tier two is done in the sense that matters: the artifacts build, link, load in
V8, and print the same bytes as a native run, under a pure JavaScript WASI
implementation. Tier one gets remarkably far and then hits one wall that is not
a matter of effort ordering: **`raise` on wasm32 does not unwind, it prints and
exits**, and iyi's semantic analysis uses exceptions as ordinary control flow.

## How this was measured

Everything below is either a quoted line from this worktree or a command that
was run with its real output. Provenance, because a stale tree would invalidate
the citations:

- Source under test: this worktree, cut from `origin/master` after a fetch.
  `git rev-parse HEAD` and `git rev-parse origin/master` both print
  `13306c922289ae606640749f173a115796d90071`, and that also equals
  `origin/HEAD`.
- Bootstrap compiler used to build everything: `.build/crystal` and
  `.build/iyi` from the primary checkout, which reports
  `iyi 0.3.0-dev (built on Crystal 1.22.0-dev [af509de9e] (2026-08-23))`, and
  which prints `The compiler was not built in release mode.` That binary was
  built from a commit ahead of `origin/master`, so **it is used only as the
  compiler, never as evidence.** Every artifact measured here was compiled from
  this worktree's source, and the two binaries whose link surface is quoted
  were rebuilt from this worktree.
- Host: macOS arm64, Homebrew LLVM 22.1.8, Node v26.7.0.
- wasm toolchain: wasi-sdk 24 for arm64 macOS, fetched to `/tmp/wasi-sdk`.
  `wasmtime` is not installed on this machine, which turned out not to matter,
  see tier two.
- Where a build needed a source change to get past a defect, the change is
  marked `PROBE ONLY, not for commit` in the diff and is **not** part of this
  branch. The probes exist so the next blocker could be found rather than
  guessed at. Each is named below.

## 1. Codegen goes through LLVM, and nothing else does

`src/compiler/requires.cr` pulls codegen by glob, so the ordinary compiler gets
all of it:

```
6:require "./iyi/codegen/*"
```

and inside that directory the requires are unconditional:

`src/compiler/iyi/codegen/codegen.cr`
```
1:require "llvm"
```

`src/compiler/iyi/codegen/llvm_typer.cr`
```
2:require "llvm"
```

The version surface. `Makefile` discovers `llvm-config` and reads its version:

```
94:ifeq ($(LLVM_VERSION),)
95:	ifndef LLVM_CONFIG
96:  	LLVM_CONFIG := $(shell src/llvm/ext/find-llvm-config.sh)
97:	endif
98:	LLVM_VERSION := $(if $(LLVM_CONFIG),$(shell "$(LLVM_CONFIG)" --version 2> /dev/null))
99:endif
```

The accepted set is a file, `src/llvm/ext/llvm-versions.txt`:

```
1:23.0 22.1 21.1 20.1 19.1 18.1 17.0 16.0 15.0 14.0 13.0 12.0 11.1 11.0 10.0 9.0 8.0
```

`README.md` line 429 states the practical floor: "Building it instead needs LLVM
19 and a Crystal compiler to bootstrap from". Note that this machine built the
compiler against LLVM 22.1.8, so the README's figure is a supported version
rather than a hard requirement.

There is a C++ shim, but only for older LLVM. `Makefile`:

```
148:ifneq ($(LLVM_VERSION),)
149:  ifeq ($(shell test $(firstword $(subst ., ,$(LLVM_VERSION))) -ge 18; echo $$?),0)
150:    DEPS =
151:  endif
152:endif
```

```
490:	$(CXX) -c $(CXXFLAGS) -o $@ $< $(if $(LLVM_CONFIG),$(shell $(LLVM_CONFIG) --cxxflags))
```

so on LLVM 18 or newer, `LLVM_EXT_OBJ` drops out and no C++ compilation is
needed. There is no alternative codegen backend in the tree: no bytecode
emitter, no direct object writer, no non-LLVM wasm path.

## 2. The front end already exists as a binary that links no LLVM

This is the finding the whole question turns on, and it was already built
before this investigation started.

`src/compiler/crystal_front.cr` is a second entry point whose defining property
is the absence of the code generator. Line 16:

```
16:{% raise "crystal_front.cr is the front end without LLVM: build it with -Dwithout_llvm" unless flag?(:without_llvm) %}
```

It does not use the glob. It names its requires one at a time, and says why:

```
18:# Named one by one rather than globbed, because the glob is what pulls in the
19:# half this binary is defined by not having: `compiler.cr` and `command.cr` are
20:# a code generator's driver and speak LLVM on every other line.
```

`Makefile` builds it:

```
236:crystal-front: $(O)/crystal-front$(EXE) ## iyi: build the front end, which links no LLVM
```

```
481:	  ./bin/crystal build $(FLAGS) $(COMPILER_FLAGS) -Dwithout_llvm -o $@ src/compiler/crystal_front.cr
```

and note that this is the only build rule among the compiler targets that does
**not** call `$(call check_llvm_config)`.

The flag is threaded through the places outside codegen that name LLVM.
`src/compiler/iyi/program.cr`:

```
4:{% if flag?(:without_llvm) %}
5:  require "./llvm_shim"
6:{% else %}
7:  require "llvm"
```

`src/compiler/iyi/llvm_shim.cr` explains its own size, and the number is the
reason the split was worth doing:

```
15:# Required in place of `llvm` under `-Dwithout_llvm`, and nowhere else. What it
16:# has to cover is small, which is the finding that made the split worth trying:
17:# outside codegen the compiler names `LLVM` in four places, and three of them
18:# are strings decided when this binary was built.
```

Two consequences that both matter for the website.

**`--no-codegen` does not avoid linking LLVM.** The flag exists (verified:
`iyi build --help` prints `--no-codegen                 Don't do code generation`)
but it changes what runs, not what is linked. `crystal_front.cr` says so in its
own header:

```
5:# **Why it exists is a measurement.** `crystal build --no-codegen` never calls
6:# LLVM and pays 0.026 s for linking it anyway: libLLVM's load-time initialisers
7:# are charged to any process with a `NEEDED` entry on the library, whether or
8:# not it generates code.
```

So the flag that exists at the CLI is not the one that matters here. The one
that matters is the build flag, `-Dwithout_llvm`, and it selects a different
entry point rather than a different build of the same one.

**`make crystal-front` is currently broken on `origin/master`.** Two defects,
both from the hand-written require list falling behind the glob. First:

```
$ crystal build --no-codegen -Dwithout_llvm src/compiler/crystal_front.cr
In src/compiler/iyi/macros/methods.cr:971:11
 971 | Rx::Pattern.compile(source, ignore_case: options.ignore_case?)
Error: undefined constant Rx::Pattern
```

`requires.cr` line 3 is `require "./iyi/*"`, which picks up `rx.cr`.
`crystal_front.cr` lists files individually and does not name it. Adding
`require "./iyi/rx"` clears it. Then:

```
In src/compiler/iyi/codegen/cache_dir.cr:107:33
 107 | io.puts "#{Iyi::Command.program_name} needs a cache directory. ..."
Error: undefined method 'program_name' for Iyi::Command.class
```

`cache_dir.cr` is required by `crystal_front.cr` line 51, and it reads
`Iyi::Command.program_name`, defined at `src/compiler/iyi/command.cr` line 39
as `class_property program_name : String = "crystal"`. `command.cr` is
precisely the file this binary is defined by not having. A two-line stub clears
it.

With those two additions the front end builds, and its link surface is the
claim it was built to make. Rebuilt from this worktree with the Makefile's own
`COMPILER_FLAGS`:

```
$ otool -L crystal-front2
	/opt/homebrew/opt/bdw-gc/lib/libgc.1.dylib
	/usr/lib/libSystem.B.dylib
```

Two libraries. No `libLLVM`, no `libc++`. For contrast, the ordinary compiler
rebuilt from the same worktree with the same flags:

```
$ otool -L iyi-fresh2
	/opt/homebrew/opt/llvm/lib/libLLVM.dylib (current version 22.1.8)
	/usr/lib/libc++.1.dylib
	/opt/homebrew/opt/bdw-gc/lib/libgc.1.dylib
	/usr/lib/libSystem.B.dylib
```

And the front end does the thing the website would want it to do. Given a
trait-bound violation it prints iyi's real diagnostic:

```
$ IYI_PATH=src ./crystal-front2 bad.iyi
In bad.iyi:24:6

 24 | puts announce(42)
           ^-------
Error: Int32 does not implement Samples::Bad::Greet, required by `T` in `announce`
```

That output, in a browser, with no server, is the demo.

## 3. Linking always shells out, including on wasm

`src/compiler/iyi/compiler.cr` line 46:

```
46:    DEFAULT_LINKER = ENV["CC"]? || {{ env("IYI_CONFIG_CC") || "cc" }}
```

resolved through `PATH`. The wasm branch deliberately names the driver rather
than `wasm-ld`, and says why:

```
1810:      elsif program.has_flag? "wasm32"
1811:        # iyi: the compiler driver rather than `wasm-ld`, because a wasi program
1812:        # is more than the module. wasi-libc's `crt1.o` is what exports `_start`
1813:        # and calls `__main_argc_argv`; `wasm-ld -lc` on its own links a module
1814:        # with no entry, which every host refuses to start. Only the driver knows
1815:        # where its sysroot keeps that object, so naming the driver is the only
1816:        # way to print a command that produces a program.
1818:        link_flags += " --target=wasm32-wasi"
```

The subprocess is spawned in `run_linker`:

```
2551:    private def run_linker(linker_name, command, args)
2555:        Process.run(command, args, shell: true,
```

`--cross-compile` is the escape hatch: it emits the object and prints the
command instead of running it.

```
1744:    private def cross_compile(program, units, output_filename)
1757:      _, command, args = linker_command(program, object_names, output_filename, nil)
1758:      print_command(command, args)
```

Confirmed by running it:

```
$ .build/iyi build --cross-compile --target wasm32-wasi -o hello-wasi samples/iyi/hello.iyi
cc /tmp/iyiwasm/hello-wasi.wasm -o /tmp/iyiwasm/hello-wasi  --target=wasm32-wasi -L.../lib/iyi
```

This is load bearing for the website: **the link step can be done in CI, once,
and the browser never needs a linker.** That is what makes tier two possible
and it is also why tier three is not.

## 4. There is an interpreter, and it needs no LLVM

`src/compiler/iyi/command.cr` registers it:

```
126:      elsif command == "repl"
```

and it is built on the macro evaluator rather than on a bytecode VM.
`SPEC.md` line 6799 records the decision: "The base is
`src/compiler/iyi/macros/interpreter.cr`, 781 lines, a complete AST evaluator
that already resolves types... No C interop, so no libffi".

For the website this is less useful than it first looks. The REPL evaluates on
the macro interpreter, so it is a subset of the language rather than the
language, and it is compiled into the same binary as everything else. It does
not give a smaller thing to ship, and it inherits every wasm blocker in section
7 because it is reached through the same front end. The front-end binary is the
better target: it is smaller, it is already LLVM free, and its output is the
product.

## 5. C dependency surface, measured rather than quoted

Both binaries rebuilt from this worktree at `13306c922`, with the Makefile's
`COMPILER_FLAGS` (`-Dwithout_openssl -Dwithout_zlib -Dwithout_iconv`, `Makefile`
line 62):

| Binary | Size | Dynamic libraries |
|---|---|---|
| the compiler | 38,501,640 bytes | `libLLVM` 22.1.8, `libc++`, `libgc`, `libSystem` |
| the front end | 30,966,176 bytes | `libgc`, `libSystem` |

Absent from both: pcre2, libevent, libxml2, openssl, libz, libiconv, libffi,
libgmp, libyaml. The regex engine is in-tree at `src/compiler/iyi/rx.cr`.

One caveat worth stating because it is a trap: omitting the Makefile's flags
adds `libiconv` to both. A build done without `COMPILER_FLAGS` produced five
libraries for the compiler rather than four. The four-library figure is real,
but it is a property of how the Makefile builds, not of the source alone.

For a compiled user program, `bench/dependency_floor.sh` gates the floor:

```
59:ALLOWED_LIBS_PROGRAM="libSystem libc.so ld-linux libgcc_s"
```

The GC is opt in but the default is on. `src/gc.cr` lines 155 to 159:

```
155:{% if flag?(:gc_none) || flag?(:wasm32) %}
156:  require "gc/none"
157:{% else %}
158:  require "gc/boehm"
159:{% end %}
```

so a default native build uses the boehm collector and links `libgc`, and a
wasm32 build always uses `gc/none`, which is why the wasm samples above carry
no collector. `-Dgc_none` selects `gc/none` on native targets too.

## 6. Tier two: precompiled wasm runs client side. Proven.

This is the part that works today, and the proof is stronger than the CI's,
because CI runs the module under `wasmtime`, which is native. A browser needs a
JavaScript WASI implementation instead. So the module was run under
`node:wasi`, which is a JavaScript WASI preview1 implementation running on V8,
the same engine as Chrome. Nothing native is involved beyond the JS engine.

Every sample in `samples/iyi/` cross-compiles and links for wasm32-wasi:

```
basics         OK     99063 bytes      immutable      OK    124526 bytes
calc           OK    116776 bytes      init_order     OK     79246 bytes
collections    OK    147289 bytes      modules        OK     81022 bytes
derive         OK     83772 bytes      webapp         OK    110140 bytes
errors         OK     89441 bytes      files          OK     78642 bytes
files          OK     78642 bytes
formatting     OK     92570 bytes
generics       OK     92957 bytes
hello          OK     85952 bytes
ok=13 fail=0
```

78 KB to 147 KB each, and those are unstripped debug builds. Then each was run
under the JS WASI shim and compared byte for byte against the native run:

```
basics         same output      immutable      same output
calc           same output      init_order     same output
collections    same output      modules        same output
derive         same output      webapp         same output
errors         same output      formatting     same output
files          DIFFERS          generics       same output
hello          same output
same=12 differs=1
```

The import surface is tiny. Reading the linked `hello` module's imports with
`WebAssembly.Module.imports`:

```
IMPORTS:
  wasi_snapshot_preview1.args_get (function)
  wasi_snapshot_preview1.args_sizes_get (function)
  wasi_snapshot_preview1.fd_write (function)
  wasi_snapshot_preview1.proc_exit (function)
EXPORTS:
  memory (memory), _start (function), memset, __multi3, main, __main_argc_argv
```

Four functions, all `wasi_snapshot_preview1`, and `puts` does bottom out in
`fd_write` as expected. Any browser WASI shim implements all four, and two of
them are trivial. `README.md` line 426 is confirmed: "A wasm32 build is one
self-contained module already."

The one exception is real and must be handled rather than papered over.
`samples/iyi/files.iyi` compiles and links, then refuses at run time:

```
$ diff files.native files.wasmout
1,5c1
< hello from iyi
<
< true
< false
< false
---
> iyi: panic: File is not available on wasm32-wasi: path_open needs a preopened directory fd
```

That message is deliberate, from `src/iyi/prelude.iyi` line 372:

```
372:    raise "File is not available on wasm32-wasi: path_open needs a preopened directory fd"
```

Note this is a prelude limitation, not a WASI one: the shim in this experiment
did supply a preopened root and the prelude refuses anyway. So the file sample
either gets no run button, or its expected output is recorded as that panic.

**What tier two requires:** a CI job that cross-compiles each curated example
for wasm32-wasi and links it with wasi-sdk's clang, committing the `.wasm`
alongside the site, plus a WASI shim in the page. CI already does the
cross-compile and the link for one sample, so the job is an extension of
`.github/workflows/iyi.yml` rather than a new capability. Difficulty: low. No
compiler changes.

## 7. Tier one: the front end as wasm. The crux experiment.

The question was whether the compiler's own source survives the wasm32-wasi
target, given that wasi has no threads and no subprocesses and a front end
reads files. It was attempted rather than argued about.

**It gets very far.** The front end cross-compiles, links, loads in V8, starts,
reads its arguments, opens and reads the prelude off a WASI filesystem, and
runs thousands of frames into its own semantic analysis. Then it dies, for a
reason that is not about any of the things that were expected to break.

Here is the sequence, each blocker found by clearing the previous one.

### Blocker 1 and 2: `crystal-front` does not build at all
Covered in section 2. `Rx::Pattern` undefined, then `Iyi::Command.program_name`
undefined. Both are the hand-written require list
falling behind `requires.cr`'s glob. Difficulty: trivial. These are worth
fixing regardless of the website, because they mean a documented Makefile
target is broken on master.

### Blocker 3: host libc detection instantiates `Process.run`

```
In src/compiler/iyi/config.cr:122:17
 122 | Process.run("ldd", {"--version"}, output: io, error: io)
Error: instantiating 'Process.run(...)'
...
In src/process.cr:550:46
 550 | prepared_args = Crystal::System::Process.prepare_args(command, args, shell)
Error: undefined method 'prepare_args' for Crystal::System::Process.class
```

`Config.host_target` has a `if target.linux?` branch that shells out to `ldd`
to tell gnu from musl. The branch is a run-time test, so it never executes for
a wasm build, but it is still type-checked and instantiated, and wasi has no
subprocess backend. Difficulty: trivial, a `flag?(:wasm32)` gate.

### Blocker 4: the macro `system` shell-out

```
In src/compiler/iyi/macros/methods.cr:256
 256 | result = `#{cmd}`
```

`interpret_system` implements the macro-level shell-out. Same cause: no
subprocesses on wasi. Unlike blocker 3 this one is a real language feature
being removed, so the honest form is a compile error saying so, not a silent
gate. Difficulty: trivial. Consequence: a browser front end cannot type-check
code that uses `{{ system(...) }}`.

### Blocker 5: a Crystal-prelude program cannot be linked for wasm32-wasi

This one is a defect independent of the website, and it reproduces in one line
of Crystal:

```
$ crystal build --cross-compile --target wasm32-wasi -o hi hi.cr
cc /tmp/iyiwasm/hi.wasm -o /tmp/iyiwasm/hi  --target=wasm32-wasi -L.../lib/iyi
$ cc /tmp/iyiwasm/hi.wasm -o /tmp/iyiwasm/hi --target=wasm32-wasi
wasm-ld: error: duplicate symbol: _start
>>> defined in .../share/wasi-sysroot/lib/wasm32-wasi/crt1-command.o
>>> defined in /tmp/iyiwasm/hi.wasm
```

where `hi.cr` is `puts "hi from crystal"`. The Crystal stdlib defines its own
entry, `src/crystal/system/wasi/main.cr` line 23:

```
23:fun _start
```

while iyi's own prelude deliberately does not, and explains why at
`src/iyi/prelude.iyi` line 1535:

```
1535:  # iyi: wasi-libc's `crt1-command.o` is what exports `_start`, and what it
1536:  # calls is not `main`. Clang renames a C `main` to `__main_argc_argv` or
1537:  # `__main_void` depending on its parameters, and the entry stub calls that
```

So the fork fixed the wasm32 entry model for iyi's prelude and the Crystal
prelude still collides with it. CI does not catch this because the wasm32-wasi
job type-checks `.cr` and only links and runs the `.iyi` sample:
`.github/workflows/iyi.yml` line 326 cross-compiles `/tmp/hi.cr` for the target
list and checks the object, while line 420 links and runs
`samples/iyi/hello.iyi`. Difficulty: low, and the fix is the same choice the
iyi prelude already made. Worked around here with `-nostartfiles`.

### Blocker 6: the default build has no execution context on wasi

With the link done, the module loads and dies at the first write:

```
EXITING: Attempting to raise:
Thread#execution_context cannot be nil (NilAssertionError)
    at *Thread#execution_context:Fiber::ExecutionContext
    at *Fiber::ExecutionContext::current:Fiber::ExecutionContext
    at *Crystal::EventLoop::current:Crystal::EventLoop+
    at *IO::FileDescriptor@Crystal::System::FileDescriptor#system_write<Slice(UInt8)>:Int32
```

The gate is `src/crystal/event_loop.cr` line 49:

```
49:    {% if !flag?(:without_mt) && !flag?(:preview_mt) || flag?(:execution_context) %}
50:      Fiber::ExecutionContext.current.event_loop
```

so the default build routes IO through an execution context that the wasi
runtime never establishes. `-Dwithout_mt` avoids it and is an already-supported
flag: the Makefile builds the daemon with it, line 466. With `-Dwithout_mt`,
`puts` works and file IO fails one level further in:

```
before
EXITING: Attempting to raise:
Not Implemented: Crystal::Wasi::EventLoop#open (NotImplementedError)
```

from `src/crystal/event_loop/wasi.cr` line 65. Note that in the same file,
`read` and `write` on file descriptors **are** implemented against `LibC.read`
and `LibC.write`; only `open` raises. And `LibC.open` is bound for the target,
`src/lib_c/wasm32-wasi/c/fcntl.cr` line 24:

```
24:  fun open(x0 : Char*, x1 : Int, ...) : Int
```

An eight-line `open` in the shape of `src/crystal/event_loop/libevent.cr` line
135 makes `File.read` work on wasm under the JS shim:

```
$ node runwasi.mjs fr3 hi.cr
before
1
after
```

Also unimplemented and reached by the front end:
`Crystal::System::File.realpath` at `src/crystal/system/wasi/file.cr` line 21,
called from `Process.executable_path` because `Iyi::IyiPath.expand_paths`
expands `$ORIGIN`. Difficulty for all of this: low to moderate. It is stdlib
work on a target that already exists, not new architecture.

Worth stating separately: stdin and stderr work on wasi with no changes at all.
A probe reading `STDIN.gets_to_end` and writing to `STDERR` printed
`got 62 bytes, 3 lines` and `stderr works`. That is the entire IO channel a
browser type-checker needs, which means blocker 6 could be sidestepped for
user source, though not for the prelude.

### The wall: `raise` on wasm32 does not unwind

With blockers 1 through 6 cleared, the wasm front end reads the prelude and
runs deep into type analysis. It then dies here:

```
EXITING: Attempting to raise:
 (Iyi::Call::RetryLookupWithLiterals)
    at *Iyi::Call#raise_matches_not_found<...>:NoReturn
    at *Iyi::Call#lookup_matches_in_type<...>:Array(Iyi::Def+)
    at *Iyi::Call#lookup_matches:Array(Iyi::Def+)
    at *Iyi::Call#recalculate:Nil
```

`RetryLookupWithLiterals` is not an error. It is the compiler using an
exception as control flow, thrown and caught inside method lookup. On wasm32 it
cannot be caught, because `src/raise.cr` lines 240 to 245 are the whole of the
wasm32 exception story:

```
240:{% if flag?(:wasm32) %}
241:  def raise(exception : Exception) : NoReturn
242:    Crystal::System.print_error "EXITING: Attempting to raise:\n%s\n", exception.inspect_with_backtrace
243:    LibIntrinsics.debugtrap
244:    LibC.exit(1)
245:  end
```

Print and exit. There is no unwinding, so `begin`/`rescue` does not work at
all. Proven with three lines:

```
$ cat exc.cr
puts "before"
begin
  raise "boom"
rescue ex
  puts "rescued: #{ex.message}"
end
puts "after"

$ node runwasi.mjs exc          # wasm32-wasi
before
EXITING: Attempting to raise:
boom (Exception)

$ crystal run exc.cr            # native, same source
before
rescued: boom
after
```

Nothing in the tree implements the WebAssembly exception-handling proposal. A
search across `src/`, `SPEC.md`, `README.md` and `CHANGELOG.md` for
`fwasm-exceptions`, `mexception`, `wasm_eh` and `exception handling` returns
only Windows SEH and Itanium unwinding, and `src/exception/lib_unwind.cr`
binds `LibUnwind`, which has no wasm implementation.

This blocks tier one twice over, and the second way is worse than the first:

1. Semantic analysis uses exceptions internally, so it cannot complete.
2. Even if it could, iyi reports diagnostics **by raising**.
   `src/compiler/crystal_front.cr` lines 91 to 104 rescue `Iyi::CodeError` and
   `Iyi::Error` to render the message with a location and a caret. A wasm build
   would print a panic instead of a diagnostic, which destroys the exact thing
   the demo exists to show.

**What clearing this actually requires,** in dependency order:

1. Codegen emits wasm exception-handling instructions (`try`/`catch`/`throw`)
   for the wasm32 target instead of the Itanium landing-pad path in
   `src/compiler/iyi/codegen/exception.cr`, and passes
   `-mexception-handling` style options through to LLVM.
2. A wasm personality and a `__crystal_raise` that throws a wasm exception
   rather than calling `LibC.exit`, replacing `src/raise.cr` lines 240 to 245.
3. Linking against a wasi-libc built with exception handling enabled.

That is compiler and runtime work on the codegen path, which is the part of the
tree the front-end split was designed to stay out of. It is not a flag, and it
is not stdlib patching. It is the single item that decides whether tier one is
reachable, and it is the only item on this list that is genuinely hard.

### The bundle, if it were reachable

The front end does produce a working wasm module today, so the size question
has a real answer rather than an estimate. Release build, `--no-debug`,
stripped, linked:

```
10,691,128  cfr         raw
 2,128,573  cfr.gz      gzip -9
 1,215,513  cfr.br      brotli -9
```

10.2 MB raw, 2.0 MB gzipped, 1.2 MB brotli, with no DWARF. The debug build,
for contrast, is 30.8 MB raw and 7.4 MB gzipped, so the release numbers are
the ones a site would ship. **The bundle carries no LLVM**: the module's
imports are 20 `wasi_snapshot_preview1` functions and nothing else, no C
library at all. The prelude source would have to ship alongside it, which
`README.md` line 328 puts at 100 KB, served through the shim's in-memory
filesystem. So the shape of a tier-one bundle is a wasm module of about 1 MB
over the wire plus 100 KB of prelude text, not the LLVM plus wasi-libc plus
wasm-ld plus stdlib pile the original framing assumed. That is a much better
bundle than expected, and it is still gated behind the exception wall.


## 8. Tier three: the full compile path in the browser

No, and this one is not close.

The compiler links `libLLVM` unconditionally (section 1: the glob in
`requires.cr`, the unconditional `require "llvm"` in `codegen.cr` and
`llvm_typer.cr`, and the measured `otool -L`). Compiling LLVM itself to
wasm32-wasi is a project in its own right and would be the dominant term in the
bundle. On top of that, producing a runnable artifact needs a linker as a
separate process (section 3), and there are no subprocesses on wasi, so
`wasm-ld` would itself have to be in the bundle and driven in-process. And
`README.md` line 854 says plainly "No package manager and no self-hosting", so
the compiler is Crystal source compiled by a Crystal compiler, meaning the
whole bootstrap chain is what would have to survive the target.

Every blocker from tier one applies here too, plus LLVM, plus a linker. Do not
pursue this.

## 9. Ranked architectures

Ranked by value delivered per unit of difficulty, given what sections 6 and 7
actually measured.

### 1. Precompiled examples that run, plus a real editor that does not compile

Curated `.iyi` examples cross-compiled to wasm32-wasi in CI, committed as
`.wasm`, executed in the page under a JS WASI shim. The editor is real, with
iyi syntax highlighting, and its samples run and print. What it does not do is
check code the visitor typed.

- **Requires:** a CI job extending the cross-compile and link that
  `.github/workflows/iyi.yml` already runs, plus a WASI shim in the page.
- **Proven:** yes, section 6. 12 of 13 samples byte-identical to native.
- **Difficulty:** low. No compiler changes.
- **Honest limit:** the visitor cannot run their own code. Say so in the UI
  rather than letting them discover it.
- Note the tree already ships a highlighter, `src/crystal/syntax_highlighter/html.cr`,
  so the editor's colouring can come from the compiler's own lexer rather than
  from a hand-maintained grammar that will drift.

### 2. Add live type checking, once the exception wall is down

The same page, plus the front end as a wasm module doing real semantic analysis
on what the visitor typed, printing iyi's actual diagnostics. This is the
compelling thing, and given iyi's pitch is its errors and its checking against
declarations, it is arguably the product itself.

- **Requires, in order:** blockers 1 and 2 (trivial), 3 and 4 (trivial), 5
  (low), 6 (low to moderate), then wasm exception handling in codegen and the
  runtime (hard, section 7). The last item is the whole cost.
- **Proven:** the pipeline up to the wall is proven. The wall is proven too.
- **Difficulty:** dominated by one hard item on the codegen path.
- **Payoff if it lands:** a language site where the type checker runs in the
  visitor's browser. Almost nobody has that.

### 3. No live compilation at all: recorded output only

Editor with highlighting, examples with their output written into the page as
text, no wasm anywhere.

- **Requires:** nothing.
- **Difficulty:** trivial.
- **Why it is ranked below 1:** option 1 costs very little more and the
  examples genuinely execute, which is a materially different claim to a
  visitor. There is no reason to pick this over 1 unless the WASI shim itself
  is unwanted.

### 4. A server-side compile service

This violates the Pages-only constraint, and it should be named rather than
quietly assumed away. A small service that runs the real compiler would give
full live compilation immediately, since the compiler already works. But it is
not GitHub Pages, it needs hosting, it needs sandboxing because it executes
submitted code, and it needs abuse controls. If the constraint is genuinely
Pages-only, this is out. If the constraint is negotiable, this is the only
option that delivers real compilation without the exception work.

## 10. Defects found on the way, worth filing regardless

These are independent of the website. Each was reproduced.

1. `make crystal-front` fails on `origin/master`: `Rx::Pattern` undefined
   (`src/compiler/crystal_front.cr` does not require `./iyi/rx`, which
   `requires.cr` line 3 picks up by glob).
2. `make crystal-front` also fails on `Iyi::Command.program_name`, read by
   `src/compiler/iyi/codegen/cache_dir.cr` line 107, defined in the one file
   that entry point deliberately excludes.
3. A `.cr` program cross-compiled for wasm32-wasi cannot be linked with the
   command the compiler itself prints: `duplicate symbol: _start` against
   wasi-libc's `crt1-command.o`. Reproduced with `puts "hi from crystal"`. CI
   misses it because the wasm32-wasi job type-checks `.cr` objects and only
   links the `.iyi` sample.
4. `Config.linux_runtime_libc` instantiates `Process.run` on every target,
   including targets with no subprocess support.

Items 1 and 2 mean a Makefile target documented as "build the front end, which
links no LLVM" does not currently build. Given that the front end is the
standing proof behind the fork's front-end timing claims, and given it is the
foundation of the most valuable version of this website, that is the one to fix
first.
