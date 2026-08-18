import Script from "next/script";
import HtmlTemplate from "../../_components/HtmlTemplate";

const TRACKING_ASSET_VERSION = "2026.08.18.3";

export const metadata = {
  title: "Acompanhar senha",
  description: "Acompanhe a posição da sua senha no SenhaHub."
};

export default function TrackTicketPage() {
  return (
    <>
      <HtmlTemplate fileName="acompanhar.html" />
      <Script src={`/acompanhar.js?v=${TRACKING_ASSET_VERSION}`} strategy="afterInteractive" />
    </>
  );
}
