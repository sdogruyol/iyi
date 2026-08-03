# gcry stackmap probe (`gcry-stackmap-probe`)

Experimental: when `CRYSTAL_EMIT_STACKMAP=1`, emit empty
`llvm.experimental.stackmap` after each Crystal call site
(`codegen/call.cr`).

See sibling project: `gcry/docs/STACK_MAPS.md`.

## Results (2026-08-03)

- IR contains `@llvm.experimental.stackmap` calls.
- Object files contain a `.llvm_stackmaps` section.
- Final link currently fails: `.llvm_stackmaps` uses `R_X86_64_64`
  against non-PIC symbols — need PIC (or reloc fix) next.

## Usage

```sh
make crystal
CRYSTAL_EMIT_STACKMAP=1 bin/crystal build --emit=llvm-ir hello.cr -o hello
# inspect hello.ll for stackmap; or readelf -S on .o under ~/.cache/crystal
```
