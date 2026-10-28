// Minimal RFC 4180 CSV writer. Text that a spreadsheet would run as a formula (starting
// with = + - @, tab or carriage return) is prefixed with an apostrophe, so it is shown as text.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Rows (arrays of cells) to CSV text with CRLF line endings. */
export function toCsv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
