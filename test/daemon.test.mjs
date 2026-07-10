import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:http";
import { createDaemon } from "../scripts/cli.mjs";

// Spin the daemon up on an ephemeral port with a throwaway registry file, so
// these tests never touch the real shared registry. Returns { base, close }.
async function startDaemon() {
  const root = mkdtempSync(join(tmpdir(), "todo-daemon-"));
  const registryFile = join(root, "registry.json");
  const { server, close } = createDaemon({ registryFile });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { root, base, close };
}

function makeProject(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "todo.md"), `## Todo\n- [ ] (T01) ${name} task\n`);
  writeFileSync(join(dir, "todo-board.html"), `<title>${name} · todo-kanban</title>`);
  return dir;
}

async function register(base, dir) {
  const res = await fetch(base + "/register", { method: "POST", body: dir });
  assert.equal(res.ok, true, "register should succeed");
  return (await res.json()).id;
}

test("health check responds", async () => {
  const d = await startDaemon();
  try {
    const res = await fetch(d.base + "/health");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok");
  } finally {
    await d.close();
  }
});

test("register namespaces two projects on one daemon and keeps them isolated", async () => {
  const d = await startDaemon();
  try {
    const a = makeProject(d.root, "alpha");
    const b = makeProject(d.root, "beta");
    const idA = await register(d.base, a);
    const idB = await register(d.base, b);
    assert.notEqual(idA, idB);

    const todoA = await (await fetch(`${d.base}/b/${idA}/todo.md`)).text();
    const todoB = await (await fetch(`${d.base}/b/${idB}/todo.md`)).text();
    assert.match(todoA, /alpha task/);
    assert.match(todoB, /beta task/);
    assert.doesNotMatch(todoB, /alpha task/);

    // Board is served (default "/" resolves to todo-board.html) with its title.
    const board = await (await fetch(`${d.base}/b/${idA}/`)).text();
    assert.match(board, /alpha · todo-kanban/);

    // Index lists both.
    const index = await (await fetch(`${d.base}/`)).text();
    assert.match(index, /alpha/);
    assert.match(index, /beta/);
  } finally {
    await d.close();
  }
});

test("re-registering the same dir is idempotent (stable id)", async () => {
  const d = await startDaemon();
  try {
    const a = makeProject(d.root, "gamma");
    assert.equal(await register(d.base, a), await register(d.base, a));
  } finally {
    await d.close();
  }
});

test("PUT writes todo.md back and unknown ids 404", async () => {
  const d = await startDaemon();
  try {
    const a = makeProject(d.root, "delta");
    const id = await register(d.base, a);
    const body = "## Todo\n- [ ] (T01) dragged\n";
    const put = await fetch(`${d.base}/b/${id}/todo.md`, { method: "PUT", body });
    assert.equal(put.status, 204);
    assert.equal(readFileSync(join(a, "todo.md"), "utf8"), body);

    const bad = await fetch(`${d.base}/b/00000000/todo.md`);
    assert.equal(bad.status, 404);
  } finally {
    await d.close();
  }
});

test("SSE stream emits a change event when todo.md is written", async () => {
  const d = await startDaemon();
  try {
    const a = makeProject(d.root, "epsilon");
    const id = await register(d.base, a);

    // Open the SSE stream with the raw http client and collect chunks.
    let sseReq;
    let timer;
    const got = new Promise((resolve, reject) => {
      sseReq = get(`${d.base}/b/${id}/events`, (res) => {
        let buf = "";
        res.on("data", (c) => {
          buf += c;
          if (buf.includes("data: change")) {
            clearTimeout(timer);
            resolve(true);
          }
        });
      });
      sseReq.on("error", reject);
      timer = setTimeout(() => reject(new Error("no SSE change event within 3s")), 3000);
    });

    // Give the stream a moment to connect and the watcher to attach, then edit.
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(join(a, "todo.md"), "## Todo\n- [ ] (T01) external edit\n");
    assert.equal(await got, true);
    sseReq.destroy();
  } finally {
    await d.close();
  }
});
