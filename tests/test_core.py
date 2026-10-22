import hashlib
import hmac

from shopee_agent import flash_sale, seo
from shopee_agent.client import make_sign


def test_sign_public():
    expected = hmac.new(b"key", b"123/api/v2/shop/auth_partner1700000000", hashlib.sha256).hexdigest()
    assert make_sign("key", 123, "/api/v2/shop/auth_partner", 1700000000) == expected


def test_sign_shop():
    expected = hmac.new(b"key", b"123/api/v2/product/get_item_list1700000000tok99", hashlib.sha256).hexdigest()
    assert make_sign("key", 123, "/api/v2/product/get_item_list", 1700000000, "tok", 99) == expected


def test_title_rules():
    assert any("pendek" in i for i in seo.validate_title("Kebaya"))
    assert any("panjang" in i for i in seo.validate_title("a" * 130))
    assert any("KAPITAL" in i for i in seo.validate_title("KEBAYA MODERN WANITA TERBARU"))
    good = "Kebaya Modern Wanita Brokat Premium Set Rok Batik Lilit Baju Pesta Kondangan Wisuda Lamaran"
    assert seo.validate_title(good) == []


def test_blocking():
    assert seo.blocking_errors("x" * 10, None)
    assert seo.blocking_errors(None, "d" * 3001)
    assert not seo.blocking_errors("Kebaya Modern Wanita Brokat Premium", "ok")


def test_flash_validation():
    assert flash_sale.validate_items([{"item_id": 1}])
    ok = [{"item_id": 1, "purchase_limit": 2, "item_input_promotion_price": 99000}]
    assert flash_sale.validate_items(ok) == []
