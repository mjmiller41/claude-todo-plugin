# todo-kanban

A project-level kanban todo tracker for Claude Code. One `todo.md` is the single
source of truth; a self-contained HTML board gives you drag-and-drop kanban in
Chrome; `/todo` slash commands let Claude move cards for you.

## Why this design

- **`todo.md` is the source of truth** — Git-friendly, diffs cleanly, editable in
  VS Code as plain markdown.
- **The board reads and writes that same file.** `/todo:open` registers the project
  with a shared `localhost`-only daemon so the board loads `todo.md` automatically (no
  clicks) and saves drag-and-drop edits back to disk. Opened directly as a `file://`
  page it instead uses the browser's File System Access API (one click to grant access).
- **One daemon serves every project**, on a single port, namespaced per project under
  `/b/<id>/`. Opening a second or third project reuses the same daemon instead of
  spawning a new server per window — visit `http://127.0.0.1:4321/` for an index of them.
- **Updates are pushed, not polled.** The daemon watches `todo.md` and streams a
  Server-Sent Event when it changes, so when Claude edits it (via `/todo`) your open
  board re-renders live — two-way sync with no busy polling loop.

```
        drag / edit              GET/PUT (server) or FS API (file://)
  ┌────────────────────┐      ┌──────────────────────────────┐
  │   todo-board.html  │──────│           todo.md            │
  │      (Chrome)      │─────▶│   (single source of truth)   │
  └────────────────────┘ write└──────────────────────────────┘
                                          ▲
                                          │ /todo add|move|done
                                 ┌──────────────────┐
                                 │   Claude Code    │
                                 └──────────────────┘
```

## Install

This is a local Claude Code plugin. Point Claude Code at the plugin directory
(via your plugin config / marketplace), then in any project:

```
/todo:init
```

That creates `todo.md` and `todo-board.html` at the project root.

> Claude Code namespaces plugin commands as `plugin:command`. This plugin is
> named `todo` and each subcommand is its own command, so you invoke them as
> `/todo:init`, `/todo:add`, etc.

Then open the board:

```
/todo:open
```

That ensures the shared board daemon is running (starting it in the background the first
time) and prints this project's URL (default `http://127.0.0.1:4321/b/<id>/todo-board.html`).
Open it in Chrome — the board loads `todo.md` automatically with no clicks, hot-reloads over
Server-Sent Events, and writes the file when you drag a card. Opening other projects reuses
the same daemon and port; pass `--port <N>` to use a different one.

> **Without the server:** you can also double-click `todo-board.html` to open it as a
> `file://` page. Then click **Open todo.md…** once to grant access (File System
> Access API, Chromium-only); non-Chromium browsers get read-only paste mode.

## Commands

| Command | What it does |
|---|---|
| `/todo:init` | Scaffold `todo.md` + `todo-board.html`. Idempotent. |
| `/todo:add "Title" [!prio] [#tag …] [--col "Column"]` | Add a card (auto-assigned ID). |
| `/todo:move <ID> "Column"` | Move a card; syncs its done state to the Done column. |
| `/todo:done <ID>` | Shortcut for moving a card to Done. |
| `/todo:edit <ID> [--title …] [--prio low\|med\|high\|none] [--tags "a,b"] [--note …] [--col "Column"]` | Edit a card in place; only the flags you pass change. |
| `/todo:remove <ID>` | Delete a card (IDs are never reused). |
| `/todo:list [--col C] [--tag t] [--prio p]` | Print the board (filtered) in chat. |
| `/todo:open [--port N]` | Register the project with the shared board daemon (starting it if needed) and print its URL. |

Priority is `!low`, `!med`, or `!high`; tags are `#tag`.

## `todo.md` format

```markdown
<!-- todo-kanban v1 -->
<!-- columns: Backlog, Todo, In Progress, Blocked, Done -->

## In Progress
- [ ] (T02) GRBL jog controls !high #cam #m3
    > repro: jog past soft limit

## Done
- [x] (T01) Scaffold monorepo #infra
```

- **Columns** are configurable in the `<!-- columns: … -->` line.
- An optional `<!-- next: N -->` line holds a monotonic id counter, so deleting a
  card never causes a later card to reuse its ID. It's added automatically on the
  first `/todo:add`; hand-editing it is unnecessary.
- **Card:** `- [ ] (ID) Title !priority #tag`, with an optional indented `> note`.
- The **Done** column is the canonical "done" state; the checkbox mirrors it.

> **Concurrent edits:** writes are atomic (staged to a temp file, then renamed),
> so `todo.md` is never left half-written. But the CLI and a drag on an open board
> don't lock against each other — if Claude runs `/todo:add` at the same instant
> you drop a card, it's last-writer-wins. Harmless in normal solo use; just don't
> expect a merge.

Both the CLI and the board use the same parser/serializer, so hand-edits, Claude's
edits, and drag-writes all round-trip losslessly.

## Version control tips

- **Commit `todo.md`** — it's your backlog.
- **`todo-board.html`** is regenerated by `/todo:init`; commit it for teammates,
  or add `todo-board.html` to `.gitignore` if you'd rather keep it local.

## How it stays consistent

`scripts/todo.mjs` (parse/serialize) and `scripts/commands.mjs` (mutations) are the
Node source of truth. `templates/board.html` inlines a mirrored copy of the same
core. `test/board-parity.test.mjs` imports that inlined copy and asserts it parses,
serializes, and moves cards identically to the Node modules — so the two can't drift.

```
npm test   # node --test — round-trip, command, and board-parity suites
```

## Layout

```
.claude-plugin/plugin.json   plugin manifest (name: todo)
commands/*.md                one file per subcommand (init, add, move, done, edit, remove, list, open)
scripts/todo.mjs             parse/serialize core (shared contract)
scripts/commands.mjs         pure model mutations (Done-coupling lives here)
scripts/cli.mjs              file-I/O CLI the command invokes
templates/todo.md            starter board
templates/board.html         the kanban viewer (copied on init)
test/                        node:test suites
```
