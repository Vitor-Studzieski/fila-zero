import HtmlTemplate from "../../_components/HtmlTemplate";

export const metadata = {
  title: "TV de atendimento",
  description: "Chamadas de senha e conteúdos da loja do Supermercado Pompeia."
};

export default function ButcherDisplayPage() {
  return (
    <>
      <HtmlTemplate fileName="tv-acougue.html" />
      <script src="/tv-acougue.js?v=20260821.1" />
    </>
  );
}
