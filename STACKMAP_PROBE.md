# gcry stackmap probe (`gcry-stackmap-probe`)

Experimental: when `CRYSTAL_EMIT_STACKMAP=1`, emit empty
`llvm.experimental.stackmap` after each Crystal call site
(`codegen/call.cr`) and link with `-no-pie` so `.llvm_stackmaps`
absolute relocs succeed.

See sibling project: `gcry/docs/STACK_MAPS.md`.

## Results (2026-08-03)

- IR contains `@llvm.experimental.stackmap` calls.
- Object files contain a `.llvm_stackmaps` section (`R_X86_64_64` to `.text`).
- Default PIE link failed; **`-no-pie`** (auto when `CRYSTAL_EMIT_STACKMAP=1`)
  produces a runnable binary with a live `.llvm_stackmaps` section.

## Usage

```sh
make crystal
CRYSTAL_EMIT_STACKMAP=1 bin/crystal build --no-debug hello.cr -o hello
./hello
readelf -S hello | grep llvm_stackmaps
# or: --emit=llvm-ir and inspect hello.ll
```
