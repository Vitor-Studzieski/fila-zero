import Script from "next/script";
import HtmlTemplate from "../_components/HtmlTemplate";

export default function LoginPage() {
  return (
    <>
      <HtmlTemplate fileName="login.html" />
      <Script src="/login.js" strategy="afterInteractive" />
    </>
  );
}
