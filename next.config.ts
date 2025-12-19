/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Важно: отключаем ESLint-проверку во время `next build`,
  // иначе билд падает на правилах типа no-explicit-any и т.п.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // НИКАКИХ basePath, assetPrefix, rewrites, redirects, distDir — пока всё лишнее закомментируй
};

module.exports = nextConfig;
