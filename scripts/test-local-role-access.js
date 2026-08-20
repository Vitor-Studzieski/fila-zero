const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { close } = require("../server/local-postgres");
const { loginLocalUser } = require("../server/local-auth");

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const tabletEmail = String(process.env.LOCAL_TEST_TABLET_EMAIL || "tablet@superpompeia.com");
const tabletPassword = String(process.env.LOCAL_TEST_TABLET_PASSWORD || "");
const attendantEmail = String(process.env.LOCAL_TEST_ATTENDANT_EMAIL || "atendente.acougue@superpompeia.com");
const attendantPassword = String(process.env.LOCAL_TEST_ATTENDANT_PASSWORD || "");

run().catch((error) => {
  console.error(`Validação das credenciais falhou: ${error.message}`);
  process.exitCode = 1;
}).finally(() => close().catch(() => {}));

async function run() {
  assert.ok(tabletPassword && attendantPassword, "informe as duas senhas apenas no ambiente da validação");

  const tablet = await loginLocalUser({ email: tabletEmail, password: tabletPassword, attemptKey: "verify:tablet" });
  const attendant = await loginLocalUser({ email: attendantEmail, password: attendantPassword, attemptKey: "verify:attendant" });
  assert.equal(tablet.user?.role, "tablet");
  assert.equal(attendant.user?.role, "attendant");
  assert.deepEqual(attendant.user?.sectorIds, ["acougue"]);

  const tabletStatus = await import("../app/api/local-postgres/tablet/status/route.js");
  const tabletTickets = await import("../app/api/local-postgres/tablet/tickets/route.js");
  const staffState = await import("../app/api/local-postgres/staff/state/route.js");

  const tabletCookie = cookieHeader(tablet);
  const attendantCookie = cookieHeader(attendant);
  const statusResponse = await tabletStatus.GET(new Request("http://localhost/api/local-postgres/tablet/status", {
    headers: { cookie: tabletCookie }
  }));
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.ok(Array.isArray(status.sectors));
  assert.ok(status.sectors.length > 0);

  const attendantDenied = await tabletStatus.GET(new Request("http://localhost/api/local-postgres/tablet/status", {
    headers: { cookie: attendantCookie }
  }));
  assert.equal(attendantDenied.status, 403);

  const tabletStaffDenied = await staffState.GET(new Request("http://localhost/api/local-postgres/staff/state", {
    headers: { cookie: tabletCookie }
  }));
  assert.equal(tabletStaffDenied.status, 403);

  const tabletValidation = await tabletTickets.POST(new Request("http://localhost/api/local-postgres/tablet/tickets", {
    method: "POST",
    headers: { cookie: tabletCookie, "content-type": "application/json", "x-csrf-token": tablet.csrfToken },
    body: JSON.stringify({})
  }));
  assert.equal(tabletValidation.status, 400);

  const staffResponse = await staffState.GET(new Request("http://localhost/api/local-postgres/staff/state", {
    headers: { cookie: attendantCookie }
  }));
  assert.equal(staffResponse.status, 200);
  const staff = await staffResponse.json();
  assert.ok((staff.sectors || []).every((sector) => sector.id === "acougue"));

  console.log(JSON.stringify({
    ok: true,
    tablet: { login: true, ticketRequestRoute: true, physicalKioskRouteNotUsed: true },
    butcherAttendant: { login: true, sectorIds: attendant.user.sectorIds, staffRoute: true, otherSectorsDeniedByPermissions: true }
  }, null, 2));
}

function cookieHeader(result) {
  return [
    `senhahub_local_auth=${encodeURIComponent(result.sessionToken)}`,
    `senhahub_local_csrf=${encodeURIComponent(result.csrfToken)}`
  ].join("; ");
}

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
