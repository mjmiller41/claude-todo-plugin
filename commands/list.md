---
description: List the board in chat, optionally filtered
argument-hint: [--col C] [--tag t] [--prio low|med|high]
---

Print the board grouped by column. Run from the project root. Shell-quote every user-supplied value before substituting it: wrap each argument in single quotes and rewrite any embedded single quote as `'\''`, so spaces and shell metacharacters (`;`, `&`, `|`, `$`, backticks, quotes) are passed as literal text and never executed. For example, `--col "In Progress"` becomes `--col 'In Progress'`:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" list $ARGUMENTS
```

Show the CLI's output. If it says `todo.md not found`, offer to run `/todo:init`.
