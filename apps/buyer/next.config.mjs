/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@poi/contracts"],
  // Lint runs once at the repo root (pnpm lint), not again inside next build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
