// todo-kanban — command logic. Pure functions over the model (no file I/O).
// This is where the Done-column ⇔ checkbox invariant lives, so both the CLI and
// (later) the board share identical mutation semantics via the same rules.

import { nextId, PRIORITIES } from "./todo.mjs";

/** The canonical "done" column, if the board defines one. */
export function doneColumn(model) {
  return model.columns.includes("Done") ? "Done" : null;
}

/** Default column for a new card: first non-Done column, else the first column. */
function defaultColumn(model) {
  const done = doneColumn(model);
  return model.columns.find((c) => c !== done) ?? model.columns[0];
}

function assertColumn(model, column) {
  if (!model.columns.includes(column)) {
    throw new Error(`unknown column: "${column}" (have: ${model.columns.join(", ")})`);
  }
}

function findCard(model, id) {
  const card = model.cards.find((c) => c.id === id);
  if (!card) throw new Error(`no card with id: ${id}`);
  return card;
}

/** Add a card. Returns { model, card }. Mutates model.cards. */
export function addCard(model, { title, priority = null, tags = [], column = null } = {}) {
  const text = (title ?? "").trim();
  if (!text) throw new Error("title is required");
  if (priority !== null && !PRIORITIES.includes(priority)) {
    throw new Error(`invalid priority: ${priority} (use ${PRIORITIES.join("|")})`);
  }
  const col = column ?? defaultColumn(model);
  assertColumn(model, col);

  const card = {
    id: nextId(model.cards),
    title: text,
    done: col === doneColumn(model),
    column: col,
    priority,
    tags: [...tags],
    note: null,
  };
  model.cards.push(card);
  return { model, card };
}

/** Move a card to a column, syncing its done flag to the Done-column rule. */
export function moveCard(model, id, column) {
  assertColumn(model, column);
  const card = findCard(model, id);
  card.column = column;
  card.done = column === doneColumn(model);
  return { model, card };
}

/** Mark a card done: move it to the Done column (or just set the flag if none). */
export function doneCardById(model, id) {
  const done = doneColumn(model);
  if (done) return moveCard(model, id, done);
  const card = findCard(model, id);
  card.done = true;
  return { model, card };
}

/** Remove a card by id. Returns the removed card. */
export function removeCard(model, id) {
  const card = findCard(model, id);
  model.cards = model.cards.filter((c) => c !== card);
  return card;
}

/** Filter cards for display. filter: { column?, tag?, priority? }. */
export function listCards(model, filter = {}) {
  return model.cards.filter((c) => {
    if (filter.column && c.column !== filter.column) return false;
    if (filter.tag && !c.tags.includes(filter.tag)) return false;
    if (filter.priority && c.priority !== filter.priority) return false;
    return true;
  });
}
