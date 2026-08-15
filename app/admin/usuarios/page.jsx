import Script from "next/script";
import HtmlTemplate from "../../_components/HtmlTemplate";

export default function AdminUsersPage() {
  return (
    <div className="manager-page">
      <HtmlTemplate fileName="admin-usuarios.html" />
      <Script src="/admin.js" strategy="afterInteractive" />
    </div>
  );
}
