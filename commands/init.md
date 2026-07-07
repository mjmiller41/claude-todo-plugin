---
description: Initialize the kanban board (todo.md + .todo/board.html)
argument-hint: (no args)
---

Create the project's kanban board. Run with the Bash tool from the current project root:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" init
```

Then tell the user: the board is at `.todo/board.html` — open it in Chrome and click
**Open todo.md…** to pick the `todo.md` at the project root (Chrome asks once for access).
