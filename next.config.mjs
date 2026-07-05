/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return {
      // `fallback` rewrites run ONLY after every filesystem route (static, /book/*,
      // the dynamic [slug] tree) has been checked — i.e. only for paths that would
      // otherwise 404. This makes ANY current-or-future /book page automatically
      // reachable under /<slug>/book/* with zero per-page files, WITHOUT touching a
      // single working URL: the legacy root links (/book/*, no slug) and every
      // existing /<slug>/book/* wrapper keep matching their filesystem route first,
      // so this rule never fires for them. It can only turn a would-be 404 into the
      // matching root page (slug is then read client-side from the URL via useSlug).
      fallback: [
        { source: "/:slug/book/:path*", destination: "/book/:path*" },
      ],
    };
  },
};

export default nextConfig;
