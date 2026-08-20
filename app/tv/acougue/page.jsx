import HtmlTemplate from "../../_components/HtmlTemplate";

export const metadata = {
  title: "TV do açougue",
  description: "Chamadas de senha e ofertas do açougue do Supermercado Pompeia."
};

export default function ButcherDisplayPage() {
  return (
    <>
      <HtmlTemplate fileName="tv-acougue.html" />
      <script src="/tv-acougue.js?v=20260820.2" />
    </>
  );
}
