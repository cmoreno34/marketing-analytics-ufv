/* File parsing. Everything happens in the page — no upload, no server.
 *
 * Delimiter sniffing matters more than it sounds: the three datasets used in
 * this module are semicolon-, comma- and tab-separated respectively, and a
 * tool that only handles commas fails on two of the three. */

const DELIMITERS = [",", ";", "\t", "|"];

export function sniffDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 8);
  if (!lines.length) return ",";
  let best = ",";
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const first = counts[0];
    // A real delimiter yields the same field count on every line, and more
    // than one field. Consistency is the signal; raw frequency is not.
    const consistent = counts.every((c) => c === first) && first > 1;
    const score = consistent ? first * 10 : first;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/* RFC 4180 quoting: quoted fields may contain the delimiter and doubled
 * quotes are literal quotes. */
function splitLine(line, delim) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseCSV(text, delimiter) {
  // Strip the UTF-8 BOM — cities.csv has one, and without this the first
  // header comes back as "﻿City_n" and never matches anything.
  const clean = text.replace(/^﻿/, "");
  const delim = delimiter || sniffDelimiter(clean);
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { headers: [], rows: [], delimiter: delim };

  const headers = splitLine(lines[0], delim).map((h, i) => h.trim() || `column_${i + 1}`);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const row = {};
    headers.forEach((h, j) => { row[h] = (cells[j] ?? "").trim(); });
    rows.push(row);
  }
  return { headers, rows, delimiter: delim };
}

export async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm")) {
    // SheetJS is ~400 kB and most course data is CSV. Load it only when an
    // actual spreadsheet arrives.
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    const headers = json.length ? Object.keys(json[0]) : [];
    return { headers, rows: json, delimiter: "xlsx", sheetNames: wb.SheetNames };
  }
  const text = await file.text();
  return parseCSV(text);
}

export function toCSV(rows, headers) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = headers.map(esc).join(",");
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(",")).join("\n");
  return `${head}\n${body}`;
}

export function download(filename, content, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([`﻿${content}`], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
