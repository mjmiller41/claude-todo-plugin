import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse as corePARSE } from "../scripts/todo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, "..", "templates", "board.html"), "utf8");

// Extract the inlined todo-core block and import it as a module, so we exercise
// the ACTUAL parser shipped in board.html — not a copy of it.
const START = "// ==================== todo-core";
const END = "// ================== end todo-core";
const s = HTML.indexOf(START);
const e = HTML.indexOf(END);
assert.ok(s !== -1 && e !== -1, "board.html must contain the todo-core markers");
const block = HTML.slice(s, e) + "\nexport { parse };\n";
const mod = await import("data:text/javascript," + encodeURIComponent(block));
const boardPARSE = mod.parse;

const FIXTURES = [
  `<!-- todo-kanban v1 -->
<!-- columns: Backlog, Todo, In Progress, Blocked, Done -->

## Backlog
- [ ] (T04) Add SHX font import !low #fonts
    > blocked on parser spec

## In Progress
- [ ] (T02) GRBL jog controls !high #cam #m3

## Done
- [x] (T01) Scaffold monorepo #infra
`,
  `## Todo
- [ ] (T09) Fix: jog past soft-limit (edge) !high #bug #cam
    > repro line 1
    > repro line 2
## Done
- [x] (T10) done thing
`,
  `## Todo
- [ ] (T01) bare card
`,
];

test("board.html parser matches scripts/todo.mjs on all fixtures", () => {
  for (const fx of FIXTURES) {
    assert.deepEqual(
      boardPARSE(fx),
      corePARSE(fx),
      "parser drift detected between board.html and scripts/todo.mjs"
    );
  }
});
