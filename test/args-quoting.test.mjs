import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// T11: commands/*.md must not tell Claude to pass arguments "verbatim", and any
// command whose fenced code block interpolates $ARGUMENTS must carry an explicit
// safe-quoting instruction with a concrete example. This guards against shell
// injection via unquoted user-supplied argument substitution.

const HERE = dirname(fileURLToPath(import.meta.url));
const CMD_DIR = join(HERE, "..", "commands");

const files = readdirSync(CMD_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => ({ name: f, text: readFileSync(join(CMD_DIR, f), "utf8") }));

assert.ok(files.length > 0, "expected at least one commands/*.md file");

// Extract fenced code blocks (```...```), returning the code content of each.
function fencedBlocks(text) {
  const blocks = [];
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

// A file carries the safe-quoting instruction if it mentions shell-quoting AND
// includes a concrete example: an inline-code span containing a single-quoted
// string (e.g. `'Ship it; rm -rf /'` or the `'\''` escape).
function hasSafeQuotingInstruction(text) {
  const mentionsQuoting = /shell-quote/i.test(text);
  const hasConcreteExample = /`[^`\n]*'[^`\n]+'[^`\n]*`/.test(text);
  return mentionsQuoting && hasConcreteExample;
}

test("no commands/*.md says 'verbatim'", () => {
  for (const { name, text } of files) {
    assert.ok(
      !/verbatim/i.test(text),
      `commands/${name} still contains the word "verbatim"`
    );
  }
});

test("every $ARGUMENTS command carries a safe-quoting instruction with an example", () => {
  for (const { name, text } of files) {
    const interpolatesArgs = fencedBlocks(text).some((b) => b.includes("$ARGUMENTS"));
    if (!interpolatesArgs) continue;
    assert.ok(
      hasSafeQuotingInstruction(text),
      `commands/${name} interpolates $ARGUMENTS but lacks a safe shell-quoting instruction with a concrete example`
    );
  }
});
