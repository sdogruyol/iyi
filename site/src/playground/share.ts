/**
 * Sharing a playground program by URL fragment.
 *
 * A fragment is the one part of a URL a browser does not send to a server. So a
 * shared program travels in the link itself, between the people holding the
 * link, and this site never receives it. That is not a convenience, it is the
 * whole design: the alternative is an id, and an id means a store, and a store
 * means a shortener, a database, a retention answer and a moderation queue, all
 * of it for a page whose argument is that you can read exactly what it did.
 * None of that comes into existence here, and the reason it does not is that
 * nothing is ever uploaded.
 *
 * The cost is that a URL is a small place, and it is small in a way nobody
 * documents: browsers, proxies, chat clients and mail readers all stop being
 * reliable somewhere past a few thousand characters, and they stop by
 * truncating rather than by complaining. So this module measures the encoded
 * payload and reports how far over the ceiling it is, and it never throws for a
 * program that is too big. Refusing is the caller's job, because the refusal is
 * a sentence on a page and the wording belongs with the page, not here.
 *
 * WHAT MAKES THIS TRICKY, and why the code below looks the way it does:
 *
 *   1. The payload is self describing. It carries one leading byte saying which
 *      codec produced it, so the decoder never has to guess. A decoder that
 *      guesses is a decoder that hands back plausible rubbish, and a fragment
 *      written by a future version of this file must fail visibly instead of
 *      arriving as mojibake.
 *   2. Compression is opportunistic and honest about it. `CompressionStream`
 *      is not everywhere, and even where it is, deflate makes very short input
 *      longer. So both candidates are built, the smaller one wins, and the
 *      codec byte records which one it was. Choosing per program is the entire
 *      reason the byte exists.
 *   3. base64url is done over bytes, never over a string. `btoa` takes a
 *      string of code units below 256 and throws or mangles anything else, and
 *      this language is Turkish: `ı İ ş ğ ç ö ü` appear in real identifiers and
 *      real strings. Encoding the text instead of its UTF-8 bytes would corrupt
 *      the name of the language on the site that documents it.
 *   4. Decoding is strict, deliberately. Padding is restored and then a whole
 *      number of four character groups is required. `atob` implements the
 *      forgiving base64 rules, which accept a payload whose tail was cut off
 *      and return the bytes that survived: exactly the half a program a visitor
 *      must never be shown. Every malformed shape returns null and the page
 *      opens its own starter program instead.
 *
 * NODE SAFETY: a browser island is the only thing that imports this, but the
 * Astro build walks the module graph in node, so importing this file must touch
 * no global. Everything below the constants is either pure computation or lives
 * inside the two async functions. `CompressionStream` and `DecompressionStream`
 * are read off `globalThis` and type checked at the point of use, so a runtime
 * without them degrades to uncompressed payloads rather than throwing at load.
 * `TextEncoder` and `TextDecoder` are taken as given because they exist in
 * every runtime that can load this module at all, and they are still only
 * touched inside the functions.
 */

/**
 * The ceiling on the encoded payload, in characters.
 *
 * Deliberately a fixed number rather than a probe: there is no way to ask a
 * browser, a proxy or a chat client where its own limit is, and a limit
 * discovered by truncation is discovered too late. Every message about the
 * ceiling is derived from this constant by the caller, so the number lives in
 * exactly one place and no page ever repeats it by hand.
 */
export const SHARE_LIMIT = 8 * 1024;

/**
 * The entry file the playground opens with.
 *
 * The fragment omits the entry when it is this one, which keeps the common link
 * short and keeps a hand edited URL readable. It is exported so the caller and
 * this module cannot disagree about which name is the silent default.
 */
export const DEFAULT_ENTRY = "main.iyi";

/** A program recovered from a fragment: the source, and which file it is. */
export interface Shared {
  source: string;
  entry: string;
}

/** A program encoded for a fragment, with the measurement the caller needs. */
export interface Encoded {
  /**
   * The fragment, with no leading '#', ready to assign to `location.hash`.
   * The browser writes the '#' itself, and carrying one here would produce
   * `##src=` the first time somebody concatenated instead of assigning.
   */
  fragment: string;
  /**
   * The length of the encoded payload in characters: the base64url text after
   * `src=`, which is the part that grows with the program. The `src=` prefix
   * and the optional entry are bounded overhead, and the caller has the whole
   * fragment here if it wants to measure that too.
   */
  length: number;
  /** `length - SHARE_LIMIT` when the payload is over the ceiling, else 0. */
  over: number;
}

