const fs = require("node:fs");
const path = require("node:path");

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const { validateProductionEnvironment } = require("../server/production-readiness");
const result = validateProductionEnvironment({ ...process.env, NODE_ENV: "production" });

if (!result.ok) {
  console.error("Preflight de produção reprovado:");
  result.errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log("Preflight de produção aprovado: variáveis obrigatórias e controles básicos estão configurados.");
}

result.warnings.forEach((warning) => console.warn(`Aviso: ${warning}`));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = unquote(match[2]);
  }
}

function unquote(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
