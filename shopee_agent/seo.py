"""Aturan SEO produk Shopee (judul & deskripsi). Murni lokal, tanpa API."""
from __future__ import annotations

import re
from collections import Counter

TITLE_MIN, TITLE_MAX = 20, 120      # batas Shopee untuk nama produk
DESC_MIN, DESC_MAX = 100, 3000      # batas deskripsi
EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF☀-➿]")
SPAM_RE = re.compile(r"(!!+|\*{2,}|#{2,}|\bpromo\b|\bmurah banget\b|\bdiskon\b|\bsale\b|\bready stock\b)", re.I)


def validate_title(name: str) -> list[str]:
    issues = []
    n = len(name.strip())
    if n < TITLE_MIN:
        issues.append(f"terlalu pendek ({n} < {TITLE_MIN})")
    if n > TITLE_MAX:
        issues.append(f"terlalu panjang ({n} > {TITLE_MAX}) - akan ditolak Shopee")
    elif n < 70 and n >= TITLE_MIN:
        issues.append(f"masih bisa dimaksimalkan untuk keyword ({n}/{TITLE_MAX} karakter)")
    letters = [c for c in name if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.6:
        issues.append("terlalu banyak HURUF KAPITAL")
    if EMOJI_RE.search(name):
        issues.append("mengandung emoji")
    if SPAM_RE.search(name):
        issues.append("mengandung kata promo/spam di judul (berisiko dinilai keyword stuffing)")
    words = [w.lower() for w in re.findall(r"\w+", name) if len(w) > 2]
    dup = [w for w, c in Counter(words).items() if c > 2]
    if dup:
        issues.append(f"kata diulang >2x: {', '.join(dup)}")
    return issues


def validate_description(desc: str) -> list[str]:
    issues = []
    n = len(desc.strip())
    if n < DESC_MIN:
        issues.append(f"deskripsi terlalu pendek ({n} < {DESC_MIN})")
    if n > DESC_MAX:
        issues.append(f"deskripsi terlalu panjang ({n} > {DESC_MAX}) - akan ditolak Shopee")
    return issues


def blocking_errors(name: str | None, description: str | None) -> list[str]:
    """Pelanggaran keras yang akan membuat Shopee menolak perubahan."""
    errs = []
    if name is not None:
        n = len(name.strip())
        if not TITLE_MIN <= n <= TITLE_MAX:
            errs.append(f"nama {n} karakter, harus {TITLE_MIN}-{TITLE_MAX}")
    if description is not None and len(description) > DESC_MAX:
        errs.append(f"deskripsi {len(description)} karakter, maks {DESC_MAX}")
    return errs


def audit_item(item: dict) -> dict:
    name = item.get("item_name", "")
    desc = item.get("description", "") or ""
    issues = validate_title(name)
    if desc:
        issues += validate_description(desc)
    return {"item_id": item.get("item_id"), "name": name, "name_len": len(name), "issues": issues}