/* ---------------------------------------------------------------------------
 * The codec byte.
 *
 * One byte, prepended to the bytes before base64url. It is a version and a
 * codec at once, which is enough for a format this small: a later version that
 * needs a different codec takes the next value, and every reader written before
 * it refuses that value rather than inventing a program out of bytes it cannot
 * read. Unknown means null. That is the contract.
 * ------------------------------------------------------------------------- */

/** Uncompressed UTF-8. What a runtime with no compression streams produces. */
const CODEC_RAW = 0x00;

/** Deflate with no zlib or gzip wrapper, through `CompressionStream`. */
const CODEC_DEFLATE_RAW = 0x01;

/** The format name both stream codecs take. Named so the pair cannot drift. */
const DEFLATE_RAW = "deflate-raw";

/* ---------------------------------------------------------------------------
 * base64url.
 *
 * Standard base64 with '+' written '-' and '/' written '_', and the '=' padding
 * stripped, which is what makes the payload safe in a URL without further
 * escaping. Written out here rather than bridged through `btoa` and `atob`
 * because both of those talk in strings, the bridge for large inputs is a
 * `String.fromCharCode` apply that overflows the argument list, and `atob` is
 * forgiving in the one place this format must be strict.
 * ------------------------------------------------------------------------- */

const B64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Reverse lookup, built once from the alphabet above so the two cannot drift.
 * -1 means "not a base64url character", which is how the decoder rejects a
 * hand edited fragment without a second table of legal characters to maintain.
 */
const B64URL_VALUE = ((): Int8Array => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64URL.length; i += 1) {
    table[B64URL.charCodeAt(i)] = i;
  }
  return table;
})();

/** Bytes to base64url text, unpadded. */
function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  let at = 0;

  // Whole groups first: three bytes become four characters.
  for (; at + 2 < bytes.length; at += 3) {
    const word = (bytes[at] << 16) | (bytes[at + 1] << 8) | bytes[at + 2];
    out +=
      B64URL[(word >>> 18) & 63] +
      B64URL[(word >>> 12) & 63] +
      B64URL[(word >>> 6) & 63] +
      B64URL[word & 63];
  }

  // The tail, whose padding is the thing this encoding strips. One leftover
  // byte becomes two characters and two leftover bytes become three, and the
  // decoder recovers which of the three shapes it has from the length rather
  // than from a marker, which is why stripping the padding is safe.
  const left = bytes.length - at;
  if (left === 1) {
    const word = bytes[at] << 16;
    out += B64URL[(word >>> 18) & 63] + B64URL[(word >>> 12) & 63];
  } else if (left === 2) {
    const word = (bytes[at] << 16) | (bytes[at + 1] << 8);
    out +=
      B64URL[(word >>> 18) & 63] +
      B64URL[(word >>> 12) & 63] +
      B64URL[(word >>> 6) & 63];
  }

  return out;
}

/**
 * base64url text to bytes, or null when the text is not a base64url payload.
 *
 * Strict on purpose. A fragment is a thing people paste, and a paste that lost
 * its tail is the common corruption, so the length is required to describe a
 * whole number of groups once the stripped padding is put back. A remainder of
 * one character is a shape no encoder can produce, and any character outside
 * the alphabet, including a '=' anywhere but the very end, is corruption.
 */
