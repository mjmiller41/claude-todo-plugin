import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse, serialize } from "../scripts/todo.mjs";
import { moveCard as applyMove } from "../scripts/commands.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, "..", "templates", "board.html"), "utf8");

// Extract the inlined server-sync block and import it as a module, so the test
// exercises the ACTUAL serverSave shipped in board.html — not a copy of it.
const START = "// ==================== server-sync";
const END = "// ================== end server-sync";
const s = HTML.indexOf(START);
const e = HTML.indexOf(END);
assert.ok(s !== -1 && e !== -1, "board.html must contain the server-sync markers");
const block = HTML.slice(s, e) + "\nexport { serverSave };\n";
const { serverSave } = await import("data:text/javascript," + encodeURIComponent(block));

// Minimal Response stub: status/ok + text()/headers.get("ETag").
function resp({ status = 200, text = "", etag = null } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
    headers: { get: (h) => (h.toLowerCase() === "etag" ? etag : null) },
  };
}

// A fetch double that returns a queued response per call and records every call.
function mockFetch(queue) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, ...opts });
    const next = queue.shift();
    if (!next) throw new Error("unexpected fetch call #" + calls.length);
    return next;
  };
  fn.calls = calls;
  return fn;
}

const SRC = `<!-- todo-kanban v1 -->
<!-- columns: Todo, In Progress, Done -->

## Todo
- [ ] (T01) local card !high #a
## In Progress
## Done
`;

test("serverSave sends If-Match with the cached ETag and records the new ETag", async () => {
  const model = parse(SRC);
  const fetchFn = mockFetch([resp({ status: 204, etag: '"new"' })]);
  const r = await serverSave({
    fetchFn, parse, serialize, applyMove,
    model, etag: '"e0"', pendingMove: { id: "T01", column: "In Progress" },
  });
  assert.equal(fetchFn.calls.length, 1, "happy path is a single PUT, no refetch");
  assert.equal(fetchFn.calls[0].method, "PUT");
  assert.equal(fetchFn.calls[0].headers["If-Match"], '"e0"', "PUT must carry If-Match");
  assert.equal(r.etag, '"new"', "records the ETag returned by the successful PUT");
  assert.equal(r.model, model, "unchanged model on the happy path");
});

test("serverSave on 409 refetches, re-applies the move to the fresh model, retries once with fresh ETag", async () => {
  // Board loaded SRC (etag e0) then optimistically moved T01 -> In Progress.
  const optimistic = parse(SRC);
  applyMove(optimistic, "T01", "In Progress");

  // Meanwhile the CLI added T02 to Todo, so the file on the server changed.
  const serverText = `<!-- todo-kanban v1 -->
<!-- columns: Todo, In Progress, Done -->

## Todo
- [ ] (T01) local card !high #a
- [ ] (T02) cli card #b
## In Progress
## Done
`;
  const fetchFn = mockFetch([
    resp({ status: 409, etag: '"e1"', text: serverText }), // stale If-Match -> conflict
    resp({ status: 200, etag: '"e1"', text: serverText }), // refetch todo.md
    resp({ status: 204, etag: '"e2"' }),                   // retry PUT succeeds
  ]);

  const r = await serverSave({
    fetchFn, parse, serialize, applyMove,
    model: optimistic, etag: '"e0"', pendingMove: { id: "T01", column: "In Progress" },
  });

  assert.equal(fetchFn.calls.length, 3, "PUT, refetch GET, retry PUT — retried exactly once");
  assert.equal(fetchFn.calls[0].method, "PUT");
  assert.equal(fetchFn.calls[0].headers["If-Match"], '"e0"');
  assert.equal(fetchFn.calls[1].method ?? "GET", "GET", "second call is a refetch, not a PUT");
  assert.equal(fetchFn.calls[2].method, "PUT");
  assert.equal(fetchFn.calls[2].headers["If-Match"], '"e1"', "retry PUT uses the fresh ETag");

  // The merged model keeps BOTH writes: the CLI card AND the dragged card in its
  // new column — neither is lost.
  const merged = r.model;
  const t01 = merged.cards.find(c => c.id === "T01");
  const t02 = merged.cards.find(c => c.id === "T02");
  assert.ok(t02, "CLI-added T02 survives the retry");
  assert.equal(t02.column, "Todo");
  assert.equal(t01.column, "In Progress", "dragged T01 lands in its new column");

  // The retried PUT body carries both cards, and the returned ETag is the retry's.
  assert.match(fetchFn.calls[2].body, /\(T01\)/);
  assert.match(fetchFn.calls[2].body, /\(T02\)/);
  assert.equal(r.etag, '"e2"');
  assert.notEqual(r.model, optimistic, "adopts the freshly-merged model, not the stale optimistic one");
});

