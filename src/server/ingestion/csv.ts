/** Minimal RFC 4180 CSV reader: quoted fields, doubled quotes, CRLF, a leading BOM, blank lines skipped. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let sawAny = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== "" || sawAny) if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    sawAny = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") {
      quoted = true;
      sawAny = true;
    } else if (c === ",") {
      endField();
      sawAny = true;
    } else if (c === "\n") endRow();
    else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else field += c;
  }
  if (quoted) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
