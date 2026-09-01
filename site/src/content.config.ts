import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * The learning sequence.
 *
 * Every field below is required except `sources`, and that is the point of this
 * schema: a step in a path has a shape a reader can rely on, so a lesson that
 * cannot state which rule it teaches, which program it is grounded in, how that
 * rule is broken, or what the rule bought, is not a step. It fails the build
 * instead of rendering a page with a hole in it.
 *
 * `order` has no default. A lesson without a position in the sequence is not a
 * lesson, it is a page, and the difference is the whole point of this section:
 * reading three teaches the third because you read the second.
 *
 * `rule` names what the step teaches, in the specification's own identifiers:
 * one or more of the rules SPEC.md's Part I table states, or a section number
 * for a decision that table does not carry, such as `III.1` for errors as union
 * members. Shape is checked here; existence is checked against SPEC.md by
 * scripts/samples.mjs, which reads both.
 *
 * `sample` names the program under samples/iyi the step is grounded in. It is
 * resolved against the tree by scripts/samples.mjs, so a renamed sample fails
 * the build naming the lesson that asked for it, and it is looked up in the
 * wasm record to decide whether the step can offer to run it.
 *
 * `breaks` names the case in site/records/diagnostics.json whose recorded
 * compiler output the step shows. Existence is checked by src/lib/lessons.ts
 * against that record, so a step cannot claim a diagnostic nobody ran.
 */
const learn = defineCollection({
  loader: glob({ base: "./src/content/learn", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    title: z.string().min(1),
    order: z.number().int().positive(),
    summary: z.string().min(1),
    rule: z
      .string()
      .regex(
        /^(?:R-\d[a-z]?|[IVX]+\.\d+)(?: (?:R-\d[a-z]?|[IVX]+\.\d+))*$/,
        "rule is one or more space separated identifiers SPEC.md states, such as `R-1`, `R-2b` or `III.1`",
      ),
    sample: z
      .string()
      .regex(
        /^samples\/iyi\/[\w./-]+\.iyi$/,
        "sample is a path to a real program, such as `samples/iyi/hello.iyi`",
      ),
    breaks: z
      .string()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "breaks is a case id in site/records/diagnostics.json, such as `r2b-using-missing`",
      ),
    // Files the break exercise has to show beside the rejected program: the two
    // modules that close an import cycle, say. Repository relative paths,
    // resolved through the same listing index every other sample on the site is
    // read from, so a path that is not in the tree fails the build.
    breaksAlso: z.array(z.string().min(1)).optional(),
    // What the rule bought, in one or two sentences, grounded in the tree. It
    // is a field rather than a closing paragraph because it is the fourth part
    // of every step's shape, and a shape a reader can rely on is one the
    // template renders rather than one the prose remembers.
    bought: z.string().min(1),
    // What the lesson's prose is standing on. The listings and the quoted
    // recordings already print their own file and line numbers, generated, so
    // this is for the passages a lesson leans on without showing. Every path is
    // resolved against the repository by scripts/samples.mjs, so a source that
    // names a file which is not there fails the build. No line numbers here on
    // purpose: a hand-typed number is the one thing this site cannot ship.
    sources: z
      .array(
        z.object({
          file: z.string().min(1),
          note: z.string().min(1),
        }),
      )
      .optional(),
  }),
});

export const collections = { learn };
