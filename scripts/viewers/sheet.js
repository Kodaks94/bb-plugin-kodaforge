import { read, utils } from "xlsx";
import { serve } from "./frame.js";

const PAGE_ROWS = 500;
const MAX_ROWS = 20_000;
const MAX_COLUMNS = 200;

const CSS = `
body { display: flex; flex-direction: column; font: 12px system-ui, sans-serif; }
#root { display: flex; flex: 1; min-height: 0; flex-direction: column; }
.grid { flex: 1; min-height: 0; overflow: auto; }
table { border-collapse: separate; border-spacing: 0; }
th, td { border: solid var(--border); border-width: 0 1px 1px 0; padding: 2px 6px; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: pre; vertical-align: top; }
th { position: sticky; background: var(--muted); color: var(--muted-foreground); font-weight: 400; z-index: 1; }
thead th { top: 0; } tbody th { left: 0; text-align: right; } thead th:first-child { left: 0; z-index: 2; }
td.n { text-align: right; }
nav { display: flex; gap: 2px; overflow-x: auto; border-top: 1px solid var(--border); background: var(--muted); padding: 3px; }
button { border: 0; border-radius: 4px; background: none; color: var(--muted-foreground); padding: 3px 10px; font: inherit; white-space: nowrap; cursor: pointer; }
button[aria-selected=true] { background: var(--background); color: var(--foreground); }
p { margin: 0; padding: 6px 10px; color: var(--muted-foreground); }`;

function element(tag, text, parent) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
}

function showSheet(sheet, grid) {
  grid.replaceChildren();
  if (!sheet || !sheet["!ref"]) return void element("p", "This sheet is empty.", grid);
  const range = utils.decode_range(sheet["!ref"]);
  const lastRow = Math.min(range.e.r, MAX_ROWS - 1);
  const lastColumn = Math.min(range.e.c, MAX_COLUMNS - 1);
  const spans = new Map();
  const covered = new Set();
  for (const merge of sheet["!merges"] ?? []) {
    const end = { r: Math.min(merge.e.r, lastRow, merge.s.r + 1000), c: Math.min(merge.e.c, lastColumn) };
    spans.set(`${merge.s.r}:${merge.s.c}`, [end.r - merge.s.r + 1, end.c - merge.s.c + 1]);
    for (let r = merge.s.r; r <= end.r; r++) for (let c = merge.s.c; c <= end.c; c++) if (r !== merge.s.r || c !== merge.s.c) covered.add(`${r}:${c}`);
  }
  const table = element("table", undefined, grid);
  const head = element("tr", undefined, element("thead", undefined, table));
  element("th", "", head);
  for (let c = 0; c <= lastColumn; c++) element("th", utils.encode_col(c), head);
  const body = element("tbody", undefined, table);
  let next = 0;
  const more = element("button", "Show more rows", grid);
  const add = () => {
    const stop = Math.min(next + PAGE_ROWS - 1, lastRow);
    for (; next <= stop; next++) {
      const row = element("tr", undefined, body);
      element("th", String(next + 1), row);
      for (let c = 0; c <= lastColumn; c++) {
        if (covered.has(`${next}:${c}`)) continue;
        const cell = (sheet["!data"]?.[next] ?? [])[c];
        const node = element("td", cell ? utils.format_cell(cell) : "", row);
        if (cell?.t === "n") node.className = "n";
        const span = spans.get(`${next}:${c}`);
        if (span) [node.rowSpan, node.colSpan] = span;
      }
    }
    more.hidden = next > lastRow;
  };
  more.onclick = add;
  add();
  if (range.e.r > lastRow || range.e.c > lastColumn) element("p", `Only the first ${lastRow + 1} rows and ${lastColumn + 1} columns are shown.`, grid);
}

serve((bytes, root) => {
  const book = read(bytes, { type: "array", dense: true, sheetRows: MAX_ROWS + 1 });
  element("style", CSS, document.head);
  root.replaceChildren();
  const grid = element("div", undefined, root);
  grid.className = "grid";
  const tabs = element("nav", undefined, root);
  const select = (name) => {
    for (const tab of tabs.children) tab.setAttribute("aria-selected", String(tab.textContent === name));
    showSheet(book.Sheets[name], grid);
  };
  for (const name of book.SheetNames) element("button", name, tabs).onclick = () => select(name);
  select(book.SheetNames[0]);
});
