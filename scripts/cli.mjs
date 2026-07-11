#!/usr/bin/env node
// todo-kanban — CLI. Thin I/O shell around commands.mjs; the only layer that
// touches the filesystem. Invoked by the /todo slash command.
//
// Usage:
//   node cli.mjs init [--file todo.md]
//   node cli.mjs add "Title text" [!high] [#tag ...] [--col "In Progress"]
//   node cli.mjs move <ID> "<Column>"
//   node cli.mjs done <ID>
//   node cli.mjs edit <ID> [--title "..."] [--prio low|med|high|none] [--tags "a,b"] [--note "..."] [--col "<Column>"]
//   node cli.mjs remove <ID>            # (alias: rm)
//   node cli.mjs list [--col X] [--tag y] [--prio high]
//   node cli.mjs serve [--port 4321]   # localhost board server (zero-click auto-load)

import { readFileSync, writeFileSync, existsSync, copyFileSync, watch, realpathSync, renameSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, serialize, emptyModel, PRIORITIES } from "./todo.mjs";
import { addCard, moveCard, doneCardById, listCards, editCard, removeCard } from "./commands.mjs";

const SELF = fileURLToPath(import.meta.url);
const HERE = dirname(SELF);
const PLUGIN_ROOT = resolve(HERE, "..");

function fail(msg) {
  console.error("error: " + msg);
  process.exit(1);
}

/** Split argv into { positionals, flags } where flags are --key value pairs. */
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      flags[a.slice(2)] = argv[++i];
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

/** From add's trailing tokens, pull !priority and #tags; the rest joins the title. */
function extractAddMeta(tokens) {
  let priority = null;
  const tags = [];
  const titleParts = [];
  for (const t of tokens) {
    if (/^!(low|med|high)$/.test(t)) priority = t.slice(1);
    else if (/^#[\w-]+$/.test(t)) tags.push(t.slice(1));
    else titleParts.push(t);
  }
  return { title: titleParts.join(" "), priority, tags };
}

function fileArg(flags) {
  return resolve(process.cwd(), flags.file || "todo.md");
}

function load(file) {
  if (!existsSync(file)) fail(`${file} not found — run \`/todo init\` first`);
  return parse(readFileSync(file, "utf8"));
}

/** Write `data` to `file` atomically: stage to a sibling temp file, then rename.
 *  rename(2) is atomic within a filesystem, so a crash or a full disk mid-write
 *  can never leave a truncated `todo.md` — the source of truth is all-or-nothing. */
function atomicWrite(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, file);
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best-effort cleanup */ }
    throw e;
  }
}

function save(file, model) {
  atomicWrite(file, serialize(model));
}

function printCard(c) {
  const box = c.done ? "x" : " ";
  const prio = c.priority ? ` !${c.priority}` : "";
  const tags = c.tags.length ? " " + c.tags.map((t) => "#" + t).join(" ") : "";
  return `  [${box}] (${c.id}) ${c.title}${prio}${tags}  «${c.column}»`;
}

function cmdInit(flags) {
  const file = fileArg(flags);
  if (existsSync(file)) {
    console.log(`${file} already exists — leaving it untouched`);
  } else {
    const tpl = join(PLUGIN_ROOT, "templates", "todo.md");
    if (existsSync(tpl)) copyFileSync(tpl, file);
    else save(file, emptyModel());
    console.log(`created ${file}`);
  }
  // Write the board viewer next to todo.md, named so it sorts beside it.
  // The project's folder name is injected into <title>, so re-running init on an
  // existing board just refreshes the title (and picks up template changes) while
  // the todo.md above is left untouched.
  const boardTpl = join(PLUGIN_ROOT, "templates", "board.html");
  if (existsSync(boardTpl)) {
    const dest = join(dirname(file), "todo-board.html");
    const projectName = basename(dirname(file));
    const html = withTitle(readFileSync(boardTpl, "utf8"), projectName);
    const existed = existsSync(dest);
    writeFileSync(dest, html);
    console.log(`${existed ? "updated" : "created"} ${dest} (title: ${projectName})`);
  }
}

