import Script from "next/script";
import HtmlTemplate from "../_components/HtmlTemplate";

export const metadata = {
  title: "Solicitar senha",
  description: "Emissão de senhas digitais pelo tablet do atendimento."
};

export default function TabletPage() {
  return (
    <>
      <HtmlTemplate fileName="tablet.html" />
      <Script src="/tablet.js" strategy="afterInteractive" />
    </>
  );
}
