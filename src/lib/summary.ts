/** Ringkasan hitungan per toko untuk dashboard. Murni (tanpa dependensi server) agar bisa dipakai di klien dan dites. */

export interface HasPromoStatus {
  status: "upcoming" | "ongoing";
}
export interface HasEnd {
  end: number | null;
}

export function summarizePromos(entries: HasPromoStatus[]) {
  const ongoing = entries.filter((e) => e.status === "ongoing").length;
  const upcoming = entries.filter((e) => e.status === "upcoming").length;
  return { upcoming, ongoing, total: upcoming + ongoing };
}

/** Voucher yang berakhir dalam `withinDays` hari (default 3) dihitung "segera berakhir". */
export function summarizeVouchers(vouchers: HasEnd[], nowSec = Date.now() / 1000, withinDays = 3) {
  const expiring = vouchers.filter((v) => v.end !== null && v.end - nowSec < withinDays * 86400).length;
  return { active: vouchers.length, expiring };
}
