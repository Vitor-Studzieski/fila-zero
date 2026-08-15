import Script from "next/script";
import HtmlTemplate from "../../_components/HtmlTemplate";

export default function AdminSectorsPage() {
  return (
    <div className="manager-page">
      <HtmlTemplate fileName="admin-setores.html" />
      <Script src="/admin.js" strategy="afterInteractive" />
    </div>
  );
}
