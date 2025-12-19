import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Чтобы build не валился на eslint (у тебя уже так сделано)
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Временно: чтобы build не валился на type-check (пока мигрируешь на Next 15)
  // Можно убрать позже, когда поправишь все route handlers/pages типы.
  typescript: {
    ignoreBuildErrors: true,
  },

  // НИКАКИХ basePath, assetPrefix, rewrites, redirects, distDir — оставляем пусто
};

export default nextConfig;
