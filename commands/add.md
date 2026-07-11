---
description: Add a card to the kanban board
argument-hint: "title" [!low|!med|!high] [#tag ...] [--col "Column"]
---

Add a card to `todo.md`. Run from the project root. Shell-quote every user-supplied value before substituting it: wrap each argument in single quotes and rewrite any embedded single quote as `'\''`, so spaces and shell metacharacters (`;`, `&`, `|`, `$`, backticks, quotes) are passed as literal text and never executed. For example, a title of `Ship it; rm -rf /` becomes `'Ship it; rm -rf /'`:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" add $ARGUMENTS
```

Priority is `!low|!med|!high`; tags are `#tag`; target a column with `--col "In Progress"`
(default is the first non-Done column). Report the one-line result the CLI prints. If it
says `todo.md not found`, offer to run `/todo:init`.
