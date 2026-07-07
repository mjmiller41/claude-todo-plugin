---
description: List the board in chat, optionally filtered
argument-hint: [--col C] [--tag t] [--prio low|med|high]
---

Print the board grouped by column. Run from the project root, passing arguments verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" list $ARGUMENTS
```

Show the CLI's output. If it says `todo.md not found`, offer to run `/todo:init`.
