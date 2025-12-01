// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // ← Critical fix for dev (prevents double map init)
  // You can re-enable it later in production if you want
};

module.exports = nextConfig;