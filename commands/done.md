---
description: Mark a card done (move it to the Done column)
argument-hint: <ID>
---

Mark a card done. Run from the project root, passing arguments verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" done $ARGUMENTS
```

Report the one-line result. If it says `todo.md not found`, offer to run `/todo:init`.
