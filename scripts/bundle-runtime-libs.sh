#!/usr/bin/env bash
# Copy beside the packaged binaries every shared library they need at
# runtime that a fresh machine has no reason to own — then refuse the
# package if anything is still missing.
#
# The list is not curated, and that is the point. Every release before
# this script existed shipped a `bin/iyi` that could not start without
# the exact libLLVM it linked against, and no gate saw it because every
# proof of the tarball ran where that library is present by
# construction. Two rounds of "surely that is the last one" followed
# (libLLVM, then libedit), which is what curation buys you. So: take
# what the loader reports, minus the handful every glibc/macOS install
# has by definition, and then *assert* the result names nothing else.
#
# The refusal is Crystal's practice, taken outright: their packaging
# fails when `otool -L` on the finished compiler names anything under
# `/usr/local/lib` or `/opt/homebrew` (distribution-scripts,
# omnibus/config/software/crystal.rb). It is the only proof darwin can
# have from its own job, which runs on a machine that *has* those
# libraries — "it ran" says nothing there, "it names nothing outside
# itself" says everything.
#
# Usage: bundle-runtime-libs.sh <package-root> [--verify-only]
#
# `--verify-only` asks the question of a package somebody else built —
# an unpacked release artifact, above all.
set -euo pipefail

root=${1:?usage: bundle-runtime-libs.sh <package-root> [--verify-only]}
mode=${2:-bundle}
# Absolute, because the check below asks whether a resolved library sits
# *inside* the package and the loader answers in absolute paths — a
# relative root turns every bundled library into a false offender, which
# is exactly how this line was earned.
mkdir -p "$root"
root=$(cd "$root" && pwd)
lib="$root/lib"

is_base() {
  case "$1" in
  libc.so.* | libm.so.* | libdl.so.* | libpthread.so.* | librt.so.* | \
    libgcc_s.so.* | libresolv.so.* | ld-linux*) return 0 ;;
  esac
  return 1
}

# macOS ships its own libraries under /usr/lib and /System; anything else
# came from a package manager the downloader may not have.
outside_macos_base() {
  case "$1" in
  /usr/lib/* | /System/*) return 1 ;;
  esac
  return 0
}

bundle_linux() {
  # `ldd` on the *packaged* binary reports the whole closure, so one pass
  # per binary is enough: libLLVM's own libedit shows up here too.
  for bin in "$root/bin/"*; do
    [ -f "$bin" ] || continue
    ldd "$bin" 2>/dev/null | awk '/=> \// {print $3}' | while read -r so; do
      base=$(basename "$so")
      is_base "$base" && continue
      [ -e "$lib/$base" ] || cp -L "$so" "$lib/$base"
    done
  done
}

rewrite_macho() { # rewrite_macho <file>
  otool -L "$1" | tail -n +2 | awk '{print $1}' | while read -r ref; do
    case "$ref" in @*) continue ;; esac
    outside_macos_base "$ref" || continue
    base=$(basename "$ref")
    [ -e "$lib/$base" ] || cp -L "$ref" "$lib/$base"
    chmod u+w "$lib/$base"
    install_name_tool -change "$ref" "@rpath/$base" "$1"
  done
  codesign --force --sign - "$1" >/dev/null 2>&1 || true
}

bundle_darwin() {
  for bin in "$root/bin/"*; do
    [ -f "$bin" ] || continue
    rewrite_macho "$bin"
  done

  # Fixed point: a dylib copied above may itself name one that is not
  # here yet. Each gets `@loader_path` of its own, because a dylib
  # resolves its own `@rpath` references against its own rpaths — the
  # Mach-O shape of the lesson `--disable-new-dtags` teaches on Linux.
  while :; do
    before=$(ls "$lib" | wc -l)
    for dylib in "$lib"/*; do
      [ -f "$dylib" ] || continue
      install_name_tool -id "@rpath/$(basename "$dylib")" "$dylib" 2>/dev/null || true
      install_name_tool -add_rpath "@loader_path" "$dylib" 2>/dev/null || true
      rewrite_macho "$dylib"
    done
    [ "$(ls "$lib" | wc -l)" = "$before" ] && break
  done
}

verify() {
  offenders=""

  case "$(uname -s)" in
  Linux)
    # The executables only, and deliberately: the guarantee on Linux is
    # the inherited `DT_RPATH`, so what the loader will actually do is
    # what `ldd` on the *executable* reports. A bundled library asked in
    # isolation has no rpath and would answer from the host, which would
    # be a lie in both directions.
    for bin in "$root/bin/"*; do
      [ -f "$bin" ] || continue
      while read -r name path; do
        case "$name" in linux-vdso*) continue ;; esac
        is_base "$(basename "$name")" && continue
        case "$path" in "$root"/*) continue ;; esac
        offenders="$offenders
  $(basename "$bin") wants $name from $path"
      done <<EOF
$(ldd "$bin" 2>/dev/null | awk '/=> \// {print $1, $3}')
EOF
    done
    ;;
  Darwin)
    for file in "$root/bin/"* "$lib"/*; do
      [ -f "$file" ] || continue
      while read -r ref; do
        case "$ref" in @* | /usr/lib/* | /System/*) continue ;; esac
        offenders="$offenders
  $(basename "$file") names $ref"
      done <<EOF
$(otool -L "$file" | tail -n +2 | awk '{print $1}')
EOF
    done
    ;;
  esac

  if [ -n "$offenders" ]; then
    echo "bundle-runtime-libs: the package would need the host's libraries:$offenders"
    echo
    echo "A tarball that names a library it does not carry cannot start on a"
    echo "machine unlike this one — the failure every release before this"
    echo "script shipped, invisibly."
    exit 1
  fi
  echo "closed: the package names nothing outside itself but the loader and libc"
}

if [ "$mode" != "--verify-only" ]; then
  mkdir -p "$lib"
  case "$(uname -s)" in
  Linux) bundle_linux ;;
  Darwin) bundle_darwin ;;
  esac

  # The guard runs in whichever direction the binary chose. A compiler
  # linked against shared LLVM must ship it — a package without it needs
  # the host's, which is the bug this script exists for. A compiler
  # linked against the static LLVM (the tarball diet: built per Crystal's
  # own recipe by `build-static-llvm.sh`) must ship *no*
  # libLLVM, because one in `lib/` would mean the link quietly went
  # shared after all. Which direction applies is read off the binary,
  # not assumed.
  if ldd "$root/bin/iyi" 2>/dev/null | grep -q 'libLLVM' ||
     otool -L "$root/bin/iyi" 2>/dev/null | grep -q 'libLLVM'; then
    ls "$lib" | grep -q 'libLLVM' || {
      echo "bundle-runtime-libs: no libLLVM landed in $lib — the package would"
      echo "need the host's, which is the bug this script exists for."
      exit 1
    }
  else
    if ls "$lib" | grep -q 'libLLVM'; then
      echo "bundle-runtime-libs: the binary does not need libLLVM but one was"
      echo "bundled, so the link quietly went shared after all."
      exit 1
    fi
    echo "static LLVM: no libLLVM to carry, and none carried"
  fi

  echo "bundled beside the binaries:"
  ls -1 "$lib" | sed 's/^/  /'
fi

verify
