// todo-kanban — shared parse/serialize core.
// Single source of truth for the todo.md grammar. Imported by the slash-command
// layer (Node) and mirrored by board.html (browser). Zero dependencies.
//
// Model shape:
//   {
//     version: 1,
//     columns: ["Backlog", "Todo", "In Progress", "Blocked", "Done"],
//     cards: [
//       { id, title, done, column, priority, tags, note }
//     ]
//   }
// where priority ∈ "low"|"med"|"high"|null, tags is string[], note is string|null.
//
// Invariant: serialize(parse(text)) is canonical, and canonical text round-trips
// exactly. The command layer (not the parser) enforces the Done-column ⇔ checkbox
// coupling, so the core stays a pure, lossless data transform.

export const VERSION = 1;
export const DEFAULT_COLUMNS = ["Backlog", "Todo", "In Progress", "Blocked", "Done"];
export const PRIORITIES = ["low", "med", "high"];

const HEADER_RE = /^<!--\s*todo-kanban v(\d+)\s*-->$/;
const COLUMNS_RE = /^<!--\s*columns:\s*(.+?)\s*-->$/;
const HEADING_RE = /^##\s+(.+?)\s*$/;
const CARD_RE = /^-\s+\[([ xX])\]\s+\(([A-Za-z]+\d+)\)\s+(.*)$/;
const NOTE_RE = /^\s{2,}>\s?(.*)$/;
const PRIORITY_TOKEN_RE = /(?:^|\s)!(low|med|high)(?=\s|$)/g;
const TAG_TOKEN_RE = /(?:^|\s)#([\w-]+)(?=\s|$)/g;

/** Split a card's raw title tail into { title, priority, tags }. */
function extractMeta(raw) {
  let priority = null;
  const tags = [];

  // Pull the last priority token (a title shouldn't carry more than one).
  let m;
  PRIORITY_TOKEN_RE.lastIndex = 0;
  while ((m = PRIORITY_TOKEN_RE.exec(raw)) !== null) priority = m[1];

  TAG_TOKEN_RE.lastIndex = 0;
  while ((m = TAG_TOKEN_RE.exec(raw)) !== null) tags.push(m[1]);

  const title = raw
    .replace(PRIORITY_TOKEN_RE, " ")
    .replace(TAG_TOKEN_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { title, priority, tags };
}

/** Parse todo.md text into a model. Tolerant of missing header/columns. */
export function parse(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  let version = VERSION;
  let columns = null;
  const cards = [];
  let currentColumn = null;
  let lastCard = null;

  for (const line of lines) {
    let m;
    if ((m = line.match(HEADER_RE))) {
      version = Number(m[1]);
      continue;
    }
    if ((m = line.match(COLUMNS_RE))) {
      columns = m[1].split(",").map((c) => c.trim()).filter(Boolean);
      continue;
    }
    if ((m = line.match(HEADING_RE))) {
      currentColumn = m[1];
      lastCard = null;
      continue;
    }
    if ((m = line.match(CARD_RE))) {
      const done = m[1].toLowerCase() === "x";
      const meta = extractMeta(m[3]);
      const card = {
        id: m[2],
        title: meta.title,
        done,
        column: currentColumn,
        priority: meta.priority,
        tags: meta.tags,
        note: null,
      };
      cards.push(card);
      lastCard = card;
      continue;
    }
    if ((m = line.match(NOTE_RE)) && lastCard) {
      // Support multi-line notes by joining with "\n".
      lastCard.note = lastCard.note === null ? m[1] : lastCard.note + "\n" + m[1];
      continue;
    }
    // Blank or unrecognized line ends a card's note context but is otherwise ignored.
    if (line.trim() === "") lastCard = null;
  }

  if (!columns) columns = [...DEFAULT_COLUMNS];
  return { version, columns, cards };
}

/** Serialize one card line (without note). */
function serializeCard(card) {
  const box = card.done ? "x" : " ";
  let s = `- [${box}] (${card.id}) ${card.title}`;
  if (card.priority) s += ` !${card.priority}`;
  for (const tag of card.tags || []) s += ` #${tag}`;
  return s;
}

/** Serialize a model back into canonical todo.md text. */
export function serialize(model) {
  const columns = model.columns && model.columns.length ? model.columns : [...DEFAULT_COLUMNS];
  const out = [];
  out.push(`<!-- todo-kanban v${model.version || VERSION} -->`);
  out.push(`<!-- columns: ${columns.join(", ")} -->`);

  for (const column of columns) {
    out.push("");
    out.push(`## ${column}`);
    for (const card of model.cards.filter((c) => c.column === column)) {
      out.push(serializeCard(card));
      if (card.note !== null && card.note !== undefined) {
        for (const noteLine of String(card.note).split("\n")) {
          out.push(`    > ${noteLine}`);
        }
      }
    }
  }
  out.push("");
  return out.join("\n");
}

/** Next free ID (T01, T02, …) given existing cards. */
export function nextId(cards) {
  let max = 0;
  for (const c of cards) {
    const m = /^T(\d+)$/.exec(c.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return "T" + String(max + 1).padStart(2, "0");
}

/** Starter model for `todo init`. */
export function emptyModel(columns = DEFAULT_COLUMNS) {
  return { version: VERSION, columns: [...columns], cards: [] };
}
