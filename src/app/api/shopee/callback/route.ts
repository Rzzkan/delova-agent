import { NextResponse } from "next/server";
import { oauthState, safeEqual } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { ShopeeClient } from "@/lib/shopee";

export const dynamic = "force-dynamic";

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${body}</p>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Redirect URL aplikasi Shopee. Menukar code menjadi token dan menyimpannya. */
export async function GET(req: Request) {
  const cfg = loadConfig();
  const q = new URL(req.url).searchParams;
  if (!cfg.mcpSecret || !safeEqual(q.get("state") ?? "", oauthState(cfg.mcpSecret))) {
    return page("Ditolak", "State tidak valid. Mulai ulang dari /api/shopee/connect.", 400);
  }
  const code = q.get("code");
  const shopId = Number(q.get("shop_id"));
  if (!code || !shopId) {
    return page(
      "Belum didukung",
      "Respons tidak berisi shop_id. Akun utama (main account) belum didukung; otorisasi per toko.",
      400,
    );
  }
  try {
    const rec = await new ShopeeClient(cfg).exchangeCode(code, shopId);
    return page(
      "Toko terhubung",
      `Toko <b>${esc(rec.shop_name ?? String(rec.shop_id))}</b> (ID ${rec.shop_id}) berhasil terhubung. Kembali ke Claude dan minta daftar produk.`,
    );
  } catch (e) {
    return page("Gagal", esc(e instanceof Error ? e.message : String(e)), 500);
  }
}
