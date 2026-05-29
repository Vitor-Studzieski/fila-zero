import Script from "next/script";
import HtmlTemplate from "../_components/HtmlTemplate";

export default function AttendantPage() {
  return (
    <>
      <HtmlTemplate fileName="attendant.html" />
      <Script src="/attendant.js" strategy="afterInteractive" />
    </>
  );
}
