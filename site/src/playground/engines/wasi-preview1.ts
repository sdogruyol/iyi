/**
 * A WASI preview1 host, in the page.
 *
 * There is no `node:wasi` in a browser, so the syscalls a wasm32-wasi command
 * module imports have to be implemented here. This file is that host and
 * nothing else: it knows about file descriptors and errnos, it does not know
 * what iyi is, and it never decides what the page displays. The engine in
 * `wasi.ts` owns that.
 *
 * WHAT THIS HOST GRANTS, and why each grant is the honest one:
 *
 *   stdout, stderr   Captured. Every `fd_write` is kept as its own chunk with
 *                    the fd it went to, in call order, so the page can report
 *                    the writes the program actually made rather than one
 *                    flattened string. A program that writes to both has said
 *                    something about which is which and this host keeps it.
 *
 *   stdin            Open, and immediately at end of file. This is not a
 *                    refusal, it is the same thing a program sees when it is
 *                    run with input redirected from nothing, and it is the
 *                    only correct answer available: synchronous stdin from a
 *                    page needs `Atomics.wait` on a `SharedArrayBuffer`, and
 *                    GitHub Pages cannot send the two headers that would make
 *                    this document cross-origin isolated. See the HARD
 *                    CONSTRAINT block in `../types.ts`.
 *
 *   arguments        Exactly one, the program's own path, supplied by the
 *                    caller. A command module reads `argv[0]` and wasi-libc
 *                    will fault on an empty argv, so this is a requirement
 *                    rather than a courtesy.
 *
 *   environment      Empty, and reported as empty rather than errored. A page
 *                    has no environment, and inventing one would be inventing
 *                    an input.
 *
 *   clocks           Real. `realtime` is the wall clock and `monotonic` is
 *                    `performance.now`, both converted to the nanoseconds the
 *                    interface asks for. Both are coarsened by the browser
 *                    for the same isolation reason, which is a property of the
 *                    reading and is stated wherever a reading is shown.
 *
 *   randomness       Real, from `crypto.getRandomValues`. A deterministic
 *                    stand-in would make a program that samples randomness
 *                    quietly wrong.
 *
 *   filesystem       Nothing. There are no preopened directories, so
 *                    `fd_prestat_get` reports `EBADF` on the first probe,
 *                    which is precisely how wasi-libc discovers that it has
 *                    no capabilities, and every path call then fails the same
 *                    way it would under a real host with no grants. This is
 *                    the shape iyi's own prelude already anticipates.
 *
 * WHAT IT NEVER DOES: throw at a wasm boundary for a call it does not
 * implement. A host that throws turns an unimplemented syscall into an
 * unrecoverable trap, and the program loses the chance to handle a failure it
 * was written to handle. So every function in the interface is present and
 * every one returns an errno. Unimplemented means `ENOSYS`, not a crash.
 */

/**
 * The preview1 errno numbering, as the interface defines it. Only the members
 * this host actually returns are named, because a constant nobody uses is a
 * claim nobody checks.
 */
const ERRNO = {
  success: 0,
  badf: 8,
  inval: 28,
  nosys: 52,
  notdir: 54,
  notsup: 58,
  spipe: 70,
  notcapable: 76,
} as const;

/** `filetype` for a terminal-ish stream: preview1 `character_device`. */
const FILETYPE_CHARACTER_DEVICE = 2;

/** Every right, granted on the three standard streams this host does own. */
const ALL_RIGHTS = 0xffff_ffff_ffff_ffffn;

/** preview1 `clockid`. */
const CLOCK_REALTIME = 0;
const CLOCK_MONOTONIC = 1;

/** preview1 `whence`, for the `fd_seek` that this host always refuses. */
const NANOS_PER_MILLI = 1_000_000;

/**
 * One `fd_write` call, kept whole.
 *
 * `fd` is the descriptor it was written to, so stdout and stderr stay
 * distinguishable, and `bytes` is exactly what the program handed over, before
 * any decoding. Keeping the bytes rather than a string means a multi byte
 * character split across two writes is not corrupted by decoding each half on
 * its own.
 */
