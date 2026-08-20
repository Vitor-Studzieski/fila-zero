/** @type {import('next').NextConfig} */
const isDevelopment = process.env.NODE_ENV !== "production";
const dataBackend = String(process.env.DATA_BACKEND || "").trim().toLowerCase();
const isVercelProduction = !isDevelopment && process.env.VERCEL === "1";

if (isVercelProduction) {
  if (dataBackend !== "supabase") {
    throw new Error("A publicação Vercel precisa usar exclusivamente DATA_BACKEND=supabase.");
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
    return { beforeFiles: [] };
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
