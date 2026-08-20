import Script from "next/script";
import HtmlTemplate from "./_components/HtmlTemplate";

export default function CustomerPage() {
  return (
    <>
      <HtmlTemplate fileName="index.html" />
      <Script src="/app.js?v=20260820.4" strategy="afterInteractive" />
    </>
  );
}
