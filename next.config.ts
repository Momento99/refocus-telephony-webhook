// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Next.js 16: ключ `eslint` в next.config.ts больше не поддерживается.
  // Линт лучше отключать через Vercel setting или отдельным шагом в CI.
  // Здесь убираем полностью.

  // Если хочешь, чтобы билд не падал из-за TS во время миграции:
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
