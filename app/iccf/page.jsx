import Script from "next/script";
import HtmlTemplate from "../_components/HtmlTemplate";

export default function IccfPage() {
  return (
    <div className="manager-page">
      <HtmlTemplate fileName="iccf.html" />
      <Script src="/iccf.js" strategy="afterInteractive" />
    </div>
  );
}
