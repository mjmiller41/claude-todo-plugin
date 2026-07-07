---
description: Show how to open the kanban board in Chrome
argument-hint: (no args)
---

Do NOT run the CLI. Tell the user:

- The board is at `.todo/board.html` in the project root.
- Open it in Chrome (double-click, or `open`/`xdg-open` it), then click **Open todo.md…**
  and pick the project-root `todo.md`. Chrome asks once for folder access; after that it
  reopens with one click and stays in sync with the file.

If `.todo/board.html` does not exist yet, offer to run `/todo:init`.