/** Minimal HTML-text escape for values interpolated into markup. */
function escapeHtmlText(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

/** Inject the project name into the board's <title>, HTML-escaping it. */
function withTitle(html, name) {
  return html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtmlText(name)} · todo-kanban</title>`);
}

function cmdAdd(positionals, flags) {
  const file = fileArg(flags);
  const model = load(file);
  const { title, priority, tags } = extractAddMeta(positionals);
  const { card } = addCard(model, { title, priority, tags, column: flags.col ?? null });
  save(file, model);
  console.log("added:\n" + printCard(card));
}

function cmdMove(positionals, flags) {
  const file = fileArg(flags);
  const [id, column] = positionals;
  if (!id || !column) fail('usage: move <ID> "<Column>"');
  const model = load(file);
  const { card } = moveCard(model, id, column);
  save(file, model);
  console.log("moved:\n" + printCard(card));
}

function cmdDone(positionals, flags) {
  const file = fileArg(flags);
  const id = positionals[0];
  if (!id) fail("usage: done <ID>");
  const model = load(file);
  const { card } = doneCardById(model, id);
  save(file, model);
  console.log("done:\n" + printCard(card));
}

function cmdEdit(positionals, flags) {
  const file = fileArg(flags);
  const id = positionals[0];
  if (!id) {
    fail('usage: edit <ID> [--title "..."] [--prio low|med|high|none] [--tags "a,b"] [--note "..."] [--col "Column"]');
  }
  const model = load(file);
  const patch = {};
  if (flags.title !== undefined) patch.title = flags.title;
  if (flags.prio !== undefined) patch.priority = flags.prio === "none" ? null : flags.prio;
  if (flags.tags !== undefined) {
    patch.tags = flags.tags.split(",").map((t) => t.trim()).filter(Boolean);
  }
  if (flags.note !== undefined) patch.note = flags.note === "none" || flags.note === "" ? null : flags.note;
  if (flags.col !== undefined) patch.column = flags.col;
  if (Object.keys(patch).length === 0) {
    fail("nothing to change — pass at least one of --title, --prio, --tags, --note, --col");
  }
  const { card } = editCard(model, id, patch);
  save(file, model);
  console.log("edited:\n" + printCard(card));
}

function cmdRemove(positionals, flags) {
  const file = fileArg(flags);
  const id = positionals[0];
  if (!id) fail("usage: remove <ID>");
  const model = load(file);
  const card = removeCard(model, id);
  save(file, model);
  console.log("removed:\n" + printCard(card));
}

/** Distinct tags actually present on cards, in first-seen order. */
function boardTags(model) {
  const seen = [];
  for (const c of model.cards) {
    for (const t of c.tags) if (!seen.includes(t)) seen.push(t);
  }
  return seen;
}

function cmdList(flags) {
  const file = fileArg(flags);
  const model = load(file);
  if (flags.prio && !PRIORITIES.includes(flags.prio)) fail(`invalid --prio ${flags.prio}`);
  // Validate filters up front so a typo errors (non-zero, on stderr) instead of
  // silently returning an empty board. Column matching is exact/case-sensitive,
  // consistent with move/edit's assertColumn.
  if (flags.col !== undefined && !model.columns.includes(flags.col)) {
    fail(`unknown --col "${flags.col}" (valid columns: ${model.columns.join(", ")})`);
  }
  if (flags.tag !== undefined) {
    const tags = boardTags(model);
    if (!tags.includes(flags.tag)) {
      fail(`unknown --tag "${flags.tag}" (tags on board: ${tags.length ? tags.join(", ") : "(none)"})`);
    }
  }
  const cards = listCards(model, { column: flags.col, tag: flags.tag, priority: flags.prio });
  if (!cards.length) {
    console.log("(no matching cards)");
    return;
  }
  // Group by column for a board-like readout.
  for (const col of model.columns) {
    const inCol = cards.filter((c) => c.column === col);
    if (!inCol.length) continue;
    console.log(`\n${col}`);
    for (const c of inCol) console.log(printCard(c));
  }
}

// ---- Shared board daemon ----------------------------------------------------
// A single localhost daemon serves every project's board on one fixed port,
// namespaced by a per-project id: GET/PUT /b/<id>/todo.md, GET /b/<id>/todo-board.html,
// and a push-based GET /b/<id>/events (SSE) that fires whenever todo.md changes.
// A registry maps id -> absolute project dir; it's persisted so a restarted
// daemon recovers open boards. The board fetches todo.md with relative URLs, so
// namespacing needs no board changes.

const DEFAULT_PORT = 4321;
// Ephemeral by design: lives in the OS temp dir, so a reboot clears it. That's
// fine — `/todo:open` re-registers the project (and re-derives the same id from
// its path), so open boards self-heal on the next open.
const REGISTRY_FILE = join(tmpdir(), "todo-kanban-registry.json");

/** Stable short id for a project directory. */
function projectId(dir) {
  return createHash("sha1").update(resolve(dir)).digest("hex").slice(0, 8);
}

function loadRegistry(registryFile) {
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(registryFile, "utf8"))));
  } catch {
    return new Map();
  }
}

function saveRegistry(reg, registryFile) {
  try {
    writeFileSync(registryFile, JSON.stringify(Object.fromEntries(reg)));
  } catch {
    /* registry persistence is best-effort */
  }
}

/** Register (or refresh) a project dir in the registry; returns its id. */
function registerDir(reg, dir, registryFile) {
  const abs = resolve(dir);
  const id = projectId(abs);
  if (reg.get(id) !== abs) {
    reg.set(id, abs);
    saveRegistry(reg, registryFile);
  }
  return id;
}

function indexPage(reg) {
  const rows = [...reg.entries()]
    .filter(([, dir]) => existsSync(join(dir, "todo-board.html")))
    .map(
      ([id, dir]) =>
        `<li><a href="/b/${id}/todo-board.html">${escapeHtmlText(basename(dir))}</a> <code>${escapeHtmlText(dir)}</code></li>`
    )
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>todo boards</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:40px auto;max-width:720px;padding:0 16px}
li{margin:8px 0}code{color:#888;font-size:12px}</style>
<h1>todo-kanban boards</h1><ul>${rows || "<li>(no boards registered yet)</li>"}</ul>`;
}

