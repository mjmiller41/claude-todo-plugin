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
