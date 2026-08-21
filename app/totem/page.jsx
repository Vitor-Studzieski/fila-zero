import Script from "next/script";
import HtmlTemplate from "../_components/HtmlTemplate";

export const metadata = {
  title: "Totem de senhas",
  description: "Emissao de senhas fisicas do SenhaHub."
};

const TOTEM_ASSET_VERSION = "2026.08.21.4";

export default function TotemPage() {
  return (
    <>
      <HtmlTemplate fileName="totem.html" />
      <Script src="/vendor/qrcode-generator.js" strategy="beforeInteractive" />
      <Script src={`/totem.js?v=${TOTEM_ASSET_VERSION}`} strategy="afterInteractive" />
    </>
  );
}
