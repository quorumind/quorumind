// CSV as issue trackers import it (RFC 4180): every field quoted, quotes doubled, line breaks kept inside
// quotes, CRLF between records. A field that starts like a formula (=, +, -, @, tab or carriage return) gets
// a leading apostrophe, so a spreadsheet opening the file never runs it (CSV injection); Linear's importer
// removes that apostrophe again.

const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV field, neutralised and quoted. */
export function csvField(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** A CSV document: a header row, then one row per record. */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return `${[header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}
