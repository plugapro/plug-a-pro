import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-XSS-Protection", value: "0" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

// Velite webpack plugin — defined inline per https://velite.js.org/guide/with-nextjs
// (velite has no exported VeliteWebpackPlugin; the class must be defined locally)
class VeliteWebpackPlugin {
  static started = false;
  apply(compiler: { options: { mode: string }; hooks: { beforeCompile: { tapPromise: (name: string, fn: () => Promise<void>) => void } } }) {
    compiler.hooks.beforeCompile.tapPromise("VeliteWebpackPlugin", async () => {
      if (VeliteWebpackPlugin.started) return;
      VeliteWebpackPlugin.started = true;
      const dev = compiler.options.mode === "development";
      const { build } = await import("velite");
      await build({ watch: dev, clean: !dev });
    });
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // turbopack: {} silences the "webpack config present but no turbopack config"
  // error — Next.js 16 defaults to Turbopack. The VeliteWebpackPlugin below
  // only runs under webpack (pnpm build); Turbopack handles dev without it.
  // T5 will add proper Turbopack support for Velite when content layer is wired up.
  turbopack: {},
  webpack(config) {
    config.plugins.push(new VeliteWebpackPlugin());
    return config;
  },
};

export default nextConfig;
