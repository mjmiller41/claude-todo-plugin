import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parse,
  serialize,
  nextId,
  emptyModel,
  DEFAULT_COLUMNS,
  VERSION,
} from "../scripts/todo.mjs";

const CANONICAL = `<!-- todo-kanban v1 -->
<!-- columns: Backlog, Todo, In Progress, Blocked, Done -->

## Backlog
- [ ] (T04) Add SHX font import !low #fonts
    > blocked on parser spec

## Todo

## In Progress
- [ ] (T02) GRBL jog controls !high #cam #m3

## Blocked

## Done
- [x] (T01) Scaffold monorepo #infra
`;

test("canonical text round-trips exactly (serialize∘parse is identity)", () => {
  assert.equal(serialize(parse(CANONICAL)), CANONICAL);
});

test("parse extracts all card fields", () => {
  const m = parse(CANONICAL);
  assert.deepEqual(m.columns, ["Backlog", "Todo", "In Progress", "Blocked", "Done"]);
  assert.equal(m.cards.length, 3);

  const t04 = m.cards.find((c) => c.id === "T04");
  assert.deepEqual(t04, {
    id: "T04",
    title: "Add SHX font import",
    done: false,
    column: "Backlog",
    priority: "low",
    tags: ["fonts"],
    note: "blocked on parser spec",
  });

  const t02 = m.cards.find((c) => c.id === "T02");
  assert.equal(t02.priority, "high");
  assert.deepEqual(t02.tags, ["cam", "m3"]);
  assert.equal(t02.note, null);

  const t01 = m.cards.find((c) => c.id === "T01");
  assert.equal(t01.done, true);
  assert.equal(t01.column, "Done");
  assert.equal(t01.priority, null);
  assert.deepEqual(t01.tags, ["infra"]);
});

test("model round-trips through serialize→parse (data-level identity)", () => {
  const model = {
    version: VERSION,
    columns: ["Todo", "Done"],
    cards: [
      { id: "T01", title: "plain", done: false, column: "Todo", priority: null, tags: [], note: null },
      { id: "T02", title: "rich one", done: false, column: "Todo", priority: "med", tags: ["a", "b"], note: "line1\nline2" },
      { id: "T03", title: "finished", done: true, column: "Done", priority: "high", tags: [], note: null },
    ],
  };
  assert.deepEqual(parse(serialize(model)), model);
});

test("multi-line notes survive round-trip", () => {
  const src = `<!-- todo-kanban v1 -->
<!-- columns: Todo -->

## Todo
- [ ] (T01) has a note
    > first line
    > second line
`;
  const m = parse(src);
  assert.equal(m.cards[0].note, "first line\nsecond line");
  assert.equal(serialize(m), src);
});

test("tag order is preserved", () => {
  const m = parse(`## Todo
- [ ] (T01) x #zebra #alpha #mike
`);
  assert.deepEqual(m.cards[0].tags, ["zebra", "alpha", "mike"]);
});

test("missing header/columns falls back to defaults", () => {
  const m = parse(`## Todo
- [ ] (T01) bare
`);
  assert.deepEqual(m.columns, DEFAULT_COLUMNS);
  assert.equal(m.version, VERSION);
  assert.equal(m.cards[0].column, "Todo");
});

test("title with internal punctuation but trailing meta parses cleanly", () => {
  const m = parse(`## Todo
- [ ] (T09) Fix: jog past soft-limit (edge) !high #bug
`);
  assert.equal(m.cards[0].title, "Fix: jog past soft-limit (edge)");
  assert.equal(m.cards[0].priority, "high");
  assert.deepEqual(m.cards[0].tags, ["bug"]);
});

test("nextId assigns the next zero-padded T-id", () => {
  assert.equal(nextId([]), "T01");
  assert.equal(nextId([{ id: "T01" }, { id: "T09" }]), "T10");
  assert.equal(nextId([{ id: "T02" }, { id: "T05" }]), "T06");
});

test("emptyModel is a valid, serializable empty board", () => {
  const m = emptyModel();
  assert.equal(m.cards.length, 0);
  assert.deepEqual(parse(serialize(m)), m);
});

test("CRLF input is normalized", () => {
  const crlf = "## Todo\r\n- [ ] (T01) win line\r\n";
  const m = parse(crlf);
  assert.equal(m.cards[0].title, "win line");
});
