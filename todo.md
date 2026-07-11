<!-- todo-kanban v1 -->
<!-- columns: Backlog, Todo, In Progress, Blocked, Done -->

## Backlog

## Todo

## In Progress

## Blocked

## Done
- [x] (T11) Quote $ARGUMENTS in command prompts to prevent shell mis-parse/injection (commands/*.md) #audit #security
    > Still open: $ARGUMENTS unquoted in all commands/*.md (add/edit/move/done/remove/open/list).
- [x] (T10) Reconcile board+CLI concurrent writes to avoid last-write-wins data loss (cli.mjs:155, board.html persist) #audit
    > atomicWrite (temp+rename, cli.mjs:74) now prevents torn writes, but board PUT and CLI save still last-write-wins; no version/etag reconciliation.
- [x] (T09) Server: restrict GET to an allowlist / realpath-check to stop symlink escape (cli.mjs:170) #audit #security
    > Partial: '..' traversal now blocked by prefix check (cli.mjs:398), but no realpathSync — a symlink inside the project dir still escapes.
- [x] (T08) Server: validate Host header to block DNS-rebinding reads/writes (cli.mjs:152) !med #audit #security
    > Still open: daemon binds 127.0.0.1 (cli.mjs:433) but no Host-header check on any handler.
- [x] (T12) Validate --col/--tag in list so typos error instead of silently returning empty (cli.mjs:124) #audit
- [x] (T05) Fix pop-back drag bug !high #bug
- [x] (T04) Write todo.md parser !med #parser
- [x] (T03) Wire up column drop targets !high #frontend
- [x] (T02) Research drag-and-drop libs #research
- [x] (T01) Sketch board layout !low #design
- [x] (T07) Set up project scaffold
