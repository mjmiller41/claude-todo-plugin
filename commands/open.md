---
description: Start the board server and open the kanban board in Chrome
argument-hint: [--port N]
---

Register this project with the shared board daemon and print its URL. Run from the project
root, passing arguments verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" open $ARGUMENTS
```

`open` starts the daemon in the background the first time it's needed (a single `127.0.0.1`
daemon on one port, shared by every project) and returns right away — no need for the `!`
prefix and nothing long-running in this session. Each project is served under its own
`/b/<id>/` path, so opening several projects reuses the same port instead of spawning a new
server per window.

Report the printed URL (default `http://127.0.0.1:4321/b/<id>/todo-board.html`) and tell the
user to open it in Chrome. The board loads `todo.md` automatically and hot-reloads over
Server-Sent Events when the file changes; dragging a card writes `todo.md` back. Visiting
`http://127.0.0.1:4321/` lists every registered board. Use `--port <N>` to pick a different
port.

If `todo-board.html` or `todo.md` does not exist yet, offer to run `/todo:init`.
