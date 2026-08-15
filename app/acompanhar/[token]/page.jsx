import Script from "next/script";
import HtmlTemplate from "../../_components/HtmlTemplate";

export const metadata = {
  title: "Acompanhar senha",
  description: "Acompanhe a posição da sua senha no SenhaHub."
};

export default function TrackTicketPage() {
  return (
    <>
      <HtmlTemplate fileName="acompanhar.html" />
      <Script src="/acompanhar.js" strategy="afterInteractive" />
    </>
  );
}