function fromBase64Url(text: string): Uint8Array | null {
  const remainder = text.length % 4;

  // No base64 encoding of any byte string leaves a single character over, so
  // this is corruption rather than a payload that merely lost its padding.
  if (remainder === 1) return null;

  // Restore what the encoder stripped. Everything below counts on groups of
  // four, and this is the line that makes that true.
  const padded = remainder === 0 ? text : text + "=".repeat(4 - remainder);
  if (padded.length % 4 !== 0) return null;

  let pad = 0;
  if (padded.endsWith("==")) pad = 2;
  else if (padded.endsWith("=")) pad = 1;

  const body = padded.slice(0, padded.length - pad);
  const out = new Uint8Array((padded.length / 4) * 3 - pad);
  let at = 0;
  let acc = 0;
  let bits = 0;

  for (let i = 0; i < body.length; i += 1) {
    const code = body.charCodeAt(i);
    const value = code < 128 ? B64URL_VALUE[code] : -1;
    if (value < 0) return null;
    acc = ((acc << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (acc >>> bits) & 0xff;
      at += 1;
    }
  }

  // The byte count was computed from the length before any byte was written,
  // so a mismatch means the two disagree and the payload is not what it says.
  if (at !== out.length) return null;
  return out;
}

/* ---------------------------------------------------------------------------
 * The compression streams, described structurally.
 *
 * These types are written out instead of imported from a DOM or node library
 * because this module must type check the same whether or not the surrounding
 * project has either library configured, and because the constructor is read
 * off `globalThis` anyway: it is genuinely optional, so the code that uses it
 * has to be written for a runtime where the name means nothing.
 * ------------------------------------------------------------------------- */

interface ByteReader {
  read(): Promise<{ done: boolean; value: Uint8Array | undefined }>;
}

interface ByteWriter {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

interface ByteTransform {
  readable: { getReader(): ByteReader };
  writable: { getWriter(): ByteWriter };
}

interface ByteTransformCtor {
  new (format: string): ByteTransform;
}

/**
 * Run one of the platform's byte transforms over a buffer, or return null.
 *
 * Null covers both "this runtime has no such constructor" and "it rejected
 * these bytes", and both are answered the same way by both callers: the
 * encoder falls back to an uncompressed payload, and the decoder gives up and
 * lets the page open its own program. Neither has anything useful to say about
 * which of the two happened, so neither is told.
 */
async function runByteTransform(
  which: "CompressionStream" | "DecompressionStream",
  bytes: Uint8Array,
): Promise<Uint8Array | null> {
  // An unchecked cast with a reason: `globalThis` carries no type for either
  // name unless a DOM library is configured, and asking whether the runtime
  // has one at all means reading it as an unknown and testing what came back.
  const scope = globalThis as unknown as Record<string, unknown>;
  const ctor = scope[which];
  if (typeof ctor !== "function") return null;

  try {
    const codec = new (ctor as ByteTransformCtor)(DEFLATE_RAW);
    const writer = codec.writable.getWriter();

    // The write is started and not awaited yet. A transform stream accepts
    // only as much as its internal queue holds, so for a payload larger than
    // that queue the write settles only once the far end has been drained, and
    // awaiting it here would deadlock against the read loop below. Its failure
    // is captured rather than swallowed, because a write that failed while the
    // reader saw a clean end of stream would otherwise look like success and
    // return a truncated buffer.
    let writeFailed = false;
    const written = (async () => {
      await writer.write(bytes);
      await writer.close();
    })().catch(() => {
      writeFailed = true;
    });

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = codec.readable.getReader();
    for (;;) {
      const step = await reader.read();
      if (step.value !== undefined) {
        chunks.push(step.value);
        total += step.value.length;
      }
      if (step.done) break;
    }
    await written;
    if (writeFailed) return null;

    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Encode a program into a fragment, and measure it.
 *
 * Never throws and never refuses. A program over the ceiling comes back with
 * `over` set and a fragment that would work if a URL were bigger, and the
 * caller decides what to say about it. That split exists because this module
 * knows the number and the page knows the sentence, and putting the sentence
 * here would put a size into a file the site's own transcription gate reads.
 */
export async function encodeShare(source: string, entry: string): Promise<Encoded> {
  const raw = new TextEncoder().encode(source);

  // Both candidates, then the smaller one. Deflate adds a few bytes of block
  // header, so for a short program the compressed form is the bigger one, and
  // shipping it anyway would cost every reader an inflate for a worse payload.
  // A tie goes to raw, which needs no inflate at all on the way back.
  const deflated = await runByteTransform("CompressionStream", raw);
  const body = deflated !== null && deflated.length < raw.length ? deflated : raw;

  const payload = new Uint8Array(body.length + 1);
  payload[0] = body === deflated ? CODEC_DEFLATE_RAW : CODEC_RAW;
  payload.set(body, 1);

  const encoded = toBase64Url(payload);

  // The entry is omitted when it is the default, so the ordinary link stays
  // short, and percent encoded otherwise because an entry is a path and a path
  // holds '/'. `encodeURIComponent` never emits '+' for a space, which matters
  // because a fragment is not a query string and nothing here un-plusses.
  const fragment =
    entry === DEFAULT_ENTRY
      ? `src=${encoded}`
      : `src=${encoded}&entry=${encodeURIComponent(entry)}`;

  const length = encoded.length;
  return { fragment, length, over: length > SHARE_LIMIT ? length - SHARE_LIMIT : 0 };
}

/**
 * Split a fragment into its parameters, first occurrence winning.
 *
 * Hand written rather than handed to `URLSearchParams`, for two reasons. A
 * query string is defined to read '+' as a space and a fragment is not a query
 * string, so the payload has to arrive character for character. And a duplicate
 * key in a hand edited URL is ambiguous, so this picks the first and says so,
 * which is at least the behaviour a reader can predict.
 */
function fragmentParams(hash: string): Map<string, string> {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  // A Map rather than a keyed object because the keys come from a URL somebody
  // may have typed, and an untrusted key written into a plain object reaches
  // `Object.prototype`: `constructor` would read back as a function rather
  // than as absent, and first-wins would stop meaning what it says.
  const params = new Map<string, string>();

  for (const piece of text.split("&")) {
    if (piece.length === 0) continue;
    const split = piece.indexOf("=");
    const key = split < 0 ? piece : piece.slice(0, split);
    const value = split < 0 ? "" : piece.slice(split + 1);
    if (!params.has(key)) params.set(key, value);
  }

  return params;
}

/**
 * Recover a program from a fragment, or null.
 *
 * Null for: no `src`, base64url that is not base64url, a codec byte this
 * version does not know, an inflate that failed, and bytes that are not valid
 * UTF-8. It never throws and it never returns part of a program. A visitor who
 * arrives on a link that a chat client truncated gets the page's own starter
 * program and a plain sentence about the link, which is recoverable, rather
 * than a program missing its last function, which looks like the language is
 * broken.
 *
 * The leading '#' is optional and the parameters may arrive in either order,
 * because people edit URLs by hand and a format that only reads its own output
 * is a format that punishes them for it.
 */
export async function decodeShare(hash: string): Promise<Shared | null> {
  const params = fragmentParams(hash);

  const encoded = params.get("src");
  if (encoded === undefined || encoded.length === 0) return null;

  const payload = fromBase64Url(encoded);
  if (payload === null || payload.length < 1) return null;

  const codec = payload[0];
  const body = payload.subarray(1);

  let bytes: Uint8Array | null;
  if (codec === CODEC_RAW) {
    bytes = body;
  } else if (codec === CODEC_DEFLATE_RAW) {
    // Null here also covers a runtime with no `DecompressionStream`, which is
    // consistent: a runtime that cannot inflate cannot have produced this
    // payload either, so it is reading somebody else's link and saying so.
    bytes = await runByteTransform("DecompressionStream", body);
  } else {
    // A codec byte from a later version of this file. Refusing is the point:
    // the alternative is reading compressed bytes as text and calling it a
    // program.
    return null;
  }
  if (bytes === null) return null;

  let source: string;
  try {
    // `fatal` turns invalid UTF-8 into a throw instead of a run of replacement
    // characters, which is the difference between refusing a corrupted link
    // and opening a program with holes punched in it. `ignoreBOM` keeps a
    // leading U+FEFF as a character instead of eating it, so a round trip is
    // byte identical even for a source that starts with one.
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return null;
  }

  let entry = DEFAULT_ENTRY;
  const named = params.get("entry");
  if (named !== undefined) {
    // The parameter exists only to say the entry is not the default, so an
    // empty one cannot be honoured, and quietly substituting the default would
    // open a different file than the link named.
    if (named.length === 0) return null;
    try {
      entry = decodeURIComponent(named);
    } catch {
      return null;
    }
    if (entry.length === 0) return null;
  }

  return { source, entry };
}
