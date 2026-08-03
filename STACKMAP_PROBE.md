# gcry stackmap probe (`gcry-stackmap-probe`)

Experimental: when `CRYSTAL_EMIT_STACKMAP=1`, emit
`llvm.experimental.stackmap` after each Crystal call site with **live GC
pointer locals** from `context.vars` (`codegen/call.cr`), and link with
`-no-pie` so `.llvm_stackmaps` absolute relocs succeed.

See sibling: `gcry/docs/STACK_MAPS.md`.

## Results (2026-08-03)

- IR contains `@llvm.experimental.stackmap` with live `ptr` args
  (e.g. `%sm.s`, `%sm.x` for `String` locals).
- Filter: `Pointer` + non-`passed_by_value` `has_inner_pointers?` types;
  skip Proc/union-by-value for now; cap 32 lives; alloca must belong to
  current function.
- Emit prefers the **alloca address** (not a load) so slots stay findable
  across frames; LLVM often still encodes them as Register — gcry deref
  when the reg value lies on the stack.
- Object/executable contain `.llvm_stackmaps`.
- Default PIE link failed; auto **`-no-pie`** when the env gate is set.

## Usage

```sh
make crystal
CRYSTAL_EMIT_STACKMAP=1 bin/crystal build --no-debug hello.cr -o hello
./hello
readelf -S hello | grep llvm_stackmaps
CRYSTAL_EMIT_STACKMAP=1 bin/crystal build --emit=llvm-ir --no-debug hello.cr -o hello
# grep stackmap hello.ll
```

### With gcry (`-Dgc_none`)

Tip Crystal **requires** `-Dpreview_mt -Dexecution_context` for process-GC
workloads (without them the legacy `Crystal::Scheduler` path livelocks
`bench/soak`). Also:

- Skip empty live sets; skip C `External` calls
- Cap maps per LLVM function (`CRYSTAL_STACKMAP_PER_FUN`, default **2**;
  acik exclusive harness uses **256**)
- Mark stackmap calls **nounwind** (else EH prep → invoke → LLVM 18
  `LowerStatepoint` crash on fat `--release` apps)
- Emit after `invoke` in the `invoke_out` block (nounwind call, not as the
  invoke itself). Still skip C `External` calls.
- Lives must belong to the current LLVM function (foreign `%self` skipped)

```sh
CRYSTAL_EMIT_STACKMAP=1 bin/crystal build -Dgc_none \
  -Dpreview_mt -Dexecution_context app.cr -o app
GCRY_PRECISE_STACK=1 ./app
```
