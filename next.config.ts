import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "standalone", // image Docker kecil: hanya file yang dibutuhkan
  serverExternalPackages: ["ioredis"],
};

export default nextConfig;
