import { getCollection, type CollectionEntry } from "astro:content";
import rules from "../generated/rules.json";
import samples from "../generated/samples/index.json";
import diagnostics from "../../records/diagnostics.json";
import { playgroundHref, sampleNote } from "../playground/samples";

export type Lesson = CollectionEntry<"learn">;

/**
 * A premise the specification states, and where it states it. Both come from
 * SPEC.md through scripts/samples.mjs: the rule table for `R-1` through `R-5`,
 * and a section's own opening paragraph for a decision the table does not carry,
 * such as `III.1` for errors as union members.
 */
export type Rule = { id: string; premise: string; cite: string };

/** The provenance every record under site/records/ carries. */
export type Recorded = {
  compiler: string;
  commit: string;
  machine: string;
  command: string;
  when: string;
};

/**
 * One rejected program and the verdict a real compiler gave it, recorded by
 * scripts/record-diagnostics.mjs and verified by scripts/records.mjs. `stderr`
 * is byte for byte what the compiler wrote, which is the only reason a page is
 * allowed to show it.
 */
export type BreakCase = {
  id: string;
  rule: string;
  title: string;
  path: string;
  command: string;
  exitCode: number;
  stderr: string;
  recorded: Recorded;
};

type DiagnosticsRecord = { recorded: Recorded; cases: Omit<BreakCase, "recorded">[] };

/**
 * The sequence, in order, with the order checked rather than assumed.
 *
 * `order` has to be unique and has to run from one without a gap, so the number
 * a reader sees beside a lesson is the number in the lesson's own frontmatter
 * and not a position this function invented. Two lessons claiming step two, or
 * a sequence that skips a step, fails the build.
 */
export async function sequence(): Promise<Lesson[]> {
  const lessons = [...(await getCollection("learn"))].sort(
    (a, b) => a.data.order - b.data.order,
  );

  if (lessons.length === 0) {
    throw new Error("src/content/learn holds no lessons, so there is no sequence");
  }

  lessons.forEach((lesson, i) => {
    const expected = i + 1;
    if (lesson.data.order !== expected) {
      const shown = lessons.map((l) => `${l.data.order} ${l.id}`).join(", ");
      throw new Error(
        `the learning sequence is ${shown}, which is not 1 to ${lessons.length} ` +
          `without a gap or a repeat. ${lesson.id} claims step ${lesson.data.order} ` +
          `and sits at ${expected}, so the number on the page would not be the ` +
          `number in the file.`,
      );
    }
  });

  return lessons;
}

/**
 * A premise by the identifier a lesson or a recording names, with the claimant
 * named in the failure. Nothing on the site states a premise in its own words,
 * so an identifier the specification does not carry is a build failure rather
 * than a blank line where the rule should be.
 */
export function ruleById(id: string, claimedBy: string): Rule {
  const rule = (rules as Record<string, Rule>)[id];
  if (!rule) {
    throw new Error(
      `${claimedBy} names ${id}, and SPEC.md states ` +
        `${Object.keys(rules).join(", ")}. A premise is read out of SPEC.md by ` +
        `scripts/samples.mjs, so either the identifier is wrong or that script ` +
        `needs to learn where the specification states it.`,
    );
  }
  return rule;
}

/** The rules a lesson teaches, each carrying SPEC.md's own sentence for it. */
export function rulesOf(lesson: Lesson): Rule[] {
  const ids = lesson.data.rule.trim().split(/\s+/);
  return ids.map((id) => ruleById(id, lesson.id));
}

/**
 * The recorded rejection a lesson's break-this-rule step shows.
 *
 * The file's provenance is attached to the case, because a recording is only
 * evidence with the compiler and the commit that produced it, and the two are
 * rendered in the same frame as the output. See doc/website/ART-DIRECTION.md.
 */
export function breakCase(id: string): BreakCase {
  const record = diagnostics as DiagnosticsRecord;
  const found = record.cases.find((c) => c.id === id);

  if (!found) {
    throw new Error(
      `site/records/diagnostics.json has no case "${id}". It records ` +
        `${record.cases.map((c) => c.id).join(", ")}. A diagnostic on this ` +
        `site is a recording of a real run, so a missing case is a build ` +
        `failure: record it with the command in that file's provenance rather ` +
        `than typing compiler output into a lesson.`,
    );
  }

  return { ...found, recorded: record.recorded };
}

/**
 * Where a step's program lives, how long it is, and where it can be run.
 *
 * The line count is read off the file by scripts/samples.mjs, so it is
 * structural: the same on every machine, which is why it is set flat and
 * inline rather than in a card. `playgroundHref` answers null for a program the
 * wasm record does not carry, which is the signal to say so plainly rather than
 * to link somewhere that cannot run it. `note` is the record's own sentence
 * about a program that runs and then fails on purpose, so the page carries the
 * record's candour instead of inventing its own.
 */
export function runOf(lesson: Lesson): {
  path: string;
  lines: number;
  href: string | null;
  note: string | null;
} {
  const path = lesson.data.sample;
  const key = path.replace(/^samples\//, "");
  const sample = (samples as Record<string, { lines: number }>)[key];

  if (!sample) {
    throw new Error(
      `${lesson.id} is grounded in ${path}, which is not in the listing index ` +
        `scripts/samples.mjs writes. That script resolves every sample a lesson ` +
        `names against the tree, so this means the file was renamed.`,
    );
  }

  return {
    path,
    lines: sample.lines,
    href: playgroundHref(path),
    note: sampleNote(path),
  };
}

/**
 * The two inline spans this site's short strings use: code and bold. SPEC.md
 * writes its rule premises that way and a lesson writes its summary that way,
 * and both are placed as text rather than run through the markdown pipeline,
 * so the spans are rendered here rather than left as punctuation on the page.
 */
export function inlineMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/**
 * Small counts spelled as words, the way the repository's own prose spells
 * them. A page indexes this rather than writing "four" into a sentence, so
 * adding a lesson changes the copy instead of making it wrong.
 */
export const SPELLED = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/** Where a lesson's pages live, with the deployment's base honoured. */
export function lessonHref(base: string, lesson: Lesson): string {
  return `${base.replace(/\/$/, "")}/learn/${lesson.id}/`;
}
