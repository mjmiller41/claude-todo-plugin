---
description: Move a card to another column
argument-hint: <ID> "<Column>"
---

Move a card between columns. Run from the project root, passing arguments verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" move $ARGUMENTS
```

Example: `T02 "In Progress"`. Moving to/from the Done column syncs the card's checkbox.
Report the one-line result. If it says `todo.md not found`, offer to run `/todo:init`.
