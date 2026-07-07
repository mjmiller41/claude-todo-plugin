# Implementation Plan — `todo-kanban` Claude Code Plugin

Project-level, offline, no-server kanban todo tracker. A single markdown file is the
source of truth; a self-contained HTML board gives drag-and-drop kanban in Chrome;
Claude Code slash commands mutate the same file. Two-way live sync, zero running processes.

## Decisions (locked)
- **Artifact:** dual — `todo.md` (source of truth) + `.todo/board.html` (generated viewer).
- **Persistence:** browser **File System Access API** + polling. No server, no per-instance RAM.
- **Columns:** configurable via a header comment in `todo.md`.
- **Card fields:** Title + stable ID, Priority, Tags, Notes.
- **Scope:** MVP — init, add, done/move, list, regenerate. Ship small.
- **Target:** Chromium desktop (Chrome/Edge). File System Access API is Chromium-only — acceptable.

## Architecture

```
project-root/
  todo.md              # single source of truth (Git-tracked, VS Code native)
  .todo/
    board.html         # self-contained kanban viewer (generated, git-ignored optional)
```

Data flow (no server):

```
        drag card / edit               poll lastModified (~1s)
  ┌────────────────────────┐      ┌──────────────────────────────┐
  │       board.html       │──────│           todo.md            │
  │  (Chrome, FS Access)   │─────▶│   (single source of truth)   │
  └────────────────────────┘ write└──────────────────────────────┘
                                            ▲
                                            │ edit via slash commands
                                   ┌──────────────────┐
                                   │   Claude Code    │
                                   └──────────────────┘
```

- Board opens → one-time folder-permission grant (handle cached in IndexedDB → one click on later opens).
- Board reads `todo.md`, renders cards into columns.
- User drags a card → board rewrites `todo.md` via the file handle.
- Claude edits `todo.md` (slash command) → board's poll sees new `lastModified` → re-reads → re-renders.

## `todo.md` format (the contract both sides parse)

```markdown
<!-- todo-kanban v1 -->
<!-- columns: Backlog, Todo, In Progress, Blocked, Done -->

## Backlog
- [ ] (T04) Add SHX font import !low #fonts
    > blocked on parser spec

## In Progress
- [ ] (T02) GRBL jog controls !high #cam #m3

## Done
- [x] (T01) Scaffold monorepo #infra
```

Grammar (kept dead-simple so both a regex parser and a human can read it):
- **Columns:** `<!-- columns: A, B, C -->`. Section headings `## <Column>` group cards. Extra columns render empty.
- **Card line:** `- [ ] (ID) Title !prio #tag #tag`
  - `[x]` = also implies Done column (checkbox and column stay consistent; Done column is the canonical "done").
  - `(ID)` — stable short id, auto-assigned on add (`T01`, `T02`…). Claude targets cards by ID.
  - `!low | !med | !high` — optional priority → colored dot + sort.
  - `#tag` — zero or more freeform tags → filter chips.
- **Note:** an indented `> ...` line directly under a card → shown on card expand.

Parser and serializer live in one shared JS module reused by the HTML board and validated by a Node test, so both directions round-trip losslessly (parse(serialize(x)) === x).

## Plugin surface (slash commands)

| Command | Action | Verify |
|---|---|---|
| `/todo init` | Create `todo.md` (with default columns) + `.todo/board.html` if absent. Idempotent. | Files exist; opening board renders empty columns. |
| `/todo add "<title>" [!prio] [#tags] [col]` | Append a card with next free ID to a column (default first non-Done). | New line in `todo.md`; card appears on board within ~1s. |
| `/todo move <ID> <column>` | Move card to a column; sync checkbox if moved to/from Done. | Card in new column; `todo.md` diff is one line moved. |
| `/todo done <ID>` | Shortcut for `move <ID> Done` + `[x]`. | Checkbox set, card in Done. |
| `/todo list [col\|#tag\|!prio]` | Print current board as text in chat (filtered). | Output matches `todo.md`. |
| `/todo open` | Print the file path / open instructions for `board.html`. | — |
| `/todo regen` | Rewrite `.todo/board.html` from the bundled template (after plugin update). | Board loads new version. |

