"use client";

import { useCallback, useEffect, useState } from "react";
import { summarizeVouchers } from "@/lib/summary";
import type { VouchersOverview } from "@/lib/vouchers";
import Shell, { useShell } from "../Shell";
import { BTN, BTN_DEFAULT, Badge, Card, Empty, Note, PageTitle, fmt, fmtTime, rp } from "../ui";

const selectCls = "h-10 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-700 outline-none focus:border-brand-300 focus:ring-4 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300";

export default function VoucherClient() {
  return (
    <Shell active="voucher">
      <Page />
    </Shell>
  );
}

function Page() {
  const { unauthorized } = useShell();
  const [data, setData] = useState<VouchersOverview | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [shop, setShop] = useState("all");

  const load = useCallback(
    async (refresh = false) => {
      setBusy(true);
      try {
        const r = await fetch(`/api/dashboard/vouchers${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
        if (r.status === 401) return unauthorized();
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setData(j);
        setErr("");
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [unauthorized],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const shops = (data?.shops ?? []).filter((p) => shop === "all" || p.shop_id === shop);

  return (
    <>
      <PageTitle
        title="Voucher aktif"
        sub={`Voucher Shopee yang sedang berlaku${data ? ` · dicek ${fmtTime(data.generated_at)}` : ""} · voucher TikTok Shop belum didukung`}
        action={<button disabled={busy} className={`${BTN} ${BTN_DEFAULT}`} onClick={() => load(true)}>{busy ? "Memuat…" : "Muat ulang"}</button>}
      />
      <div className="-mt-1">
        <select className={selectCls} value={shop} onChange={(e) => setShop(e.target.value)} aria-label="Pilih toko">
          <option value="all">Semua toko</option>
          {data?.shops.map((p) => <option key={p.shop_id} value={p.shop_id}>{p.shop_name ?? p.shop_id}</option>)}
        </select>
      </div>
      {err && <Note tone="warn">Gagal memuat voucher: {err}</Note>}
      {!data && !err && <Card><Empty>Memuat voucher…</Empty></Card>}
      {data && data.shops.length === 0 && <Card><Empty>Belum ada toko Shopee terhubung.</Empty></Card>}
      {shops.map((p) => {
        const c = summarizeVouchers(p.vouchers);
        return (
          <section key={p.shop_id} className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-gray-900 dark:text-white">{p.shop_name ?? "Toko tanpa nama"}</h3>
                <span className="font-mono text-xs text-gray-500 dark:text-gray-400">Shopee · ID {p.shop_id}</span>
              </div>
              <span className="flex-1" />
              {p.error ? <Badge tone="bad">Gagal dimuat</Badge> : <><Badge tone="ok">{c.active}{p.truncated ? "+" : ""} aktif</Badge>{c.expiring > 0 && <Badge tone="warn">{c.expiring} segera berakhir</Badge>}</>}
            </div>
            {p.error ? (
              <p className="break-words px-5 py-4 text-sm text-error-600">{p.error}</p>
            ) : p.vouchers.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">Tidak ada voucher aktif.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-white/5 dark:text-gray-400">
                    <tr>
                      <th className="px-5 py-3 font-medium">Voucher</th>
                      <th className="px-5 py-3 font-medium">Kode</th>
                      <th className="px-5 py-3 font-medium">Jenis</th>
                      <th className="px-5 py-3 font-medium">Diskon</th>
                      <th className="px-5 py-3 text-right font-medium">Min. belanja</th>
                      <th className="px-5 py-3 font-medium">Pemakaian</th>
                      <th className="px-5 py-3 font-medium">Berakhir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {p.vouchers.map((v) => {
                      const soon = v.end !== null && v.end * 1000 - Date.now() < 3 * 86400000;
                      const reward = v.amount === null ? "-" : v.reward === "persen" ? `${v.amount}%` : v.reward === "koin" ? `${v.amount} koin` : rp(v.amount);
                      const pct = v.quota ? Math.min(100, Math.round(((v.used ?? 0) / v.quota) * 100)) : null;
                      return (
                        <tr key={v.id}>
                          <td className="px-5 py-3"><div className="font-medium text-gray-800 dark:text-gray-200">{v.name ?? `Voucher ${v.id}`}</div><div className="font-mono text-xs text-gray-400">ID {v.id}</div></td>
                          <td className="px-5 py-3 font-mono text-xs">{v.code ?? "-"}</td>
                          <td className="px-5 py-3">{v.scope ?? "-"}</td>
                          <td className="px-5 py-3">{reward}</td>
                          <td className="px-5 py-3 text-right tabular-nums">{v.min_spend ? rp(v.min_spend) : "-"}</td>
                          <td className="px-5 py-3">
                            {pct === null ? "-" : (
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"><i className="block h-full bg-brand-500" style={{ width: `${pct}%` }} /></div>
                                <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">{v.used ?? 0}/{v.quota}</span>
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3">{v.end ? fmt(v.end * 1000) : "-"} {soon && <Badge tone="warn">Segera</Badge>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
