import fs from "node:fs";
import path from "node:path";

function readBodyTemplate(fileName) {
  const filePath = path.join(process.cwd(), "public", fileName);
  const html = fs.readFileSync(filePath, "utf8");
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  return body.replace(/<script[\s\S]*?<\/script>/gi, "").trim();
}

export default function HtmlTemplate({ fileName }) {
  return <div dangerouslySetInnerHTML={{ __html: readBodyTemplate(fileName) }} />;
}