// Build the daemon's http server (not yet listening). Exported so tests can
// drive it on an ephemeral port with a throwaway registry file.
export function createDaemon({ port = DEFAULT_PORT, registryFile = REGISTRY_FILE, selfFile = null } = {}) {
  const reg = loadRegistry(registryFile);
  const sse = new Map(); // id -> Set<res>
  const watchers = new Map(); // id -> fs watcher

  // Self-register the project the daemon was launched in (if it has a board).
  const selfId = selfFile && existsSync(selfFile) ? registerDir(reg, dirname(selfFile), registryFile) : null;

  function notify(id) {
    for (const res of sse.get(id) ?? []) res.write("data: change\n\n");
  }

  // Watch a project's directory (not the file — survives editors' atomic
  // save-via-rename) and push a debounced change event to its SSE clients.
  function ensureWatcher(id, dir) {
    if (watchers.has(id)) return;
    let timer = null;
    try {
      const w = watch(dir, (_evt, name) => {
        if (name && name !== "todo.md") return;
        clearTimeout(timer);
        timer = setTimeout(() => notify(id), 75);
      });
      watchers.set(id, w);
    } catch {
      /* fs.watch unsupported here; boards fall back to focus/visibility refetch */
    }
  }

  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const { method } = req;

    // Liveness probe for the `open` launcher.
    if (method === "GET" && url === "/health") {
      return void res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    }

    // Register a project dir; returns its id so `open` can print the URL.
    if (method === "POST" && url === "/register") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const dir = body.trim();
        if (!dir || !existsSync(dir)) return void res.writeHead(400).end("bad dir");
        const id = registerDir(reg, dir, registryFile);
        ensureWatcher(id, resolve(dir));
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id }));
      });
      return;
    }

    // Index of all registered boards.
    if (method === "GET" && url === "/") {
      return void res
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end(indexPage(reg));
    }

    // Everything else is /b/<id>/...
    const m = url.match(/^\/b\/([0-9a-f]{8})(\/.*)?$/);
    if (!m) return void res.writeHead(404).end("not found");
    const id = m[1];
    const rest = m[2] || "/";
    const dir = reg.get(id);
    if (!dir || !existsSync(dir)) return void res.writeHead(404).end("unknown project");

    // SSE hot-reload stream.
    if (method === "GET" && rest === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("retry: 2000\n\n");
      if (!sse.has(id)) sse.set(id, new Set());
      sse.get(id).add(res);
      ensureWatcher(id, dir);
      req.on("close", () => sse.get(id)?.delete(res));
      return;
    }

    const todoFile = join(dir, "todo.md");

    // Drag-to-save.
    if (method === "PUT" && rest === "/todo.md") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          atomicWrite(todoFile, body);
          res.writeHead(204).end();
        } catch (e) {
          res.writeHead(500).end(e.message);
        }
      });
      return;
    }
    if (method !== "GET") return void res.writeHead(405).end();

    // Serve a file from within the project dir (board defaults for "/").
    const relPath = rest === "/" ? "/todo-board.html" : rest;
    const target = relPath === "/todo.md" ? todoFile : join(dir, relPath.replace(/^\/+/, ""));
    const resolved = resolve(target);
    if (resolved !== resolve(dir) && !resolved.startsWith(resolve(dir) + "/")) {
      return void res.writeHead(403).end();
    }
    if (!existsSync(resolved)) return void res.writeHead(404).end("not found");
    const ext = extname(resolved);
    const type =
      ext === ".html" ? "text/html; charset=utf-8"
      : ext === ".md" ? "text/markdown; charset=utf-8"
      : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(readFileSync(resolved));
  });

  // Full teardown: stop the server, drop lingering SSE sockets, and release the
  // fs.watch handles (which would otherwise keep the event loop alive).
  function close() {
    return new Promise((r) => {
      for (const w of watchers.values()) w.close();
      watchers.clear();
      for (const set of sse.values()) for (const res of set) res.end();
      server.closeAllConnections?.();
      server.close(r);
    });
  }

  return { server, reg, selfId, close };
}