export interface WriteChunk {
  fd: number;
  bytes: Uint8Array;
}

/**
 * Thrown by `proc_exit` and by nothing else.
 *
 * `proc_exit` does not return, and the only way to express that through a wasm
 * call is to unwind the host. So this is a control signal rather than an
 * error: the engine catches exactly this type, reads the real status off it,
 * and anything else that comes out of `_start` is a genuine fault and is
 * reported as one.
 */
export class WasiExit extends Error {
  /* Written as a field and an assignment rather than a constructor parameter
   * property, because node's type stripping refuses a parameter property, and
   * this module is then loadable by a plain node harness with no bundler,
   * which is how the execution path can be driven outside a browser. A
   * testable module is worth three lines. */
  readonly code: number;

  constructor(code: number) {
    super(`wasi: proc_exit(${code})`);
    this.code = code;
    this.name = "WasiExit";
  }
}

export interface WasiHostOptions {
  /**
   * `argv`, and it must not be empty. wasi-libc's start stub reads `argv[0]`,
   * so a host that supplied none would fault inside the program rather than
   * report a problem with the host.
   */
  args: string[];
}

/**
 * The host.
 *
 * Constructed before instantiation, because the import object has to exist
 * first, then bound to the instance's memory with `bind`. That ordering is
 * forced by the wasm API and it is the reason `memory` is late.
 */
export class WasiHost {
  /** Every write the program made, in the order it made them. */
  readonly writes: WriteChunk[] = [];

  /** Descriptors this host owns. Closing one removes it, so a later write to
   * it gets `EBADF` exactly as it would from a real host. */
  private readonly open = new Set<number>([0, 1, 2]);

  private memory: WebAssembly.Memory | null = null;
  private readonly args: Uint8Array[];
  private readonly monotonicOrigin: bigint;

  constructor(options: WasiHostOptions) {
    if (options.args.length === 0) {
      throw new Error(
        "WasiHost: args must carry at least the program's own path. " +
          "wasi-libc's start stub reads argv[0], so an empty argv faults " +
          "inside the program instead of reporting a host problem.",
      );
    }
    const encoder = new TextEncoder();
    this.args = options.args.map((arg) => encoder.encode(`${arg}\0`));
    /* Fixed at construction so that a monotonic reading is measured from the
     * start of this run rather than from the page's navigation, which is what
     * a program comparing two readings expects. */
    this.monotonicOrigin = BigInt(Math.round(performance.now() * NANOS_PER_MILLI));
  }

  /** Hand the host the instance's memory. Called once, after instantiation. */
  bind(instance: WebAssembly.Instance): void {
    const memory = instance.exports.memory;
    if (!(memory instanceof WebAssembly.Memory)) {
      throw new Error(
        "WasiHost: the module exports no linear memory, so it is not a " +
          "wasm32-wasi command module and nothing can be read out of it.",
      );
    }
    this.memory = memory;
  }

  /** The import object, ready to hand to `WebAssembly.instantiate`. */
  imports(): WebAssembly.Imports {
    return { wasi_snapshot_preview1: this.namespace() };
  }

  /* ---------------------------------------------------------------------- */

  private view(): DataView {
    if (this.memory === null) {
      throw new Error(
        "WasiHost: a syscall arrived before bind(), which means the instance " +
          "called into the host during instantiation. That cannot happen for " +
          "a command module and is a bug in this host if it does.",
      );
    }
    return new DataView(this.memory.buffer);
  }

  private bytes(): Uint8Array {
    if (this.memory === null) {
      throw new Error("WasiHost: memory read before bind()");
    }
    return new Uint8Array(this.memory.buffer);
  }

