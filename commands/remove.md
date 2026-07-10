---
description: Remove a card from the board
argument-hint: <ID>
---

Delete a card. Run from the project root, passing arguments verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" remove $ARGUMENTS
```

Removing a card does not reuse its ID — the board keeps a monotonic counter so
later cards always get fresh IDs. Report the one-line result. If it says
`todo.md not found`, offer to run `/todo:init`.
