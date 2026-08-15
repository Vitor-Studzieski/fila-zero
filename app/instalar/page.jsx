import Script from "next/script";
import HtmlTemplate from "../_components/HtmlTemplate";

export const metadata = {
  title: "Instalar aplicativo",
  description: "Instale o SenhaHub para acompanhar suas senhas pelo celular."
};

export default function InstallPage() {
  return (
    <>
      <HtmlTemplate fileName="install.html" />
      <Script src="/install.js" strategy="afterInteractive" />
    </>
  );
}
