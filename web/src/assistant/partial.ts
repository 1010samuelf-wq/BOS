// Markdown that is still arriving is not yet valid markdown.
//
// Two half-written shapes render as visible junk, and they're the two the
// assistant is told to use most: a table whose delimiter row hasn't arrived
// shows as a line of raw pipes, and an unclosed `**` shows as asterisks. Both
// fix themselves a fraction of a second later, which is exactly what makes it
// look broken — text flickering into place rather than being written.
//
// So while a turn is streaming, render only the prefix that already renders
// cleanly and hold the rest back until it's whole.

/** A markdown table row: `| a | b |`, possibly indented. */
const TABLE_ROW = /^\s*\|/;
/** A `|---|:---:|` delimiter line, shape-wise. */
const TABLE_RULE = /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/;

/** Cells in a row, ignoring the empty strings the outer pipes produce. */
function cellCount(line: string): number {
  return line.trim().replace(/^\||\|$/g, "").split("|").length;
}

export function stablePrefix(text: string): string {
  if (!text) return text;
  const lines = text.split("\n");

  // A table header with no delimiter under it yet is just pipes. Drop the
  // trailing run of table lines until a delimiter arrives that really makes
  // them a table — GFM requires it to have the *same number of cells* as the
  // header, so a half-arrived `|---|` under a three-column header is not a
  // table yet, and rendering it anyway is what makes the columns jump.
  let start = lines.length;
  while (start > 0 && TABLE_ROW.test(lines[start - 1])) start--;
  const tail = lines.slice(start);
  const settled = tail.some(
    (line, i) => i > 0 && TABLE_RULE.test(line) && cellCount(line) === cellCount(tail[i - 1]),
  );
  if (tail.length > 0 && !settled) lines.length = start;

  let out = lines.join("\n");

  // An odd number of `**` means the last one is still open, so cut from it.
  // Counting pairs rather than matching: the opener can be many words back.
  const marks = out.split("**").length - 1;
  if (marks % 2 === 1) out = out.slice(0, out.lastIndexOf("**"));

  return out;
}
