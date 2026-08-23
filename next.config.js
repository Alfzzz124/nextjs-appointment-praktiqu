/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: true,
  // Arsip landing page disajikan sebagai berkas statis dari public/landing-page/.
  // Tanpa redirect ini, /landing-page — bentuk URL yang paling wajar diketik —
  // menjawab 404, dan /landing-page/ dinormalkan Next ke sana sehingga ikut 404.
  async redirects() {
    return [
      { source: '/landing-page', destination: '/landing-page.html', permanent: false },
    ];
  },
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
