"""Shop Flash Sale (modul /api/v2/shop_flash_sale).

Catatan: nama field item mengikuti dokumentasi Shopee Open Platform; verifikasi dengan
dokumentasi terbaru / sandbox sebelum dipakai massal.
"""
from __future__ import annotations

import time
from typing import Any

from .client import ShopeeClient

F = "/api/v2/shop_flash_sale"


def time_slots(c: ShopeeClient, days_ahead: int = 7) -> list[dict[str, Any]]:
    now = int(time.time())
    r = c.get(f"{F}/get_time_slot_id", start_time=now, end_time=now + days_ahead * 86400)
    return r.get("response", [])


def list_sales(c: ShopeeClient, kind: int = 0, offset: int = 0, count: int = 50) -> dict[str, Any]:
    """kind: 0 semua, 1 akan datang, 2 berlangsung, 3 selesai."""
    now = int(time.time())
    r = c.get(f"{F}/get_shop_flash_sale_list", timeslot_type=kind, pagination_offset=offset,
              pagination_entry_count=count, start_time=now - 30 * 86400, end_time=now + 60 * 86400)
    return r.get("response", {})


def get_sale(c: ShopeeClient, flash_sale_id: int) -> dict[str, Any]:
    return c.get(f"{F}/get_shop_flash_sale", flash_sale_id=flash_sale_id).get("response", {})


def get_items(c: ShopeeClient, flash_sale_id: int) -> dict[str, Any]:
    return c.get(f"{F}/get_shop_flash_sale_items", flash_sale_id=flash_sale_id,
                 offset=0, limit=100).get("response", {})


def create_sale(c: ShopeeClient, timeslot_id: int) -> dict[str, Any]:
    return c.post(f"{F}/create_shop_flash_sale", {"timeslot_id": int(timeslot_id)}).get("response", {})


def add_items(c: ShopeeClient, flash_sale_id: int, items: list[dict[str, Any]]) -> dict[str, Any]:
    """items: [{item_id, purchase_limit, item_input_promotion_price?, item_stock?,
                models?: [{model_id, input_promotion_price, stock}]}]"""
    return c.post(f"{F}/add_shop_flash_sale_items",
                  {"flash_sale_id": int(flash_sale_id), "items": items}).get("response", {})


def set_status(c: ShopeeClient, flash_sale_id: int, enable: bool) -> dict[str, Any]:
    return c.post(f"{F}/update_shop_flash_sale",
                  {"flash_sale_id": int(flash_sale_id), "status": 1 if enable else 2})


def delete_sale(c: ShopeeClient, flash_sale_id: int) -> dict[str, Any]:
    return c.post(f"{F}/delete_shop_flash_sale", {"flash_sale_id": int(flash_sale_id)})


def validate_items(items: list[dict[str, Any]]) -> list[str]:
    errs = []
    for it in items:
        if "item_id" not in it:
            errs.append("item tanpa item_id")
        if not it.get("models") and not it.get("item_input_promotion_price"):
            errs.append(f"item {it.get('item_id')}: isi item_input_promotion_price atau models")
        if not it.get("purchase_limit"):
            errs.append(f"item {it.get('item_id')}: purchase_limit wajib")
    return errs
