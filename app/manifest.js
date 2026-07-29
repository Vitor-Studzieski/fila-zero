export default function manifest() {
  return {
    id: "/",
    name: "Fila Zero - Supermercado Pompeia",
    short_name: "Fila Zero",
    description: "Fila virtual, acompanhamento de atendimento e lista de compras do Supermercado Pompeia.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f4f7fb",
    theme_color: "#06466f",
    lang: "pt-BR",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: "/icons/fila-zero-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/fila-zero-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/fila-zero-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable"
      },
      {
        src: "/icons/fila-zero-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ],
    shortcuts: [
      {
        name: "Minhas senhas",
        short_name: "Senhas",
        description: "Abrir o acompanhamento das suas senhas.",
        url: "/?view=status",
        icons: [
          {
            src: "/icons/fila-zero-192.png",
            sizes: "192x192",
            type: "image/png"
          }
        ]
      }
    ]
  };
}
