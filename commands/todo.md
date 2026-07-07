---
description: Manage the project's kanban todo board (todo.md + board.html)
argument-hint: init | add "title" [!prio] [#tag] [--col Column] | move <ID> "Column" | done <ID> | list [--col C] [--tag t] [--prio p] | open
---

Run the todo-kanban CLI to operate on the project's `todo.md`, then report the result concisely.

Execute with the Bash tool from the current project root, passing the user's arguments through verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" $ARGUMENTS
```

Guidance:
- `todo.md` is the single source of truth; the CLI is the only thing that should edit it programmatically, so mutations stay consistent with the format the HTML board parses.
- Subcommands: `init`, `add`, `move`, `done`, `list`. Priority tokens are `!low|!med|!high`; tags are `#tag`; target a column with `--col "In Progress"`.
- If the arguments are `open` (not a CLI subcommand), do not run the CLI. Instead tell the user the board path is `.todo/board.html` and that they can open it in Chrome (double-click, or `open`/`xdg-open` it). Mention the first open asks once for folder access.
- If the CLI reports `todo.md not found`, offer to run `/todo init`.
- After a mutation, show the one-line result the CLI printed. Do not re-print the whole board unless the user ran `list`.
