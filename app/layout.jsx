import Script from "next/script";

export const metadata = {
  title: {
    default: "SenhaHub - Supermercado Pompeia",
    template: "%s | SenhaHub"
  },
  applicationName: "SenhaHub",
  description: "Fila virtual, acompanhamento de atendimento e lista de compras do Supermercado Pompeia.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/senhahub-192.png", sizes: "192x192", type: "image/png" }
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }
    ]
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SenhaHub"
  },
  formatDetection: {
    telephone: false
  },
  other: {
    "mobile-web-app-capable": "yes"
  }
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#06466f",
  colorScheme: "light"
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/styles.css" />
        <link rel="stylesheet" href="/pwa.css" />
      </head>
      <body>
        {children}
        <Script src="/pwa-utils.js?v=20260820.2" strategy="afterInteractive" />
        <Script src="/pwa.js?v=20260820.2" strategy="afterInteractive" />
      </body>
    </html>
  );
}