test("serverSave without an ETag omits If-Match (legacy save path)", async () => {
  const model = parse(SRC);
  const fetchFn = mockFetch([resp({ status: 204, etag: '"z"' })]);
  await serverSave({ fetchFn, parse, serialize, applyMove, model, etag: null, pendingMove: null });
  assert.equal(fetchFn.calls[0].headers["If-Match"], undefined, "no If-Match when no cached ETag");
});

test("serverSave throws on a non-2xx that isn't a retriable 409", async () => {
  const model = parse(SRC);
  const fetchFn = mockFetch([resp({ status: 500 })]);
  await assert.rejects(
    () => serverSave({ fetchFn, parse, serialize, applyMove, model, etag: '"e0"', pendingMove: { id: "T01", column: "Done" } }),
    /HTTP 500/,
  );
});

// A15 drift-guard: the modal's click-to-open must coexist with drag-and-drop.
// A drag synthesizes a trailing click, so the board sets a suppression flag on
// dragstart, clears it just after dragend, and gates the card's modal-opening
// click on it. This is DOM behavior (verified end-to-end in a browser), so here
// we guard the three wiring points against regression in the shipped board.html.
test("A15: board.html wires drag/click coexistence (suppress flag set on drag, gates modal click)", () => {
  // Isolate the renderCard region so we assert on the real card wiring.
  const s = HTML.indexOf("function renderCard(");
  const e = HTML.indexOf("function escapeHtml(");
  assert.ok(s !== -1 && e !== -1, "renderCard region present");
  const renderCard = HTML.slice(s, e);

  // dragstart raises the suppression flag; dragend lowers it (deferred to run
  // after the synthetic click), so a completed drag never pops the modal.
  assert.match(renderCard, /dragstart[\s\S]*?suppressNextClick\s*=\s*true/,
    "dragstart must set suppressNextClick");
  assert.match(renderCard, /dragend[\s\S]*?setTimeout\([\s\S]*?suppressNextClick\s*=\s*false/,
    "dragend must clear suppressNextClick after the synthetic click");

  // The card click opens the modal ONLY when a drag did not just end.
  assert.match(renderCard, /addEventListener\("click"[\s\S]*?if\s*\(\s*!suppressNextClick\s*\)\s*openModal\(card\)/,
    "card click must open the modal guarded by !suppressNextClick");

  // The drop handler still moves the card and persists the change to todo.md.
  assert.match(HTML, /"drop"[\s\S]*?applyMove\(model, id, col\)[\s\S]*?persist\(/,
    "drop must applyMove then persist");
});

// A16: a real board drag-save must be lossless for per-card context. The board
// serializes the whole model into the PUT body, so every card's context block
// (and note) must survive byte-for-byte, and the dragged card must keep its own
// context while landing in its new column.
const SRC_CTX = `<!-- todo-kanban v1 -->
<!-- columns: Todo, In Progress, Done -->

## Todo
- [ ] (T01) alpha !high #a
    | para one line 1
    | para one line 2
    |
    | para two after blank
- [ ] (T02) beta #b
    > a short note
    | ctx for beta
## In Progress
- [ ] (T03) gamma
## Done
`;

test("A16: drag-save PUT body preserves every card's context byte-for-byte", async () => {
  const model0 = parse(SRC_CTX); // reference model, pre-drag

  // Board optimistically moves T01 (Todo -> In Progress) then saves.
  const model = parse(SRC_CTX);
  applyMove(model, "T01", "In Progress");

  const fetchFn = mockFetch([resp({ status: 204, etag: '"n"' })]);
  await serverSave({
    fetchFn, parse, serialize, applyMove,
    model, etag: '"e0"', pendingMove: { id: "T01", column: "In Progress" },
  });

  assert.equal(fetchFn.calls.length, 1, "happy-path drag-save is a single PUT");
  const body = fetchFn.calls[0].body;
  const put = parse(body); // re-parse the exact bytes the board wrote

  // Every card's context and note round-trip unchanged through the save.
  for (const c0 of model0.cards) {
    const c = put.cards.find(x => x.id === c0.id);
    assert.ok(c, `card ${c0.id} survives the save`);
    assert.equal(c.context, c0.context, `context preserved for ${c0.id}`);
    assert.equal(c.note, c0.note, `note preserved for ${c0.id}`);
  }

  // The dragged card kept its multi-paragraph context AND moved columns.
  const t01 = put.cards.find(x => x.id === "T01");
  assert.equal(t01.column, "In Progress", "dragged card lands in its new column");
  assert.equal(t01.context, "para one line 1\npara one line 2\n\npara two after blank");

  // Byte-level: the serialized context lines (incl. the blank-paragraph sigil)
  // appear literally in the PUT body — the board did not collapse or drop them.
  assert.ok(body.includes("    | para two after blank"), "context line present verbatim");
  assert.ok(body.includes("\n    |\n"), "blank-paragraph separator line preserved");
  assert.ok(body.includes("    | ctx for beta"), "other card's context present verbatim");
});

test("A16: 409-retry drag-save re-serializes with all context blocks intact", async () => {
  // Board loaded SRC_CTX (etag e0) and optimistically moved T01 -> In Progress.
  const optimistic = parse(SRC_CTX);
  applyMove(optimistic, "T01", "In Progress");

  // Meanwhile the CLI added T04 (with its own multi-paragraph context) to Todo.
  const serverModel = parse(SRC_CTX);
  serverModel.cards.push({
    id: "T04", title: "delta", done: false, column: "Todo",
    priority: null, tags: [], note: null,
    context: "cli-added ctx\n\nsecond para",
  });
  const serverText = serialize(serverModel);

  const fetchFn = mockFetch([
    resp({ status: 409, etag: '"e1"' }),                   // stale If-Match
    resp({ status: 200, etag: '"e1"', text: serverText }), // refetch todo.md
    resp({ status: 204, etag: '"e2"' }),                   // retry PUT succeeds
  ]);

  await serverSave({
    fetchFn, parse, serialize, applyMove,
    model: optimistic, etag: '"e0"', pendingMove: { id: "T01", column: "In Progress" },
  });

  assert.equal(fetchFn.calls.length, 3, "PUT, refetch, retry PUT");
  const retryBody = fetchFn.calls[2].body;
  const put = parse(retryBody);

  // The concurrently-added card's context survived the merge.
  const t04 = put.cards.find(x => x.id === "T04");
  assert.ok(t04, "CLI-added T04 survives the retry");
  assert.equal(t04.context, "cli-added ctx\n\nsecond para");

  // The dragged card moved and kept its own context after the re-serialize.
  const t01 = put.cards.find(x => x.id === "T01");
  assert.equal(t01.column, "In Progress");
  assert.equal(t01.context, "para one line 1\npara one line 2\n\npara two after blank");

  // Every original card's context is still byte-identical after the merged save.
  const base = parse(SRC_CTX);
  for (const c0 of base.cards) {
    const c = put.cards.find(x => x.id === c0.id);
    assert.equal(c.context, c0.context, `context preserved for ${c0.id} through retry`);
  }
});
