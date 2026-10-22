"""MCP server: membuat Claude bisa mengelola toko Shopee.

Jalankan:  python -m shopee_agent.mcp_server   (transport stdio)
Semua operasi tulis default dry_run=True; Claude harus eksplisit dry_run=False setelah disetujui user.
"""
from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from . import bulk, flash_sale, products, seo
from .client import ShopeeClient, ShopeeError

mcp = FastMCP("shopee-agent")
_client: ShopeeClient | None = None


def client() -> ShopeeClient:
    global _client
    if _client is None:
        _client = ShopeeClient()
    return _client


def _safe(fn):
    def wrap(*a, **k):
        try:
            return fn(*a, **k)
        except (ShopeeError, PermissionError, RuntimeError) as e:
            return {"error": str(e)}
    wrap.__name__, wrap.__doc__ = fn.__name__, fn.__doc__
    return wrap


def tool(fn):
    return mcp.tool()(_safe(fn))


@tool
def shop_info() -> dict[str, Any]:
    """Info toko yang sedang terhubung (nama, status, region)."""
    return client().get("/api/v2/shop/get_shop_info")


@tool
def list_products(status: str = "NORMAL", limit: int = 50, name_contains: str = "") -> list[dict[str, Any]]:
    """Daftar produk (id, nama, deskripsi). status: NORMAL/UNLIST/BANNED/REVIEWING."""
    items = [products.slim(i) for i in products.fetch_products(client(), status, limit)]
    if name_contains:
        items = [i for i in items if name_contains.lower() in i["item_name"].lower()]
    return items


@tool
def get_products(item_ids: list[int]) -> list[dict[str, Any]]:
    """Detail produk berdasarkan item_id."""
    return [products.slim(i) for i in products.get_base_info(client(), item_ids)]


@tool
def seo_audit(status: str = "NORMAL", limit: int = 200) -> dict[str, Any]:
    """Audit SEO judul & deskripsi semua produk; hanya mengembalikan yang bermasalah."""
    audits = [seo.audit_item(products.slim(i)) for i in products.fetch_products(client(), status, limit)]
    flagged = [a for a in audits if a["issues"]]
    return {"checked": len(audits), "flagged": len(flagged), "items": flagged}


@tool
def preview_product_changes(changes: list[dict[str, Any]]) -> dict[str, Any]:
    """Validasi & pratinjau perubahan massal tanpa menulis ke Shopee.
    changes: [{"item_id": 123, "name": "...", "description": "..."}] (name/description opsional)."""
    return bulk.preview_changes(client(), changes)


@tool
def apply_product_changes(changes: list[dict[str, Any]], dry_run: bool = True) -> dict[str, Any]:
    """Terapkan perubahan nama/deskripsi massal. Default dry_run=True. Set False HANYA setelah
    user menyetujui preview. Backup otomatis dibuat (bisa di-rollback)."""
    return bulk.apply_changes(client(), changes, dry_run=dry_run)


@tool
def rollback_changes(backup_file: str) -> dict[str, Any]:
    """Pulihkan nama/deskripsi dari file backup hasil apply_product_changes."""
    return bulk.rollback(client(), backup_file)


@tool
def flash_sale_time_slots(days_ahead: int = 7) -> list[dict[str, Any]]:
    """Slot waktu flash sale yang tersedia."""
    return flash_sale.time_slots(client(), days_ahead)


@tool
def flash_sale_list(kind: int = 0) -> dict[str, Any]:
    """Daftar flash sale toko. kind: 0 semua, 1 akan datang, 2 berlangsung, 3 selesai."""
    return flash_sale.list_sales(client(), kind)


@tool
def flash_sale_detail(flash_sale_id: int) -> dict[str, Any]:
    """Detail flash sale + item di dalamnya."""
    return {"sale": flash_sale.get_sale(client(), flash_sale_id),
            "items": flash_sale.get_items(client(), flash_sale_id)}


@tool
def flash_sale_create(timeslot_id: int, items: list[dict[str, Any]], dry_run: bool = True) -> dict[str, Any]:
    """Buat flash sale di slot tertentu lalu tambahkan item.
    item: {item_id, purchase_limit, item_input_promotion_price, item_stock} atau {item_id, purchase_limit,
    models:[{model_id, input_promotion_price, stock}]}. Default dry_run=True."""
    errs = flash_sale.validate_items(items)
    if errs or dry_run:
        return {"dry_run": dry_run, "errors": errs, "timeslot_id": timeslot_id, "item_count": len(items)}
    sale = flash_sale.create_sale(client(), timeslot_id)
    fid = sale["flash_sale_id"]
    return {"flash_sale_id": fid, "add_items": flash_sale.add_items(client(), fid, items)}


@tool
def flash_sale_set_status(flash_sale_id: int, enable: bool) -> dict[str, Any]:
    """Aktifkan / nonaktifkan flash sale."""
    return flash_sale.set_status(client(), flash_sale_id, enable)


@tool
def flash_sale_delete(flash_sale_id: int, confirm: bool = False) -> dict[str, Any]:
    """Hapus flash sale (hanya jika confirm=True, minta persetujuan user dulu)."""
    if not confirm:
        return {"error": "Set confirm=True setelah user menyetujui penghapusan."}
    return flash_sale.delete_sale(client(), flash_sale_id)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
