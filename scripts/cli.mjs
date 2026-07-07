#!/usr/bin/env node
// todo-kanban — CLI. Thin I/O shell around commands.mjs; the only layer that
// touches the filesystem. Invoked by the /todo slash command.
//
// Usage:
//   node cli.mjs init [--file todo.md]
//   node cli.mjs add "Title text" [!high] [#tag ...] [--col "In Progress"]
//   node cli.mjs move <ID> "<Column>"
//   node cli.mjs done <ID>
//   node cli.mjs list [--col X] [--tag y] [--prio high]

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, serialize, emptyModel, PRIORITIES } from "./todo.mjs";
import { addCard, moveCard, doneCardById, listCards } from "./commands.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, "..");

function fail(msg) {
  console.error("error: " + msg);
  process.exit(1);
}

/** Split argv into { positionals, flags } where flags are --key value pairs. */
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      flags[a.slice(2)] = argv[++i];
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

/** From add's trailing tokens, pull !priority and #tags; the rest joins the title. */
function extractAddMeta(tokens) {
  let priority = null;
  const tags = [];
  const titleParts = [];
  for (const t of tokens) {
    if (/^!(low|med|high)$/.test(t)) priority = t.slice(1);
    else if (/^#[\w-]+$/.test(t)) tags.push(t.slice(1));
    else titleParts.push(t);
  }
  return { title: titleParts.join(" "), priority, tags };
}

function fileArg(flags) {
  return resolve(process.cwd(), flags.file || "todo.md");
}

function load(file) {
  if (!existsSync(file)) fail(`${file} not found — run \`/todo init\` first`);
  return parse(readFileSync(file, "utf8"));
}

function save(file, model) {
  writeFileSync(file, serialize(model));
}

function printCard(c) {
  const box = c.done ? "x" : " ";
  const prio = c.priority ? ` !${c.priority}` : "";
  const tags = c.tags.length ? " " + c.tags.map((t) => "#" + t).join(" ") : "";
  return `  [${box}] (${c.id}) ${c.title}${prio}${tags}  «${c.column}»`;
}

function cmdInit(flags) {
  const file = fileArg(flags);
  if (existsSync(file)) {
    console.log(`${file} already exists — leaving it untouched`);
  } else {
    const tpl = join(PLUGIN_ROOT, "templates", "todo.md");
    if (existsSync(tpl)) copyFileSync(tpl, file);
    else save(file, emptyModel());
    console.log(`created ${file}`);
  }
  // Copy the board viewer if the template exists (lands in Step 3).
  const boardTpl = join(PLUGIN_ROOT, "templates", "board.html");
  if (existsSync(boardTpl)) {
    const dir = join(dirname(file), ".todo");
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, "board.html");
    copyFileSync(boardTpl, dest);
    console.log(`created ${dest}`);
  }
}

function cmdAdd(positionals, flags) {
  const file = fileArg(flags);
  const model = load(file);
  const { title, priority, tags } = extractAddMeta(positionals);
  const { card } = addCard(model, { title, priority, tags, column: flags.col ?? null });
  save(file, model);
  console.log("added:\n" + printCard(card));
}

function cmdMove(positionals, flags) {
  const file = fileArg(flags);
  const [id, column] = positionals;
  if (!id || !column) fail('usage: move <ID> "<Column>"');
  const model = load(file);
  const { card } = moveCard(model, id, column);
  save(file, model);
  console.log("moved:\n" + printCard(card));
}

function cmdDone(positionals, flags) {
  const file = fileArg(flags);
  const id = positionals[0];
  if (!id) fail("usage: done <ID>");
  const model = load(file);
  const { card } = doneCardById(model, id);
  save(file, model);
  console.log("done:\n" + printCard(card));
}

function cmdList(flags) {
  const file = fileArg(flags);
  const model = load(file);
  if (flags.prio && !PRIORITIES.includes(flags.prio)) fail(`invalid --prio ${flags.prio}`);
  const cards = listCards(model, { column: flags.col, tag: flags.tag, priority: flags.prio });
  if (!cards.length) {
    console.log("(no matching cards)");
    return;
  }
  // Group by column for a board-like readout.
  for (const col of model.columns) {
    const inCol = cards.filter((c) => c.column === col);
    if (!inCol.length) continue;
    console.log(`\n${col}`);
    for (const c of inCol) console.log(printCard(c));
  }
}

function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseArgs(rest);
  try {
    switch (sub) {
      case "init": return cmdInit(flags);
      case "add": return cmdAdd(positionals, flags);
      case "move": return cmdMove(positionals, flags);
      case "done": return cmdDone(positionals, flags);
      case "list": return cmdList(flags);
      default:
        fail(`unknown command: ${sub ?? "(none)"} — use init|add|move|done|list`);
    }
  } catch (e) {
    fail(e.message);
  }
}

main();