All commands are markdown edits to `todo.md` (+ template copy). No card mutation logic lives only in the browser — parity is the invariant.

## `board.html` (MVP feature set)
- Self-contained: inline CSS + JS, no external requests (works offline).
- File System Access API: `showDirectoryPicker()` once; persist handle in IndexedDB; `queryPermission`/`requestPermission` on reopen.
- Columns from the `<!-- columns -->` header; cards rendered per column.
- **Drag-and-drop** between columns (HTML5 DnD or Pointer events) → on drop, update model → serialize → write `todo.md`.
- Card shows: ID, title, priority dot, tag chips; click to expand note.
- **Filter bar:** by tag and priority (client-side only, never mutates file).
- **Poll loop:** every ~1s compare `file.lastModified`; if newer and no local unsaved drag in flight, re-read + re-render. Guard against clobbering (last-writer check on the timestamp before writing).
- Light/dark via `prefers-color-scheme`.

## Plugin package layout

```
todo-kanban/
  .claude-plugin/plugin.json      # name, version, description
  commands/
    todo.md                       # slash-command spec / router (init,add,move,done,list,open,regen)
  templates/
    board.html                    # shipped viewer template, copied on init/regen
    todo.md                       # starter source-of-truth with default columns
  scripts/
    todo.mjs                      # shared parse/serialize + command impl (Node, no deps)
  test/
    roundtrip.test.mjs            # parse↔serialize invariants, ID assignment, move logic
  README.md
```

## Build order (each step independently verifiable) — MVP COMPLETE

- [x] 1. **Format + shared module** → `scripts/todo.mjs` parse/serialize. Verify: `roundtrip.test.mjs` green. *(10 tests)*
- [x] 2. **Slash commands** on top of the module: init, add, move, done, list. Verify: run each against a temp `todo.md`, assert diffs. *(`commands.mjs` + `cli.mjs`, 10 tests, temp-dir smoke test)*
- [x] 3. **board.html — read-only** render from `todo.md` (paste-in first, then FS Access). Verify: open in Chrome, columns/cards match file. *(parity test: board parser == `todo.mjs`)*
- [x] 4. **board.html — write** (drag persists via file handle). Verify: drag card, reload page, position persisted; `git diff todo.md` shows the move. *(serialize + applyMove parity-tested vs `commands.mjs`)*
- [x] 5. **board.html — poll/live-sync.** Verify: with board open, run `/todo move`; card jumps columns within ~1s without reload. *(demonstrated live on demo project)*
- [x] 6. **Package as plugin** (`plugin.json`, install locally). Verify: `/todo` commands available in a fresh project; `/todo init` scaffolds; end-to-end loop works. *(+ `marketplace.json`, README)*

Full suite: **23/23**. All steps merged to `main` (commits `5dfbcc6` → `66650e1`).

## MVP cut line (explicitly deferred)
- No due dates, no assignees, no archive, no per-card history.
- No configurable card colors/themes beyond light/dark.
- No multi-file / sub-project boards.
- No conflict-merge UI — timestamp last-writer check only (fine for solo use).

## Risks / notes
- **FS Access permission friction** — mitigated by caching the directory handle in IndexedDB (one click on reopen, not a re-pick).
- **Concurrent write race** (you drag while Claude writes) — rare in solo use; last-writer-by-timestamp check + re-read on conflict is sufficient for MVP. Flagged for revisit if it bites.
- **Non-Chromium browsers** — board degrades to read-only (paste `todo.md` contents) since FS Access is Chromium-only. Acceptable per target.
- **VS Code** edits `todo.md` directly as markdown; board picks changes up on next poll — no special integration needed.
