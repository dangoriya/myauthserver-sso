/** @type {import('next').NextConfig} */
const nextConfig = {
  // `standalone` produces a minimal `server.js` and a small `.next/standalone`
  // folder containing only the files the running server needs. This is what
  // the multi-stage Dockerfile copies into the final image — it cuts the
  // runtime image size by ~80% and avoids shipping node_modules.
  output: 'standalone',

  // Skip linting and type-checking during the Docker build for speed —
  // the dev environment handles those checks separately.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;
