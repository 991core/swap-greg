/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Import only our configured chains. The full viem/chains barrel also
    // includes Tempo's Node worker pool, which Webpack cannot statically bundle.
    optimizePackageImports: ["viem/chains"],
  },
};

module.exports = nextConfig;
