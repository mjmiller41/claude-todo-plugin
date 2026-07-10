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

/** Mint a fresh, never-reused id and advance the model's high-water mark.
 *  Uses the persisted `model.next` counter when present; otherwise seeds it from
 *  the existing ids (so a legacy board upgrades cleanly on its first add). The
 *  collision guard defends against a hand-authored id sitting at the counter. */
function mintId(model) {
  const existing = new Set(model.cards.map((c) => c.id));
  let n = Number.isInteger(model.next)
    ? model.next
    : Number(/(\d+)$/.exec(nextId(model.cards))[1]); // derive from existing ids
  let id = "T" + String(n).padStart(2, "0");
  while (existing.has(id)) {
    n += 1;
    id = "T" + String(n).padStart(2, "0");
  }
  model.next = n + 1; // persist the mark so a later delete can't cause reuse
  return id;
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
    id: mintId(model),
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

/** Edit an existing card in place. `patch` may carry any subset of
 *  { title, priority, tags, note, column }; omitted keys are left untouched.
 *  `priority: null` clears it; `note: null` clears the note; changing `column`
 *  re-syncs the Done coupling exactly as moveCard does. Returns { model, card }. */
export function editCard(model, id, patch = {}) {
  const card = findCard(model, id);
  if (patch.title !== undefined) {
    const t = String(patch.title).trim();
    if (!t) throw new Error("title cannot be empty");
    card.title = t;
  }
  if (patch.priority !== undefined) {
    const p = patch.priority;
    if (p !== null && !PRIORITIES.includes(p)) {
      throw new Error(`invalid priority: ${p} (use ${PRIORITIES.join("|")}|none)`);
    }
    card.priority = p;
  }
  if (patch.tags !== undefined) card.tags = [...patch.tags];
  if (patch.note !== undefined) card.note = patch.note === null ? null : String(patch.note);
  if (patch.column !== undefined && patch.column !== null) {
    assertColumn(model, patch.column);
    card.column = patch.column;
    card.done = patch.column === doneColumn(model);
  }
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
