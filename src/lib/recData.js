/* Loading a ratings table for the recommender labs.
 *
 * The course files are not tidy: movie_ratings_large.xlsx starts with an
 * empty row, the workbooks mark a missing rating with "#", and some files
 * carry a data-dictionary sheet. So: take the longest sheet, use the first
 * row with at least two filled cells as the header, and treat "#", "?", "-"
 * and blanks as "not rated". */

import { parseCSV } from "./parse.js";

export async function readTableFile(file) {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xlsm|xls)$/.test(name)) return fromSheets(await file.arrayBuffer(), file.name);
  return { name: file.name, ...parseCSV(await file.text()) };
}

export async function readDemo(fileName) {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${fileName}`);
  if (!res.ok) throw new Error(`could not load ${fileName}`);
  return { name: fileName, ...parseCSV(await res.text()) };
}

async function fromSheets(buf, name) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const sheets = wb.SheetNames.map((n) => ({ n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "", raw: true }) }));
  const best = sheets.reduce((b, s) => (s.rows.length > b.rows.length ? s : b), sheets[0]);
  const start = best.rows.findIndex((r) => r.filter((v) => String(v).trim() !== "").length >= 2);
  if (start < 0) return { name, headers: [], rows: [] };
  const headers = best.rows[start].map((h, i) => String(h).trim() || `column_${i + 1}`);
  const rows = best.rows.slice(start + 1)
    .filter((r) => r.some((v) => String(v).trim() !== ""))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  return { name, sheet: best.n, headers, rows };
}
