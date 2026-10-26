/** Hitungan kalender (zona WIB, minggu mulai Senin). Murni, tanpa dependensi server. */

const WIB = 7 * 3600;
const MAX_SPAN_DAYS = 62;

/** "YYYY-MM-DD" dalam WIB untuk epoch detik. */
export const dayKey = (sec: number): string => new Date((sec + WIB) * 1000).toISOString().slice(0, 10);

const keyToUtcMs = (k: string) => Date.parse(`${k}T00:00:00Z`);
const msToKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Semua tanggal (WIB) yang disentuh rentang [start, end]. End tepat tengah malam tidak menambah hari berikutnya. */
export function daysCovered(start: number | null, end: number | null): string[] {
  if (start === null) return [];
  const first = dayKey(start);
  const last = end !== null && end > start ? dayKey(end - 1) : first;
  const out: string[] = [];
  for (let ms = keyToUtcMs(first), stop = keyToUtcMs(last), i = 0; ms <= stop && i < MAX_SPAN_DAYS; ms += 86400000, i++) out.push(msToKey(ms));
  return out;
}

export interface Ranged {
  start: number | null;
  end: number | null;
}

/** Petakan tanggal -> daftar jadwal yang menutupi tanggal itu. */
export function scheduleByDay<T extends Ranged>(entries: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const e of entries) for (const k of daysCovered(e.start, e.end)) (m.get(k) ?? m.set(k, []).get(k)!).push(e);
  return m;
}

export interface Cell {
  key: string;
  day: number;
  inMonth: boolean;
}

/** Sel kalender sebulan penuh (kelipatan 7), `month` 0-11. Senin = kolom pertama. */
export function monthCells(year: number, month: number): Cell[] {
  const first = Date.UTC(year, month, 1);
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const daysIn = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const total = Math.ceil((lead + daysIn) / 7) * 7;
  return Array.from({ length: total }, (_, i) => {
    const ms = first + (i - lead) * 86400000;
    const d = new Date(ms);
    return { key: msToKey(ms), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month };
  });
}

/** Dari hari ini ke depan dalam bulan itu: berapa hari sudah terjadwal vs belum. Hari lampau tidak dihitung. */
export function monthStats(map: Map<string, unknown[]>, year: number, month: number, todayKey: string) {
  let scheduled = 0;
  let free = 0;
  for (const c of monthCells(year, month)) {
    if (!c.inMonth || c.key < todayKey) continue;
    if (map.has(c.key)) scheduled++;
    else free++;
  }
  return { scheduled, free };
}
