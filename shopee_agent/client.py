"""HTTP client Shopee Open Platform v2: signing HMAC-SHA256, OAuth, auto-refresh token."""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

import httpx

from .config import Config


class ShopeeError(RuntimeError):
    def __init__(self, path: str, error: str, message: str, request_id: str = ""):
        super().__init__(f"{path}: {error} - {message} (request_id={request_id})")
        self.path, self.error, self.message, self.request_id = path, error, message, request_id


def make_sign(partner_key: str, partner_id: int, path: str, ts: int,
              access_token: str = "", shop_id: int | str = "") -> str:
    """Public API: partner_id+path+ts. Shop API: ditambah access_token+shop_id."""
    base = f"{partner_id}{path}{ts}{access_token}{shop_id}"
    return hmac.new(partner_key.encode(), base.encode(), hashlib.sha256).hexdigest()


class ShopeeClient:
    def __init__(self, cfg: Config | None = None):
        self.cfg = cfg or Config.load()
        self.http = httpx.Client(timeout=30)
        self._tokens: dict[str, Any] = {}
        self._last_call = 0.0

    # ---------- token storage ----------
    def _load_tokens(self) -> dict[str, Any]:
        if not self._tokens and self.cfg.token_file.exists():
            self._tokens = json.loads(self.cfg.token_file.read_text())
        return self._tokens

    def _save_tokens(self, data: dict[str, Any]) -> None:
        data["expire_at"] = int(time.time()) + int(data.get("expire_in", 14400)) - 120
        data.setdefault("shop_id", self.cfg.shop_id)
        self._tokens = data
        self.cfg.token_file.parent.mkdir(parents=True, exist_ok=True)
        self.cfg.token_file.write_text(json.dumps(data, indent=2))
        try:
            self.cfg.token_file.chmod(0o600)
        except OSError:
            pass

    # ---------- OAuth ----------
    def auth_url(self) -> str:
        self.cfg.require_credentials()
        path = "/api/v2/shop/auth_partner"
        ts = int(time.time())
        sign = make_sign(self.cfg.partner_key, self.cfg.partner_id, path, ts)
        return (f"{self.cfg.host}{path}?partner_id={self.cfg.partner_id}&timestamp={ts}"
                f"&sign={sign}&redirect={self.cfg.redirect_url}")

    def exchange_code(self, code: str, shop_id: int | None = None) -> dict[str, Any]:
        shop_id = shop_id or self.cfg.shop_id
        data = self._call("POST", "/api/v2/auth/token/get", body={
            "code": code, "shop_id": int(shop_id), "partner_id": self.cfg.partner_id}, shop=False)
        data["shop_id"] = int(shop_id)
        self._save_tokens(data)
        return {"shop_id": data["shop_id"], "expire_in": data.get("expire_in")}

    def refresh(self) -> None:
        t = self._load_tokens()
        if not t.get("refresh_token"):
            raise RuntimeError("Belum login. Jalankan: shopee-agent auth-url lalu auth-exchange")
        data = self._call("POST", "/api/v2/auth/access_token/get", body={
            "refresh_token": t["refresh_token"], "shop_id": int(t["shop_id"]),
            "partner_id": self.cfg.partner_id}, shop=False)
        data["shop_id"] = t["shop_id"]
        self._save_tokens(data)  # refresh_token ikut berganti, wajib disimpan

    def _access(self) -> tuple[str, int]:
        t = self._load_tokens()
        if not t:
            raise RuntimeError("Belum login. Jalankan: shopee-agent auth-url lalu auth-exchange")
        if time.time() >= t.get("expire_at", 0):
            self.refresh()
            t = self._tokens
        return t["access_token"], int(t["shop_id"])

    # ---------- core request ----------
    def _call(self, method: str, path: str, params: dict | None = None,
              body: dict | None = None, shop: bool = True) -> dict[str, Any]:
        self.cfg.require_credentials()
        gap = 0.25 - (time.time() - self._last_call)  # hormati rate limit
        if gap > 0:
            time.sleep(gap)
        ts = int(time.time())
        q: dict[str, Any] = {"partner_id": self.cfg.partner_id, "timestamp": ts}
        if shop:
            token, shop_id = self._access()
            q.update(access_token=token, shop_id=shop_id)
            q["sign"] = make_sign(self.cfg.partner_key, self.cfg.partner_id, path, ts, token, shop_id)
        else:
            q["sign"] = make_sign(self.cfg.partner_key, self.cfg.partner_id, path, ts)
        q.update(params or {})
        r = self.http.request(method, self.cfg.host + path, params=q,
                              json=body if method == "POST" else None)
        self._last_call = time.time()
        try:
            data = r.json()
        except ValueError:
            raise ShopeeError(path, f"http_{r.status_code}", r.text[:300])
        if data.get("error"):
            raise ShopeeError(path, data["error"], data.get("message", ""), data.get("request_id", ""))
        return data

    def get(self, path: str, **params: Any) -> dict[str, Any]:
        return self._call("GET", path, params=params)

    def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        if self.cfg.read_only:
            raise PermissionError("SHOPEE_READ_ONLY=true: operasi tulis diblokir.")
        return self._call("POST", path, body=body)
