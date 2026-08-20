/** @type {import('next').NextConfig} */
const isDevelopment = process.env.NODE_ENV !== "production";
const apiServerUrl = String(process.env.API_SERVER_URL || "").trim().replace(/\/+$/, "");

if (apiServerUrl) {
  let parsedApiServerUrl;
  try {
    parsedApiServerUrl = new URL(apiServerUrl);
  } catch {
    throw new Error("API_SERVER_URL precisa ser uma URL HTTPS válida.");
  }
  if (parsedApiServerUrl.protocol !== "https:" && !isDevelopment) {
    throw new Error("API_SERVER_URL precisa usar HTTPS em produção.");
  }
}
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https://source.unsplash.com https://images.unsplash.com",
  `connect-src 'self'${isDevelopment ? " ws: http://localhost:*" : ""}`,
  "font-src 'self' https://fonts.gstatic.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (!apiServerUrl) return { beforeFiles: [] };
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${apiServerUrl}/api/:path*`
        }
      ]
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), usb=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...(isDevelopment
            ? []
            : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" }])
        ]
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" }
        ]
      },
      {
        source: "/sw/:path*",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }
        ]
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" }
        ]
      }
    ];
  }
};

module.exports = nextConfig;
