---
description: Edit a card's title, priority, tags, note, context, or column
argument-hint: <ID> [--title "..."] [--prio low|med|high|none] [--tags "a,b"] [--note "..."] [--context "..."] [--col "Column"]
---

Edit an existing card in place. Run from the project root. Shell-quote every user-supplied value before substituting it: wrap each argument in single quotes and rewrite any embedded single quote as `'\''`, so spaces and shell metacharacters (`;`, `&`, `|`, `$`, backticks, quotes) are passed as literal text and never executed. For example, `--title "Ship it; now"` becomes `--title 'Ship it; now'`:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" edit $ARGUMENTS
```

Only the flags you pass change; everything else is left untouched. `--prio none` clears
the priority; `--tags "a,b"` replaces the tag set (`--tags ""` clears it); `--note none`
(or an empty note) clears the note; `--context none` (or an empty context) clears the
multi-line context; `--col "Done"` moves the card and syncs its checkbox.
Report the one-line result. If it says `todo.md not found`, offer to run `/todo:init`.
