import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get, request } from "node:http";
import { connect } from "node:net";
import { createDaemon } from "../scripts/cli.mjs";

// Send a fully hand-rolled request over a raw socket so we can omit the Host
// header entirely (node's http client always sends one). HTTP/1.0 makes Host
// optional, so a Host-less request reaches the handler instead of a parser 400.
function rawLine(port, requestText) {
  return new Promise((resolve, reject) => {
    const sock = connect(port, "127.0.0.1", () => sock.write(requestText));
    let buf = "";
    sock.on("data", (c) => (buf += c));
    sock.on("end", () => resolve(Number(buf.split(" ")[1])));
    sock.on("error", reject);
  });
}

// Raw HTTP request that lets us set an arbitrary Host header (node:fetch forbids
// overriding Host). Connects to loopback; `host` overrides only the Host header.
function raw(port, { method = "GET", path = "/", host, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    // Send exactly `host` (including "") when provided; let node add the
    // default Host when it is undefined.
    if (host !== undefined) headers.Host = host;
    if (body !== undefined) headers["Content-Length"] = Buffer.byteLength(body);
    const req = request({ hostname: "127.0.0.1", port, method, path, headers, setHost: host === undefined }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// Spin the daemon up on an ephemeral port with a throwaway registry file, so
// these tests never touch the real shared registry. Returns { base, close }.
async function startDaemon() {
  const root = mkdtempSync(join(tmpdir(), "todo-daemon-"));
  const registryFile = join(root, "registry.json");
  const { server, close } = createDaemon({ registryFile });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  return { root, base, port, close };
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

// ---- F1: Host-header validation (DNS-rebinding guard) ----

test("A1: non-local Host on GET /health is 403 and body lacks 'ok'", async () => {
  const d = await startDaemon();
  try {
    for (const host of ["evil.example", "evil.example:4321"]) {
      const res = await raw(d.port, { path: "/health", host });
      assert.equal(res.status, 403, `Host: ${host}`);
      assert.doesNotMatch(res.body, /ok/, `Host: ${host} body`);
    }
  } finally {
    await d.close();
  }
});

test("A2: local Host values serve /, /health, /b/<id>/todo.md as before", async () => {
  const d = await startDaemon();
  try {
    const a = makeProject(d.root, "zeta");
    const id = await register(d.base, a);
    const locals = ["127.0.0.1", "127.0.0.1:4321", "localhost", "localhost:4321", "[::1]", "[::1]:4321"];
    for (const host of locals) {
      const health = await raw(d.port, { path: "/health", host });
      assert.equal(health.status, 200, `health Host: ${host}`);
      assert.equal(health.body, "ok", `health body Host: ${host}`);

      const index = await raw(d.port, { path: "/", host });
      assert.equal(index.status, 200, `index Host: ${host}`);
      assert.match(index.body, /todo-kanban boards/, `index body Host: ${host}`);

      const todo = await raw(d.port, { path: `/b/${id}/todo.md`, host });
      assert.equal(todo.status, 200, `todo Host: ${host}`);
      assert.match(todo.body, /zeta task/, `todo body Host: ${host}`);
    }
  } finally {
    await d.close();
  }
});

test("A3: PUT /b/<id>/todo.md with non-local Host is 403, file unchanged", async () => {
  const d = await startDaemon();
  try {
    const a = makeProject(d.root, "eta");
    const id = await register(d.base, a);
    const before = readFileSync(join(a, "todo.md"), "utf8");
    const res = await raw(d.port, {
      method: "PUT",
      path: `/b/${id}/todo.md`,
      host: "evil.example",
      body: "## Todo\n- [ ] (T01) injected\n",
    });
    assert.equal(res.status, 403);
    assert.equal(readFileSync(join(a, "todo.md"), "utf8"), before);
  } finally {
    await d.close();
  }
});

test("A4: POST /register with non-local Host is 403, no new registry entry", async () => {
  const d = await startDaemon();
  try {
    const a = makeProject(d.root, "theta");
    const regFile = join(d.root, "registry.json");
    const before = existsSync(regFile) ? readFileSync(regFile, "utf8") : null;
    const res = await raw(d.port, { method: "POST", path: "/register", host: "evil.example", body: a });
    assert.equal(res.status, 403);
    const after = existsSync(regFile) ? readFileSync(regFile, "utf8") : null;
    assert.equal(after, before, "registry file must not gain an entry");
  } finally {
    await d.close();
  }
});

test("A5: missing or empty Host header is 403 (fails closed)", async () => {
  const d = await startDaemon();
  try {
    // Truly absent Host (HTTP/1.0, no Host line) reaches the handler as undefined.
    const missing = await rawLine(d.port, "GET /health HTTP/1.0\r\nConnection: close\r\n\r\n");
    assert.equal(missing, 403);
    // Present-but-empty Host value.
    const empty = await raw(d.port, { path: "/health", host: "" });
    assert.equal(empty.status, 403);
  } finally {
    await d.close();
  }
});
