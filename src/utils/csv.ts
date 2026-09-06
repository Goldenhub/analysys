/**
 * Minimal RFC-4180-style CSV serialization: quotes any cell containing a
 * comma, quote, or newline, and doubles embedded quotes.
 */
export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const escapeCell = (cell: string | number | null | undefined): string => {
    const value = cell === null || cell === undefined ? '' : String(cell);
    if (/[",\n\r]/.test(value)) {
      return `"${value.replaceAll('"', '""')}"`;
    }
    return value;
  };

  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}
