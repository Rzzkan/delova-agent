"""Bulk edit aman: validasi -> preview (dry-run) -> backup -> apply -> rollback."""
from __future__ import annotations

import csv
import json
import time
from pathlib import Path
from typing import Any

from . import products, seo
from .client import ShopeeClient, ShopeeError


def _backup(c: ShopeeClient, originals: list[dict[str, Any]]) -> str:
    c.cfg.backup_dir.mkdir(parents=True, exist_ok=True)
    path = c.cfg.backup_dir / f"backup_{time.strftime('%Y%m%d_%H%M%S')}.json"
    path.write_text(json.dumps(originals, ensure_ascii=False, indent=2))
    return str(path)


def preview_changes(c: ShopeeClient, changes: list[dict[str, Any]]) -> dict[str, Any]:
    """changes: [{item_id, name?, description?}]. Tidak mengubah apa pun."""
    ids = [int(ch["item_id"]) for ch in changes]
    current = {i["item_id"]: products.slim(i) for i in products.get_base_info(c, ids)}
    rows, ok, bad = [], 0, 0
    for ch in changes:
        iid = int(ch["item_id"])
        cur = current.get(iid)
        if not cur:
            rows.append({"item_id": iid, "status": "tidak ditemukan"}); bad += 1; continue
        errs = seo.blocking_errors(ch.get("name"), ch.get("description"))
        warn = seo.validate_title(ch["name"]) if ch.get("name") else []
        row = {"item_id": iid, "status": "error" if errs else "ok", "errors": errs, "warnings": warn}
        if "name" in ch:
            row["name_before"], row["name_after"] = cur["item_name"], ch["name"]
        if "description" in ch:
            row["desc_before_len"], row["desc_after_len"] = len(cur["description"]), len(ch["description"])
        rows.append(row)
        bad += bool(errs); ok += not errs
    return {"total": len(changes), "valid": ok, "invalid": bad, "rows": rows}


def apply_changes(c: ShopeeClient, changes: list[dict[str, Any]], dry_run: bool = True) -> dict[str, Any]:
    report = preview_changes(c, changes)
    if dry_run:
        report["dry_run"] = True
        return report
    ids = [int(ch["item_id"]) for ch in changes]
    originals = [products.slim(i) for i in products.get_base_info(c, ids)]
    by_id = {o["item_id"]: o for o in originals}
    report["backup_file"] = _backup(c, originals)
    results = []
    valid_ids = {r["item_id"] for r in report["rows"] if r["status"] == "ok"}
    for ch in changes:
        iid = int(ch["item_id"])
        if iid not in valid_ids:
            results.append({"item_id": iid, "result": "dilewati (tidak valid)"}); continue
        try:
            products.update_item(c, iid, ch.get("name"), ch.get("description"),
                                 by_id[iid]["description_type"])
            results.append({"item_id": iid, "result": "berhasil"})
        except ShopeeError as e:
            results.append({"item_id": iid, "result": f"gagal: {e.error} {e.message}"})
    report["dry_run"] = False
    report["results"] = results
    report["success"] = sum(r["result"] == "berhasil" for r in results)
    return report


def rollback(c: ShopeeClient, backup_file: str) -> dict[str, Any]:
    originals = json.loads(Path(backup_file).read_text())
    results = []
    for o in originals:
        try:
            products.update_item(c, o["item_id"], o["item_name"], o["description"], o["description_type"])
            results.append({"item_id": o["item_id"], "result": "dipulihkan"})
        except ShopeeError as e:
            results.append({"item_id": o["item_id"], "result": f"gagal: {e.error} {e.message}"})
    return {"restored": sum(r["result"] == "dipulihkan" for r in results), "results": results}


# ---------- CSV ----------
def export_csv(items: list[dict[str, Any]], path: str) -> str:
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["item_id", "item_name", "description"])
        w.writeheader()
        for i in items:
            s = products.slim(i)
            w.writerow({k: s[k] for k in w.fieldnames})
    return path


def read_csv_changes(path: str) -> list[dict[str, Any]]:
    """Kolom: item_id, item_name (opsional), description (opsional). Sel kosong = tidak diubah."""
    out = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            ch: dict[str, Any] = {"item_id": int(row["item_id"])}
            if row.get("item_name"):
                ch["name"] = row["item_name"]
            if row.get("description"):
                ch["description"] = row["description"]
            out.append(ch)
    return out
