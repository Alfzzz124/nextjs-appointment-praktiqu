/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: '*.githubusercontent.com',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
    // Shared hosting (CloudLinux LVE) caps processes; parallel build workers
    // die with spawn EAGAIN. Set LIMIT_BUILD_WORKERS=1 there to build serially.
    ...(process.env.LIMIT_BUILD_WORKERS
      ? { cpus: 1, workerThreads: false }
      : {}),
  },
};

module.exports = nextConfig;
