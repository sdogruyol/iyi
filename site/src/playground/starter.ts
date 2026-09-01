/**
 * The program the playground's editor opens with, once there is an editor for
 * it to open in.
 *
 * NOTHING IMPORTS THIS TODAY, and that is not an oversight to clean up. The
 * bare `/playground/` route that used to open on this text is now a short
 * coming-soon page, because the routes that really run a program are the sample
 * routes under it, and an editor with no compiler behind it had nothing to
 * offer. The parked IDE specification still calls for a starter program, and
 * these five lines are the only ones in the tree that have been run through the
 * fork's own compiler for that purpose, so rewriting them later from nothing
 * would cost more than keeping them costs now. That is why the file stays.
 *
 * WHY THIS IS NOT A CURATED SAMPLE. Every sample in `samples/iyi/` is a
 * teaching file: a long comment header, a rule cited per section, and a list of
 * what is still missing at the bottom. That is exactly right beside a lesson,
 * and it is exactly wrong as the first thing a visitor sees on a page whose
 * whole job is to invite them to type. Landing on one of those is what made
 * this page read as an example page rather than a playground. So the editor
 * opens on something short enough to read in one glance and to overwrite in
 * one keystroke, and the thirteen samples are one menu away.
 *
 * WHY THESE FIVE LINES AND NOT "hello world". Because the site's argument is a
 * keyword set, and two of iyi's rules are visible here in less space than a
 * greeting would take. `module main` is R-1: a module is the unit of
 * compilation, and this program is one. `pub def greet(name : String) : String`
 * is R-2: an exported declaration carries its full signature, which is the
 * contract a consumer compiles against and the only thing it ever needs to
 * read. Both keywords carry the site's emphasis, so the starter also shows what
 * the colouring is for.
 *
 * WHAT IS RECORDED HERE AND WHAT IS NOT. Nothing. This is authored source, not
 * a recording, and the editor is to treat it as exactly that: there is no token
 * stream for it, so it renders in plain ink until iyi's own compiler, running
 * as wasm in the page, lexes it there with nothing leaving the machine, and
 * there is no recorded module for it, so running it needs that same in-browser
 * compiler and the page says so plainly while there is none. That is the honest
 * treatment of text nobody measured, and it is the same treatment the page
 * gives anything a visitor types, which is the point: the starter is not
 * privileged.
 *
 * THAT IT COMPILES IS MEASURED, NOT ASSUMED. `module main` in a file named
 * `main.iyi` was run through the fork's own compiler against this tree's
 * prelude and exited 0. A module header does not have to match its file's path,
 * which is why the samples can say `module samples/hello` from
 * `samples/iyi/hello.iyi`: R-1 makes a module's path its file's path for
 * anything another module imports, and a single file program is never imported.
 */

/**
 * The entry path.
 *
 * `main.iyi` because a module's identity in iyi is its path, so the editor has
 * to call the program something. It is also the value `share.ts` treats as the
 * default, so a shared link for this program carries no `entry` parameter at
 * all.
 */
export const STARTER_ENTRY = "main.iyi";

/**
 * The source.
 *
 * A trailing newline, because a file has one and the text in the editor is
 * meant to be a file. Written as an array joined at the end rather than as one
 * template literal so that a line cannot acquire trailing whitespace nobody
 * can see, which in a program that gets hashed and compared against a digest is
 * a difference with consequences.
 */
export const STARTER_SOURCE = [
  "# Type anything here, then run it with Cmd or Ctrl and Enter.",
  "#",
  "# Two of iyi's rules are already in these five lines. `module` is R-1: a",
  "# module is the unit of compilation, and this program is one. `pub` is R-2:",
  "# an exported declaration carries its full signature, which is the whole of",
  "# what a consumer ever needs to read.",
  "",
  "module main",
  "",
  "pub def greet(name : String) : String",
  '  "Hello, #{name}!"',
  "end",
  "",
  'puts greet("iyi")',
  "",
].join("\n");
