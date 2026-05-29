import Script from "next/script";
import HtmlTemplate from "../_components/HtmlTemplate";

export default function AdminPage() {
  return (
    <>
      <HtmlTemplate fileName="admin.html" />
      <Script src="/admin.js" strategy="afterInteractive" />
    </>
  );
}
