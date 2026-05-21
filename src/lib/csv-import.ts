import type { ImportRow } from "./jobs-import.functions";

// Minimal CSV parser handling quoted fields, escaped quotes, CRLF.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (ch === "\r") { /* skip */ }
      else cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Parse a date like "26/05/2026" + time "17:30" (date format dd/MM/yyyy,
// time HH:mm) → ISO string in local browser tz. If anything missing, null.
function parseDateTime(dateStr: string, timeStr: string, dateFmt: string): string | null {
  const d = (dateStr || "").trim();
  const t = (timeStr || "").trim();
  if (!d || !t) return null;
  let y = 0, mo = 0, da = 0;
  const fmt = (dateFmt || "dd/MM/yyyy").toLowerCase();
  const parts = d.split(/[\/\-\.]/);
  if (parts.length !== 3) return null;
  if (fmt.startsWith("dd")) { da = +parts[0]; mo = +parts[1]; y = +parts[2]; }
  else if (fmt.startsWith("mm")) { mo = +parts[0]; da = +parts[1]; y = +parts[2]; }
  else { y = +parts[0]; mo = +parts[1]; da = +parts[2]; }
  const [hh, mm] = t.split(":").map((x) => +x);
  if (!y || !mo || !da || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const dt = new Date(y, mo - 1, da, hh, mm, 0);
  return dt.toISOString();
}

export function csvToImportRows(text: string): ImportRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);

  const loadCol = idx("Load #");
  const laneCol = idx("Lane");
  const equipCol = idx("Equipment Type");
  const dateFmtCol = idx("Date Format");

  const arrDateCols: number[] = [];
  const arrTimeCols: number[] = [];
  for (let i = 1; i <= 20; i++) {
    arrDateCols.push(idx(`Scheduled Truck Arrival - ${i} date`));
    arrTimeCols.push(idx(`Scheduled Truck Arrival - ${i} time`));
  }

  const out: ImportRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const reference = (row[loadCol] || "").trim();
    const lane = (row[laneCol] || "").trim();
    if (!reference || !lane) continue;
    const equip = equipCol >= 0 ? (row[equipCol] || "").trim() || null : null;
    const dateFmt = dateFmtCol >= 0 ? (row[dateFmtCol] || "").trim() : "dd/MM/yyyy";

    const stopCount = lane.split("->").filter((s) => s.trim()).length;
    const stopScheduledAt: (string | null)[] = [];
    for (let i = 0; i < stopCount; i++) {
      const dc = arrDateCols[i];
      const tc = arrTimeCols[i];
      const dv = dc >= 0 ? row[dc] : "";
      const tv = tc >= 0 ? row[tc] : "";
      stopScheduledAt.push(parseDateTime(dv || "", tv || "", dateFmt));
    }
    out.push({ reference, lane, equipmentType: equip, stopScheduledAt });
  }
  return out;
}
