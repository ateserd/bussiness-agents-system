import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WASM Postgres build; it must stay outside the bundler.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
};

export default nextConfig;
