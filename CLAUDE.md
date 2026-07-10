# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code **plugin** (manifest name: `todo`) that gives any project a kanban
todo tracker. One `todo.md` file at the project root is the single source of
truth; a self-contained `todo-board.html` provides a drag-and-drop board in
Chrome; `/todo:*` slash commands let Claude mutate the board. Zero runtime
dependencies — everything is Node's stdlib plus vanilla browser JS.

## Commands

```
npm test                              # node --test — the whole suite (roundtrip, commands, board-parity)
node --test test/roundtrip.test.mjs   # run one suite
node scripts/cli.mjs <sub> …          # exercise the CLI directly (init|add|move|done|edit|remove|list|serve)
```

There is no build step, no lint, no transpile. `.mjs` files run as-is.

## Architecture

Two layers share **one grammar**, and the whole design exists to keep them from drifting:

- `scripts/todo.mjs` — the parse/serialize core. Defines the `todo.md` grammar
  and the model shape (`{ version, columns, cards[] }`, each card
  `{ id, title, done, column, priority, tags, note }`). A pure, lossless data
  transform: `serialize(parse(text))` is canonical and round-trips exactly. **It
  does not enforce any business rules** — notably not the Done coupling.
- `scripts/commands.mjs` — pure model mutations (`addCard`, `moveCard`,
  `doneCardById`, `editCard`, `removeCard`, `listCards`). This is where the
  **Done-column ⇔ checkbox invariant** lives: a card is `done` iff its column is
  `Done`. Keep this rule here, not in the parser. `addCard` also owns id minting:
  it advances the model's `next` counter so a removed id is never reused.
- `scripts/cli.mjs` — the only layer that touches the filesystem. A thin I/O
  shell that loads/saves `todo.md` and dispatches subcommands. Also hosts the
  `serve` command: a localhost-only HTTP server (GET board + `todo.md`, PUT
  `todo.md`) that lets the board auto-load and save without a file picker.
- `templates/board.html` — the browser board. It **inlines a mirrored copy** of
  the core (parse/serialize + an `applyMove` that mirrors `moveCard`) between the
  markers `// ==================== todo-core` and `// ================== end todo-core`.

### The drift guard (critical)

`test/board-parity.test.mjs` extracts the inlined `todo-core` block from
`board.html`, imports it as a live module, and asserts it parses, serializes, and
moves cards **identically** to `scripts/todo.mjs` / `scripts/commands.mjs`.

**If you change the grammar, the model shape, or the Done coupling, you must edit
BOTH `scripts/*.mjs` AND the inlined block in `templates/board.html`, or
`board-parity` fails.** The two copies are intentional (the board must be a
single self-contained file with no imports); the test is what keeps them honest.

### Board ⇄ file sync

The board runs in one of three modes (`board.html`): `server` (talks to
`cli.mjs serve` over `fetch`), `fs` (File System Access API, Chromium-only,
one-click grant when opened as `file://`), or `paste` (read-only fallback). It
polls `todo.md` ~1s so Claude's edits appear live, and uses a write-sequence
guard so a poll landing mid-save doesn't clobber a drag. Two-way sync, no
persistent daemon — the server runs only while a board is open.

## The `todo.md` format

```markdown
<!-- todo-kanban v1 -->
<!-- columns: Backlog, Todo, In Progress, Blocked, Done -->

## In Progress
- [ ] (T02) GRBL jog controls !high #cam #m3
    > optional indented note

## Done
- [x] (T01) Scaffold monorepo #infra
```

- Columns come from the `<!-- columns: … -->` line (falls back to `DEFAULT_COLUMNS`).
- An optional `<!-- next: N -->` line carries the monotonic id counter. Absent on a
  legacy/hand-written file (parse omits the `next` key, so `serialize∘parse` stays an
  identity); `addCard` seeds and thereafter persists it. **If you touch this line's
  grammar, mirror it in `board.html`'s inlined core too** — the board must preserve it
  through a drag-save, and `board-parity` enforces the match.
- Card line: `- [ ] (ID) Title !priority #tag`. Priority ∈ `low|med|high`; IDs are `T01`, `T02`, … minted via the `next` counter (`addCard`), seeded from `nextId` in `todo.mjs`.
- `Done` is the canonical done column; the checkbox mirrors it.

## Plugin wiring

- `.claude-plugin/plugin.json` — manifest (`name: todo`). Bump `version` here on release.
- `.claude-plugin/marketplace.json` — marketplace entry pointing at `./`.
- `commands/*.md` — one file per subcommand; each is a prompt that tells Claude to
  run `node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" <sub> …`. Because the plugin is
  named `todo` with one command per subcommand, users invoke them as `/todo:init`,
  `/todo:add`, etc. `/todo:open` deliberately tells the user to run `serve`
  themselves (via a `!`-prefixed prompt) so the server outlives the session.

Note: `package.json` name (`todo-kanban`) and `plugin.json` name (`todo`) differ —
the plugin manifest name is the authoritative one for command namespacing.
