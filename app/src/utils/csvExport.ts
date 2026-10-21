/** Keep user-authored text literal when a CSV is opened by spreadsheet software. */
export function spreadsheetSafeCell(value: string | number | null | undefined): string {
  const text = String(value ?? '');
  // Quotes alone do not prevent formula interpretation. Also cover prefixes
  // hidden behind whitespace and spreadsheet-recognized control characters.
  const safe = typeof value === 'string' && (/^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text))
    ? `'${text}` : text;
  return /[,"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function serializeClinicCsv(headers: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return '\uFEFF' + [headers.map(spreadsheetSafeCell).join(','), ...rows.map(row => row.map(spreadsheetSafeCell).join(','))].join('\r\n');
}
