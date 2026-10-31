import ProductsClient from "../ProductsClient";

export const metadata = { title: "Produk Shopee · Marketplace Agent", robots: { index: false, follow: false } };

export default function Page() {
  return <ProductsClient platform="shopee" />;
}