  /**
   * Read an `iovec` array and return the bytes it points at, copied.
   *
   * The copy is deliberate. A view into `memory.buffer` is invalidated the
   * moment the program grows its memory, and a captured view that later
   * decodes to something else would be the worst possible bug here: output the
   * page reports that the program did not write.
   */
  private gather(iovs: number, iovsLen: number): Uint8Array {
    const view = this.view();
    const memory = this.bytes();
    let total = 0;
    for (let i = 0; i < iovsLen; i += 1) {
      total += view.getUint32(iovs + i * 8 + 4, true);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (let i = 0; i < iovsLen; i += 1) {
      const ptr = view.getUint32(iovs + i * 8, true);
      const len = view.getUint32(iovs + i * 8 + 4, true);
      out.set(memory.subarray(ptr, ptr + len), at);
      at += len;
    }
    return out;
  }

  /* The interface, one member per preview1 function. Grouped by what they do
   * rather than alphabetically, because the grants are the story. */
  private namespace(): WebAssembly.ModuleImports {
    const granted: WebAssembly.ModuleImports = {
      /* Arguments ------------------------------------------------------- */

      args_sizes_get: (countOut: number, bufSizeOut: number): number => {
        const view = this.view();
        view.setUint32(countOut, this.args.length, true);
        view.setUint32(
          bufSizeOut,
          this.args.reduce((sum, arg) => sum + arg.length, 0),
          true,
        );
        return ERRNO.success;
      },

      args_get: (argvOut: number, argvBufOut: number): number => {
        const view = this.view();
        const memory = this.bytes();
        let at = argvBufOut;
        for (let i = 0; i < this.args.length; i += 1) {
          view.setUint32(argvOut + i * 4, at, true);
          memory.set(this.args[i], at);
          at += this.args[i].length;
        }
        return ERRNO.success;
      },

      /* Environment ----------------------------------------------------- */

      /* Empty, and reported as empty. A page has no environment, and a
       * fabricated one would be a fabricated input. */
      environ_sizes_get: (countOut: number, bufSizeOut: number): number => {
        const view = this.view();
        view.setUint32(countOut, 0, true);
        view.setUint32(bufSizeOut, 0, true);
        return ERRNO.success;
      },

      environ_get: (): number => ERRNO.success,

      /* Standard streams ------------------------------------------------ */

      fd_write: (
        fd: number,
        iovs: number,
        iovsLen: number,
        nwrittenOut: number,
      ): number => {
        if (!this.open.has(fd)) return ERRNO.badf;
        /* Writing to stdin is a real error and is reported as one rather
         * than swallowed, because a program that does it has a bug and
         * hiding it here would hide the bug. */
        if (fd === 0) return ERRNO.notcapable;
        const bytes = this.gather(iovs, iovsLen);
        this.writes.push({ fd, bytes });
        this.view().setUint32(nwrittenOut, bytes.length, true);
        return ERRNO.success;
      },

      /**
       * Zero bytes, success: end of file.
       *
       * Not an errno, because "there is nothing to read" is not a failure and
       * a program looping until EOF must be able to terminate. Blocking for
       * real input is what is impossible here, not reading.
       */
      fd_read: (
        fd: number,
        _iovs: number,
        _iovsLen: number,
        nreadOut: number,
      ): number => {
        if (!this.open.has(fd)) return ERRNO.badf;
        if (fd !== 0) return ERRNO.notcapable;
        this.view().setUint32(nreadOut, 0, true);
        return ERRNO.success;
      },

      fd_close: (fd: number): number => {
        if (!this.open.has(fd)) return ERRNO.badf;
        this.open.delete(fd);
        return ERRNO.success;
      },

      /** A character device is not seekable, and `ESPIPE` is what a real host
       * says about one. */
      fd_seek: (
        fd: number,
        _offset: bigint,
        _whence: number,
        _newOffsetOut: number,
      ): number => (this.open.has(fd) ? ERRNO.spipe : ERRNO.badf),

      fd_tell: (fd: number, _out: number): number =>
        this.open.has(fd) ? ERRNO.spipe : ERRNO.badf,

      /**
       * The three standard streams are character devices with every right.
       *
       * This is what wasi-libc reads to decide whether a stream is a terminal
       * and how to buffer it, so getting the filetype wrong here changes when
       * a program's output appears rather than whether it appears.
       */
      fd_fdstat_get: (fd: number, out: number): number => {
        if (!this.open.has(fd)) return ERRNO.badf;
        const view = this.view();
        view.setUint8(out, FILETYPE_CHARACTER_DEVICE);
        view.setUint8(out + 1, 0);
        view.setUint16(out + 2, 0, true);
        view.setUint32(out + 4, 0, true);
        view.setBigUint64(out + 8, ALL_RIGHTS, true);
        view.setBigUint64(out + 16, ALL_RIGHTS, true);
        return ERRNO.success;
      },

      fd_fdstat_set_flags: (fd: number, _flags: number): number =>
        this.open.has(fd) ? ERRNO.success : ERRNO.badf,

      fd_fdstat_set_rights: (
        fd: number,
        _base: bigint,
        _inheriting: bigint,
      ): number => (this.open.has(fd) ? ERRNO.notcapable : ERRNO.badf),

      /* Clocks ---------------------------------------------------------- */

      clock_time_get: (
        id: number,
        _precision: bigint,
        out: number,
      ): number => {
        let nanos: bigint;
        if (id === CLOCK_REALTIME) {
          nanos = BigInt(Date.now()) * BigInt(NANOS_PER_MILLI);
        } else if (id === CLOCK_MONOTONIC) {
          nanos =
            BigInt(Math.round(performance.now() * NANOS_PER_MILLI)) -
            this.monotonicOrigin;
        } else {
          /* Process and thread CPU clocks: a page cannot read either, and
           * saying so is better than handing back the wall clock under a
           * different name. */
          return ERRNO.notsup;
        }
        this.view().setBigUint64(out, nanos, true);
        return ERRNO.success;
      },

      clock_res_get: (id: number, out: number): number => {
        if (id !== CLOCK_REALTIME && id !== CLOCK_MONOTONIC) {
          return ERRNO.notsup;
        }
        /* One millisecond, which is the honest resolution: the browser
         * coarsens both clocks because this document is not cross-origin
         * isolated, so claiming nanoseconds would be claiming a precision the
         * platform withholds. */
        this.view().setBigUint64(out, BigInt(NANOS_PER_MILLI), true);
        return ERRNO.success;
      },

      /* Randomness ------------------------------------------------------ */

      random_get: (buf: number, len: number): number => {
        /* Filled in 64 KiB slices because that is the ceiling
         * `crypto.getRandomValues` accepts per call. */
        const memory = this.bytes();
        const limit = 65536;
        for (let at = 0; at < len; at += limit) {
          crypto.getRandomValues(
            memory.subarray(buf + at, buf + Math.min(at + limit, len)),
          );
        }
        return ERRNO.success;
      },

      /* Scheduling ------------------------------------------------------ */

      /** Nothing else is runnable in this host, so yielding succeeds and does
       * nothing, which is exactly what it means here. */
      sched_yield: (): number => ERRNO.success,

      /**
       * A poll that would sleep cannot be honoured: suspending a wasm call
       * needs `Atomics.wait`, and this document is not cross-origin isolated.
       * `ENOTSUP` says so rather than returning immediately and letting a
       * program believe its timer elapsed.
       */
      poll_oneoff: (
        _in: number,
        _out: number,
        _n: number,
        _neventsOut: number,
      ): number => ERRNO.notsup,

      /* Process --------------------------------------------------------- */

      proc_exit: (code: number): never => {
        throw new WasiExit(code);
      },

      /** A page cannot raise a signal at itself. */
      proc_raise: (_signal: number): number => ERRNO.notsup,

      /* Filesystem ------------------------------------------------------ */

      /**
       * No preopened directories.
       *
       * `EBADF` on the very first probe is how wasi-libc learns it has no
       * capabilities, and it is what a real host with no grants returns. Every
       * path call below then fails for the same structural reason rather than
       * because this host is a stub: there is no directory descriptor to
       * resolve a path against. iyi's own prelude anticipates exactly this and
       * panics with a sentence naming it.
       */
      fd_prestat_get: (_fd: number, _out: number): number => ERRNO.badf,
      fd_prestat_dir_name: (
        _fd: number,
        _path: number,
        _len: number,
      ): number => ERRNO.badf,
    };

    /**
     * The rest of the interface, present and truthful.
     *
     * Two errnos, chosen by which statement is true of the call:
     *
     *   EBADF        the call needs a descriptor, and every descriptor this
     *                host has is a character device with no directory above
     *                it, so there is nothing valid to pass. This is the same
     *                answer a real host gives when nothing was granted.
     *   ENOSYS       the call is not implemented here at all: sockets, which a
     *                page has no business opening on a program's behalf.
     *
     * Listing them explicitly rather than trapping is the point of this
     * block. A module that imports one of these instantiates and gets a
     * failure it can handle, instead of dying at link time with a message
     * about a missing import, which tells a visitor nothing.
     */
    const refused: Record<string, number> = {
      fd_advise: ERRNO.badf,
      fd_allocate: ERRNO.badf,
      fd_datasync: ERRNO.badf,
      fd_filestat_get: ERRNO.badf,
      fd_filestat_set_size: ERRNO.badf,
      fd_filestat_set_times: ERRNO.badf,
      fd_pread: ERRNO.badf,
      fd_pwrite: ERRNO.badf,
      fd_readdir: ERRNO.notdir,
      fd_renumber: ERRNO.badf,
      fd_sync: ERRNO.badf,
      path_create_directory: ERRNO.badf,
      path_filestat_get: ERRNO.badf,
      path_filestat_set_times: ERRNO.badf,
      path_link: ERRNO.badf,
      path_open: ERRNO.badf,
      path_readlink: ERRNO.badf,
      path_remove_directory: ERRNO.badf,
      path_rename: ERRNO.badf,
      path_symlink: ERRNO.badf,
      path_unlink_file: ERRNO.badf,
      sock_accept: ERRNO.nosys,
      sock_recv: ERRNO.nosys,
      sock_send: ERRNO.nosys,
      sock_shutdown: ERRNO.nosys,
    };

    const namespace: WebAssembly.ModuleImports = { ...granted };
    for (const [name, errno] of Object.entries(refused)) {
      namespace[name] = () => errno;
    }

    /**
     * The catch-all.
     *
     * A module may import a preview1 function this host has not heard of, from
     * a newer libc or a snapshot revision. Without this, instantiation fails
     * with a `LinkError` and the page can only say that something is missing.
     * With it, the program starts, makes the call, and gets `ENOSYS`, which is
     * the interface's own word for "this host does not implement that" and is
     * a failure the program was written to be able to see.
     */
    return new Proxy(namespace, {
      get(target, name: string) {
        if (name in target) return target[name];
        return () => ERRNO.nosys;
      },
      has() {
        return true;
      },
    });
  }
}

/**
 * Decode a run's writes into text, one fd at a time, in call order.
 *
 * Streaming decode per fd, because a character encoded across two `fd_write`
 * calls must not be decoded as two broken halves. Chunk boundaries are kept:
 * the result is one entry per write, so the page reports the writes the
 * program made rather than one concatenated blob.
 */
export function decodeWrites(
  writes: readonly WriteChunk[],
): { fd: number; text: string }[] {
  const decoders = new Map<number, TextDecoder>();
  const out: { fd: number; text: string }[] = [];
  for (const write of writes) {
    let decoder = decoders.get(write.fd);
    if (decoder === undefined) {
      decoder = new TextDecoder("utf-8");
      decoders.set(write.fd, decoder);
    }
    out.push({ fd: write.fd, text: decoder.decode(write.bytes, { stream: true }) });
  }
  /* Flush each decoder so a truncated trailing sequence surfaces as the
   * replacement character rather than disappearing. */
  for (const [fd, decoder] of decoders) {
    const tail = decoder.decode();
    if (tail.length > 0) out.push({ fd, text: tail });
  }
  return out;
}
