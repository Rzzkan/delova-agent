"""Konfigurasi dari environment / file .env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent

HOSTS = {
    "production": "https://partner.shopeemobile.com",
    "sandbox": "https://partner.test-stable.shopeemobile.com",
}


@dataclass
class Config:
    partner_id: int
    partner_key: str
    shop_id: int
    env: str
    host: str
    redirect_url: str
    read_only: bool
    token_file: Path
    backup_dir: Path

    @classmethod
    def load(cls) -> "Config":
        load_dotenv(ROOT / ".env")
        env = os.getenv("SHOPEE_ENV", "production").lower()
        if env not in HOSTS:
            raise ValueError("SHOPEE_ENV harus 'production' atau 'sandbox'")
        return cls(
            partner_id=int(os.getenv("SHOPEE_PARTNER_ID", "0") or 0),
            partner_key=os.getenv("SHOPEE_PARTNER_KEY", ""),
            shop_id=int(os.getenv("SHOPEE_SHOP_ID", "0") or 0),
            env=env,
            host=HOSTS[env],
            redirect_url=os.getenv("SHOPEE_REDIRECT_URL", "https://example.com/callback"),
            read_only=os.getenv("SHOPEE_READ_ONLY", "false").lower() == "true",
            token_file=ROOT / os.getenv("SHOPEE_TOKEN_FILE", "data/tokens.json"),
            backup_dir=ROOT / "data" / "backups",
        )

    def require_credentials(self) -> None:
        if not (self.partner_id and self.partner_key):
            raise RuntimeError(
                "SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY belum diisi. Salin .env.example ke .env."
            )
