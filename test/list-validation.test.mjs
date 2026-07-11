import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), "scripts", "cli.mjs");

// A board with the repo's five columns, some cards with tags, and one valid but
// empty column ("In Progress") to keep the empty-valid-column path exercised.
const BOARD = `<!-- todo-kanban v1 -->
<!-- columns: Backlog, Todo, In Progress, Blocked, Done -->

## Backlog
- [ ] (T01) Sketch board layout !low #design

## Todo
- [ ] (T02) Wire up drop targets !high #frontend
- [ ] (T03) Write parser !med #parser

## In Progress

## Blocked
- [ ] (T04) Waiting on review #blocked

## Done
- [x] (T05) Scaffold
`;

function board() {
  const dir = mkdtempSync(join(tmpdir(), "todo-list-"));
  const file = join(dir, "todo.md");
  writeFileSync(file, BOARD);
  return file;
}

function runList(file, ...args) {
  return spawnSync(process.execPath, [CLI, "list", ...args, "--file", file], { encoding: "utf8" });
}

test("A1/A2: unknown --col exits non-zero and enumerates every valid column", () => {
  const r = runList(board(), "--col", "Bogus");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Bogus/);
  for (const col of ["Backlog", "Todo", "In Progress", "Blocked", "Done"]) {
    assert.match(r.stderr, new RegExp(col.replace(/ /g, "\\s")));
  }
});

test("A4: unknown --col writes to stderr; stdout has no card listing or empty-result line", () => {
  const r = runList(board(), "--col", "Bogus");
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /\(no matching cards\)/);
  assert.doesNotMatch(r.stdout, /T0\d/);
  assert.equal(r.stdout.trim(), "");
});

test("A3: unknown --tag exits non-zero, names the tag AND enumerates every present tag", () => {
  const r = runList(board(), "--tag", "nosuchtag");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /nosuchtag/); // names the rejected tag
  // enumerates the tags actually present on cards in this todo.md
  for (const tag of ["design", "frontend", "parser", "blocked"]) {
    assert.match(r.stderr, new RegExp(tag));
  }
});

test("A4: unknown --tag writes to stderr; stdout has no card listing or empty-result line", () => {
  const r = runList(board(), "--tag", "nosuchtag");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /nosuchtag/); // error is on stderr
  assert.doesNotMatch(r.stdout, /\(no matching cards\)/); // not a "successful empty result"
  assert.doesNotMatch(r.stdout, /T0\d/); // no card listing leaked to stdout
  assert.equal(r.stdout.trim(), "");
});

test("A8: column matching is exact/case-sensitive — lowercase 'todo' is rejected", () => {
  const r = runList(board(), "--col", "todo");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /valid columns/);
  assert.match(r.stderr, /Todo/);
});

test("A10: combinations validate both flags", () => {
  const validColBogusTag = runList(board(), "--col", "Todo", "--tag", "bogus");
  assert.notEqual(validColBogusTag.status, 0);
  const bogusColValidTag = runList(board(), "--col", "Bogus", "--tag", "frontend");
  assert.notEqual(bogusColValidTag.status, 0);
});

test("valid --col with cards succeeds and lists them", () => {
  const r = runList(board(), "--col", "Todo");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /T02/);
  assert.match(r.stdout, /T03/);
});

test("valid --tag succeeds and lists matching cards", () => {
  const r = runList(board(), "--tag", "frontend");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /T02/);
});

test("valid but empty column exits 0 with (no matching cards)", () => {
  const r = runList(board(), "--col", "In Progress");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\(no matching cards\)/);
});

test("bare list with no filters exits 0 with the full board", () => {
  const r = runList(board());
  assert.equal(r.status, 0);
  assert.match(r.stdout, /T01/);
  assert.match(r.stdout, /T05/);
});

test("A5: valid --col with cards lists exactly that column's cards, none from other columns", () => {
  const r = runList(board(), "--col", "Todo");
  assert.equal(r.status, 0);
  // exactly the two Todo cards, grouped under the column header
  assert.match(r.stdout, /^Todo$/m);
  assert.match(r.stdout, /T02/);
  assert.match(r.stdout, /T03/);
  // no card from any other column leaks in
  for (const id of ["T01", "T04", "T05"]) assert.doesNotMatch(r.stdout, new RegExp(id));
  assert.doesNotMatch(r.stdout, /\(no matching cards\)/);
});

test("A11: bare list prints the full grouped board readout (every column's cards)", () => {
  const r = runList(board());
  assert.equal(r.status, 0);
  // every populated column heading appears, grouping the readout
  for (const col of ["Backlog", "Todo", "Blocked", "Done"]) {
    assert.match(r.stdout, new RegExp("^" + col.replace(/ /g, "\\s") + "$", "m"));
  }
  // and every card is present
  for (const id of ["T01", "T02", "T03", "T04", "T05"]) assert.match(r.stdout, new RegExp(id));
});

test("A11: pre-existing --prio validation preserved — list --prio bogus exits non-zero on stderr", () => {
  const r = runList(board(), "--prio", "bogus");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /prio/); // error names the offending flag
  assert.doesNotMatch(r.stdout, /\(no matching cards\)/); // not a successful empty result
  assert.doesNotMatch(r.stdout, /T0\d/); // no card listing leaked to stdout
});

test("A11: a valid --prio still succeeds and lists matching cards", () => {
  const r = runList(board(), "--prio", "high");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /T02/); // the only !high card in this board
  assert.doesNotMatch(r.stdout, /\(no matching cards\)/);
});

test("A9: zero-tags board — unknown --tag exits non-zero, reports (none), no crash/stack trace", () => {
  const dir = mkdtempSync(join(tmpdir(), "todo-notags-"));
  const file = join(dir, "todo.md");
  writeFileSync(file, `<!-- todo-kanban v1 -->\n<!-- columns: Todo, Done -->\n\n## Todo\n- [ ] (T01) untagged\n\n## Done\n`);
  const r = runList(file, "--tag", "anything");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /\(none\)/); // valid-tag set is clearly empty
  assert.doesNotMatch(r.stderr, /at Object|at cmdList|at \S+ \(/); // no stack trace / unhandled throw
  assert.doesNotMatch(r.stdout, /\(no matching cards\)/);
});
