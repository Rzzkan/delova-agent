"""CLI: shopee-agent <perintah>. Berguna untuk login pertama & operasi manual."""
from __future__ import annotations

import argparse
import json

from . import bulk, flash_sale, products, seo
from .client import ShopeeClient


def out(x) -> None:
    print(json.dumps(x, ensure_ascii=False, indent=2))


def main() -> None:
    p = argparse.ArgumentParser(prog="shopee-agent")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("auth-url", help="URL otorisasi toko (buka di browser)")
    a = sub.add_parser("auth-exchange", help="tukar code dari redirect jadi token")
    a.add_argument("code"); a.add_argument("--shop-id", type=int)
    sub.add_parser("refresh", help="paksa refresh access token")
    sub.add_parser("shop-info")
    l = sub.add_parser("list"); l.add_argument("--status", default="NORMAL"); l.add_argument("--limit", type=int, default=50)
    s = sub.add_parser("audit", help="audit SEO judul/deskripsi"); s.add_argument("--limit", type=int, default=200)
    e = sub.add_parser("export", help="ekspor produk ke CSV"); e.add_argument("path"); e.add_argument("--limit", type=int)
    i = sub.add_parser("import", help="terapkan perubahan dari CSV (default dry-run)")
    i.add_argument("path"); i.add_argument("--apply", action="store_true")
    r = sub.add_parser("rollback"); r.add_argument("backup_file")
    f = sub.add_parser("flash-slots"); f.add_argument("--days", type=int, default=7)
    sub.add_parser("flash-list")
    args = p.parse_args()

    c = ShopeeClient()
    if args.cmd == "auth-url":
        print(c.auth_url())
    elif args.cmd == "auth-exchange":
        out(c.exchange_code(args.code, args.shop_id))
    elif args.cmd == "refresh":
        c.refresh(); print("OK")
    elif args.cmd == "shop-info":
        out(c.get("/api/v2/shop/get_shop_info"))
    elif args.cmd == "list":
        out([products.slim(x) for x in products.fetch_products(c, args.status, args.limit)])
    elif args.cmd == "audit":
        audits = [seo.audit_item(products.slim(x)) for x in products.fetch_products(c, "NORMAL", args.limit)]
        out([a for a in audits if a["issues"]])
    elif args.cmd == "export":
        print(bulk.export_csv(products.fetch_products(c, "NORMAL", args.limit), args.path))
    elif args.cmd == "import":
        out(bulk.apply_changes(c, bulk.read_csv_changes(args.path), dry_run=not args.apply))
    elif args.cmd == "rollback":
        out(bulk.rollback(c, args.backup_file))
    elif args.cmd == "flash-slots":
        out(flash_sale.time_slots(c, args.days))
    elif args.cmd == "flash-list":
        out(flash_sale.list_sales(c))


if __name__ == "__main__":
    main()
