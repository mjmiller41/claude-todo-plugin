---
description: Remove a card from the board
argument-hint: <ID>
---

Delete a card. Run from the project root. Shell-quote every user-supplied value before substituting it: wrap each argument in single quotes and rewrite any embedded single quote as `'\''`, so spaces and shell metacharacters (`;`, `&`, `|`, `$`, backticks, quotes) are passed as literal text and never executed. For example, an ID of `T01` becomes `'T01'`:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" remove $ARGUMENTS
```

Removing a card does not reuse its ID — the board keeps a monotonic counter so
later cards always get fresh IDs. Report the one-line result. If it says
`todo.md not found`, offer to run `/todo:init`.
