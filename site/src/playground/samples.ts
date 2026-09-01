/**
 * The curated set the playground can run, read out of the recording.
 *
 * `site/records/wasm/manifest.json` is produced on a machine that has the iyi
 * compiler and wasi-sdk on it. The Pages build has neither, so the build
 * VERIFIES that record and copies the modules beside it into `public/wasm/`; it
 * never compiles anything. Which samples the playground offers is therefore a
 * fact about the recording, not a list typed into a page, and a sample that
 * failed to record is a sample the page cannot offer.
 *
 * Every number here is a RECORDED number in this site's terms: a byte count is
 * a property of a compiler on a machine, so it is rendered only inside the
 * stamped treatment that carries that machine and the command that produced it.
 * `wasmProvenance` is that stamp, and it is validated at import so a record
 * with a hole in it stops the build rather than rendering a figure with no
 * source.
 *
 * This module is also the one place that builds a playground URL, because
 * lessons deep link into the playground and a link built by hand can name a
 * sample the recording does not have. `playgroundHref` returns `null` for a
 * path the recording does not cover, which is a caller's signal to say so in
 * words rather than to render a link that leads to nothing.
 *
 * ONE THING THIS MODULE DELIBERATELY DOES NOT DO: reach the highlight record.
 * The engine imports this file, the engine runs in the browser, so anything
 * this file imports is shipped to every visitor of a playground page. The wasm
 * manifest is thirteen small entries and is genuinely needed at run time, to
 * check a module's digest before instantiating it. The highlight record is a
 * quarter of a megabyte of listings and belongs to the build. Importing it here
 * once put all of it in the playground's client bundle, an order of magnitude
 * more JavaScript than the page's other island. A site arguing that a
 * program should link only what it uses does not get to ship that, so recorded
 * source text is read from `src/lib/highlight.ts` by the build only.
 */
import manifest from "../../records/wasm/manifest.json";

/**
 * The machine stamp every record carries. Identical in shape across all three
 * records, because provenance is the same question wherever it is asked.
 */
export interface Provenance {
  /** First line of `iyi --version` on the recording machine. */
  compiler: string;
  /** `git rev-parse HEAD` in the tree that was recorded. */
  commit: string;
  /** The box: `uname -srm` and the cpu brand. */
  machine: string;
  /** The npm script that regenerates this record. */
  command: string;
  /** ISO 8601. */
  when: string;
}

/** One curated sample, exactly as the recorder wrote it. */
export interface CuratedSample {
  /** Stable id, the sample's basename. Also the module's file name and the
   * value the playground accepts in its `?sample=` query. */
  id: string;
  /** Repository relative path of the source. The key into the highlight
   * record, and the module's own name in iyi, since a module's path is its
   * file's path. */
  path: string;
  /**
   * SHA-256 of the raw bytes of the source file at `path`, as it was when the
   * module was recorded.
   *
   * No engine reads this field today, and the reason to keep it is not that an
   * engine will one day want it. Its job now is the staleness gate in
   * `scripts/records.mjs`: on every build that script hashes the file on disk
   * at `path` and, when the digest differs from the one recorded here, fails
   * naming the sample and saying that the recorded module was compiled from
   * text that is no longer in the tree, with `npm run record:wasm` as the way
   * out. Without that comparison a sample could be edited and the site would
   * keep shipping a module built from the previous text, running a program the
   * listing beside it does not show. The same script also rejects a missing or
   * malformed digest, so the gate cannot be disarmed by deleting the field.
   *
   * The in-browser compiler engine will want it too, to tell an unedited
   * curated sample, which can run from its recorded module, from an edit, which
   * has to be compiled in the tab. A digest rather than the text itself,
   * because the only client reachable copy of the text is the highlight record,
   * and importing that ships every listing on the site to every visitor.
   */
  sourceSha256: string;
  /** File name of the linked module, sitting beside the manifest. */
  wasm: string;
  /** Size of the linked module. Recorded: a compiler on a machine produced it. */
  bytes: number;
  /** SHA-256 of those bytes, so the page can refuse to run a module that is
   * not the one that was recorded. */
  sha256: string;
  /** The status the recorded run really ended with. */
  exitCode: number;
  /** What the native binary printed. */
  nativeStdout: string;
  /** What the wasm module printed under a wasi host. */
  wasmStdout: string;
  /** Whether those two are the same bytes. The claim the recording exists to
   * support, and it is a recorded fact rather than an aspiration. */
  identical: boolean;
  /** One sentence, present only where this sample needs one. `files` needs one:
   * it panics on purpose on this target. Null everywhere else, so a note on
   * the page is always a note the recording asked for. */
  note: string | null;
}

