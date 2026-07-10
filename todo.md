<!-- todo-kanban v1 -->
<!-- columns: Backlog, Todo, In Progress, Blocked, Done -->

## Backlog
- [ ] (T01) Sketch board layout !low #design
- [ ] (T02) Research drag-and-drop libs #research
- [ ] (T08) Server: validate Host header to block DNS-rebinding reads/writes (cli.mjs:152) !med #audit #security
- [ ] (T09) Server: restrict GET to an allowlist / realpath-check to stop symlink escape (cli.mjs:170) #audit #security
- [ ] (T10) Reconcile board+CLI concurrent writes to avoid last-write-wins data loss (cli.mjs:155, board.html persist) #audit
- [ ] (T11) Quote $ARGUMENTS in command prompts to prevent shell mis-parse/injection (commands/*.md) #audit #security
- [ ] (T12) Validate --col/--tag in list so typos error instead of silently returning empty (cli.mjs:124) #audit

## Todo
- [ ] (T03) Wire up column drop targets !high #frontend
- [ ] (T04) Write todo.md parser !med #parser
- [ ] (T05) Fix pop-back drag bug !high #bug

## In Progress

## Blocked
- [ ] (T06) Waiting on design review !med #blocked

## Done
- [x] (T07) Set up project scaffold
