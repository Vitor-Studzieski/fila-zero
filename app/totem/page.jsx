import Script from "next/script";
import HtmlTemplate from "../_components/HtmlTemplate";

export const metadata = {
  title: "Totem de senhas",
  description: "Emissao de senhas fisicas do SenhaHub."
};

export default function TotemPage() {
  return (
    <>
      <HtmlTemplate fileName="totem.html" />
      <Script src="/vendor/qrcode-generator.js" strategy="beforeInteractive" />
      <Script src="/totem.js" strategy="afterInteractive" />
    </>
  );
}
