/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    appDir: false, // ❗ App Router 강제로 끔
  },
};

export default nextConfig;