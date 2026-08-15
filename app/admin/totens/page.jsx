import Script from "next/script";
import HtmlTemplate from "../../_components/HtmlTemplate";

export default function AdminKiosksPage() {
  return (
    <div className="manager-page">
      <HtmlTemplate fileName="admin-totens.html" />
      <Script src="/admin.js" strategy="afterInteractive" />
    </div>
  );
}