function cmdServe(flags) {
  const port = Number(flags.port) || DEFAULT_PORT;
  const { server, reg, selfId } = createDaemon({ port, selfFile: fileArg(flags) });
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") fail(`port ${port} is in use — a daemon may already be running`);
    fail(e.message);
  });
  server.listen(port, "127.0.0.1", () => {
    if (selfId) console.log(`todo board: http://127.0.0.1:${port}/b/${selfId}/todo-board.html`);
    console.log(`board daemon on 127.0.0.1:${port} — ${reg.size} project(s). Ctrl-C to stop.`);
  });
}

// ---- `open`: ensure the shared daemon is up, register this project, print URL.
async function health(base) {
  try {
    const res = await fetch(base + "/health");
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(base, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await health(base)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function spawnDaemon(port, cwd) {
  const child = spawn(process.execPath, [SELF, "serve", "--port", String(port)], {
    cwd,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function cmdOpen(flags) {
  const file = fileArg(flags);
  if (!existsSync(file)) fail(`${file} not found — run \`/todo:init\` first`);
  const dir = resolve(dirname(file));
  const port = Number(flags.port) || DEFAULT_PORT;
  const base = `http://127.0.0.1:${port}`;

  if (!(await health(base))) {
    spawnDaemon(port, dir); // detached singleton — outlives this session
    if (!(await waitForHealth(base, 3000))) fail("board daemon did not come up in time");
  }

  const res = await fetch(base + "/register", { method: "POST", body: dir });
  if (!res.ok) fail(`register failed: HTTP ${res.status}`);
  const { id } = await res.json();
  console.log(`todo board: ${base}/b/${id}/todo-board.html`);
  console.log(`shared daemon on ${base} — ${base}/ lists every registered board.`);
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseArgs(rest);
  try {
    switch (sub) {
      case "init": return cmdInit(flags);
      case "add": return cmdAdd(positionals, flags);
      case "move": return cmdMove(positionals, flags);
      case "done": return cmdDone(positionals, flags);
      case "edit": return cmdEdit(positionals, flags);
      case "remove": case "rm": return cmdRemove(positionals, flags);
      case "list": return cmdList(flags);
      case "open": return await cmdOpen(flags);
      case "serve": return cmdServe(flags);
      default:
        fail(`unknown command: ${sub ?? "(none)"} — use init|add|move|done|edit|remove|list|open|serve`);
    }
  } catch (e) {
    fail(e.message);
  }
}

// Only run the CLI when executed directly — importing this module (e.g. from
// tests to reach createDaemon) must not trigger main(). Compare real paths so
// invocation via a symlinked path (SELF is realpath'd; argv[1] is not) still runs.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(SELF);
  } catch {
    return false;
  }
}
if (invokedDirectly()) main();
