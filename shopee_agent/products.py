"""Operasi produk: list, detail, update nama/deskripsi."""
from __future__ import annotations

from typing import Any

from .client import ShopeeClient

P = "/api/v2/product"


def list_item_ids(c: ShopeeClient, status: str = "NORMAL", limit: int | None = None) -> list[int]:
    """status: NORMAL | BANNED | UNLIST | REVIEWING | SELLER_DELETE | SHOPEE_DELETE"""
    ids: list[int] = []
    offset = 0
    while True:
        r = c.get(f"{P}/get_item_list", offset=offset, page_size=100, item_status=status)
        resp = r.get("response", {})
        ids += [i["item_id"] for i in resp.get("item", [])]
        if not resp.get("has_next_page"):
            break
        offset = resp.get("next_offset", offset + 100)
        if limit and len(ids) >= limit:
            break
    return ids[:limit] if limit else ids


def get_base_info(c: ShopeeClient, item_ids: list[int]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i in range(0, len(item_ids), 50):
        chunk = item_ids[i:i + 50]
        r = c.get(f"{P}/get_item_base_info", item_id_list=",".join(map(str, chunk)))
        out += r.get("response", {}).get("item_list", [])
    return out


def fetch_products(c: ShopeeClient, status: str = "NORMAL", limit: int | None = None) -> list[dict[str, Any]]:
    return get_base_info(c, list_item_ids(c, status, limit))


def description_text(item: dict[str, Any]) -> str:
    """Ambil deskripsi sebagai teks, baik tipe 'normal' maupun 'extended'."""
    if item.get("description_type") == "extended":
        fields = (item.get("description_info", {}).get("extended_description", {}).get("field_list", []))
        return "\n".join(f.get("text", "") for f in fields if f.get("field_type") == "text")
    return item.get("description", "") or ""


def slim(item: dict[str, Any]) -> dict[str, Any]:
    """Ringkasan produk yang hemat token untuk Claude."""
    return {
        "item_id": item["item_id"],
        "item_name": item.get("item_name", ""),
        "item_status": item.get("item_status"),
        "category_id": item.get("category_id"),
        "description_type": item.get("description_type", "normal"),
        "description": description_text(item),
        "has_model": item.get("has_model"),
    }


def update_item(c: ShopeeClient, item_id: int, name: str | None = None,
                description: str | None = None, description_type: str = "normal") -> dict[str, Any]:
    body: dict[str, Any] = {"item_id": int(item_id)}
    if name is not None:
        body["item_name"] = name
    if description is not None:
        if description_type == "extended":
            body["description_type"] = "extended"
            body["description_info"] = {"extended_description": {
                "field_list": [{"field_type": "text", "text": description}]}}
        else:
            body["description"] = description
    return c.post(f"{P}/update_item", body)
