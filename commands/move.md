---
description: Move a card to another column
argument-hint: <ID> "<Column>"
---

Move a card between columns. Run from the project root. Shell-quote every user-supplied value before substituting it: wrap each argument in single quotes and rewrite any embedded single quote as `'\''`, so spaces and shell metacharacters (`;`, `&`, `|`, `$`, backticks, quotes) are passed as literal text and never executed. For example, `T02 "In Progress"` becomes `'T02' 'In Progress'`:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" move $ARGUMENTS
```

Example: `T02 "In Progress"`. Moving to/from the Done column syncs the card's checkbox.
Report the one-line result. If it says `todo.md not found`, offer to run `/todo:init`.
