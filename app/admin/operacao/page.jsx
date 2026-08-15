import Script from "next/script";
import HtmlTemplate from "../../_components/HtmlTemplate";

export default function AdminOperationPage() {
  return (
    <div className="manager-page">
      <HtmlTemplate fileName="admin-operacao.html" />
      <Script src="/admin.js" strategy="afterInteractive" />
    </div>
  );
}
