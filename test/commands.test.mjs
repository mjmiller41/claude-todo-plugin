import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyModel } from "../scripts/todo.mjs";
import {
  addCard,
  moveCard,
  doneCardById,
  removeCard,
  listCards,
  doneColumn,
} from "../scripts/commands.mjs";

test("addCard assigns sequential ids and defaults to first non-Done column", () => {
  const m = emptyModel(["Backlog", "Todo", "Done"]);
  const { card: a } = addCard(m, { title: "first" });
  const { card: b } = addCard(m, { title: "second" });
  assert.equal(a.id, "T01");
  assert.equal(b.id, "T02");
  assert.equal(a.column, "Backlog");
  assert.equal(a.done, false);
});

test("addCard carries priority and tags, rejects bad priority", () => {
  const m = emptyModel();
  const { card } = addCard(m, { title: "x", priority: "high", tags: ["cam", "bug"] });
  assert.equal(card.priority, "high");
  assert.deepEqual(card.tags, ["cam", "bug"]);
  assert.throws(() => addCard(m, { title: "y", priority: "urgent" }), /invalid priority/);
});

test("addCard requires a title and a real column", () => {
  const m = emptyModel();
  assert.throws(() => addCard(m, { title: "  " }), /title is required/);
  assert.throws(() => addCard(m, { title: "x", column: "Nope" }), /unknown column/);
});

test("addCard into Done marks the card done", () => {
  const m = emptyModel(["Todo", "Done"]);
  const { card } = addCard(m, { title: "already finished", column: "Done" });
  assert.equal(card.done, true);
});

test("moveCard syncs done flag both directions", () => {
  const m = emptyModel(["Todo", "In Progress", "Done"]);
  const { card } = addCard(m, { title: "task" });
  moveCard(m, card.id, "Done");
  assert.equal(card.done, true);
  assert.equal(card.column, "Done");
  moveCard(m, card.id, "In Progress");
  assert.equal(card.done, false);
  assert.equal(card.column, "In Progress");
});

test("moveCard validates id and column", () => {
  const m = emptyModel();
  addCard(m, { title: "task" });
  assert.throws(() => moveCard(m, "T99", "Todo"), /no card with id/);
  assert.throws(() => moveCard(m, "T01", "Ghost"), /unknown column/);
});

test("doneCardById moves to Done when a Done column exists", () => {
  const m = emptyModel(["Todo", "Done"]);
  const { card } = addCard(m, { title: "finish me" });
  doneCardById(m, card.id);
  assert.equal(card.column, "Done");
  assert.equal(card.done, true);
});

test("doneCardById sets the flag when no Done column exists", () => {
  const m = emptyModel(["Open", "Closed"]);
  assert.equal(doneColumn(m), null);
  const { card } = addCard(m, { title: "x" });
  doneCardById(m, card.id);
  assert.equal(card.done, true);
  assert.equal(card.column, "Open");
});

test("removeCard deletes the right card", () => {
  const m = emptyModel();
  const { card: a } = addCard(m, { title: "a" });
  addCard(m, { title: "b" });
  removeCard(m, a.id);
  assert.equal(m.cards.length, 1);
  assert.equal(m.cards[0].title, "b");
});

test("listCards filters by column, tag, and priority", () => {
  const m = emptyModel(["Todo", "Done"]);
  addCard(m, { title: "a", tags: ["cam"], priority: "high" });
  addCard(m, { title: "b", tags: ["ui"], priority: "low" });
  addCard(m, { title: "c", column: "Done", tags: ["cam"] });
  assert.equal(listCards(m, { column: "Todo" }).length, 2);
  assert.equal(listCards(m, { tag: "cam" }).length, 2);
  assert.equal(listCards(m, { priority: "high" }).length, 1);
  assert.equal(listCards(m, { column: "Todo", tag: "cam" }).length, 1);
});