interface WasmManifest {
  recorded: Provenance;
  samples: CuratedSample[];
}

const record = manifest as WasmManifest;

export const wasmProvenance: Provenance = record.recorded;

for (const field of [
  "compiler",
  "commit",
  "machine",
  "command",
  "when",
] as const) {
  if (!wasmProvenance?.[field]) {
    throw new Error(
      `playground: site/records/wasm/manifest.json has no ` +
        `"recorded.${field}". A byte count without the machine that produced ` +
        `it is not a measurement, and this site has no component that can ` +
        `render one. Regenerate the record.`,
    );
  }
}

if (!Array.isArray(record.samples) || record.samples.length === 0) {
  throw new Error(
    "playground: site/records/wasm/manifest.json records no samples, so " +
      "there is nothing the playground can run. An empty picker rendered " +
      "without complaint is how a broken recorder ships unnoticed.",
  );
}

/** The curated set, in the recorder's order. */
export const curatedSamples: readonly CuratedSample[] = record.samples;

/**
 * Lookup by id or by repository relative path, because callers hold one or the
 * other and neither should have to convert. Built once: a page resolves this
 * per lesson link and per picker entry.
 */
const byKey: Record<string, CuratedSample> = {};
for (const sample of curatedSamples) {
  byKey[sample.id] = sample;
  byKey[sample.path] = sample;
}

/**
 * The recorded sample for an id or a repository relative path, or `null`.
 *
 * Null rather than a throw, because "this sample is not runnable here" is a
 * true and expected answer that a caller renders as a sentence. A caller that
 * needs the sample to exist should say so itself.
 */
export function findSample(pathOrId: string): CuratedSample | null {
  return byKey[pathOrId] ?? null;
}

/**
 * A deep link into the playground for one sample, or `null` when the recording
 * does not cover it.
 *
 * A PATH rather than a query string, because the playground is one static page
 * per curated sample: each page carries only its own program and its own
 * recording, so the link resolves before any script runs and works with scripts
 * off. A query string would have meant one page holding all thirteen listings
 * and a control to reveal one, which is the opposite of the argument this
 * project makes about linking only what you use.
 *
 * The base is read from `import.meta.env.BASE_URL` rather than written, because
 * the site is served under `/iyi` on Pages and under `/` on a custom domain,
 * and a hard coded prefix would break one of the two. Normalised to a single
 * trailing slash so the join is right whichever way the base is set, and the
 * href carries one too, because the site is built with `trailingSlash: always`.
 */
export function playgroundHref(pathOrId: string): string | null {
  const sample = findSample(pathOrId);
  if (sample === null) return null;
  const base = import.meta.env.BASE_URL.replace(/\/*$/, "/");
  return `${base}playground/${encodeURIComponent(sample.id)}/`;
}

/**
 * The recorder's note for a sample, or `null` where it wrote none.
 *
 * Exported so a lesson linking a sample that behaves unusually on this target
 * carries the recording's own sentence rather than a second description of the
 * same fact, written elsewhere, free to drift.
 */
export function sampleNote(pathOrId: string): string | null {
  return findSample(pathOrId)?.note ?? null;
}

