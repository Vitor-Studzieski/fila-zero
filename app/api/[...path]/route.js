import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function route(request) {
  if (process.env.DATA_BACKEND === "supabase") {
    const runtime = await import("../../../server/supabase-runtime.js");
    return runtime.default?.handleRequest
      ? runtime.default.handleRequest(request)
      : runtime.handleRequest(request);
  }

  const backend = await import("../../../server/server.js");
  const body = ["GET", "HEAD"].includes(request.method) ? "" : await request.text();
  const url = new URL(request.url);
  const nodeReq = Readable.from(body ? [body] : []);
  nodeReq.method = request.method;
  nodeReq.url = `${url.pathname}${url.search}`;
  nodeReq.headers = Object.fromEntries(request.headers.entries());

  const response = await handleWithNodeResponse(nodeReq, url);
  return response;
}

function handleWithNodeResponse(nodeReq, url) {
  return new Promise((resolve) => {
    const chunks = [];
    const responseHeaders = new Map();
    const headers = new Headers();
    const nodeRes = {
      statusCode: 200,
      setHeader(name, value) {
        const key = name.toLowerCase();
        responseHeaders.set(key, value);
        if (key === "set-cookie" && Array.isArray(value)) {
          headers.delete("set-cookie");
          value.forEach((cookie) => headers.append("set-cookie", cookie));
          return;
        }
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      },
      getHeader(name) {
        return responseHeaders.get(name.toLowerCase()) || headers.get(name);
      },
      writeHead(status, nextHeaders = {}) {
        this.statusCode = status;
        Object.entries(nextHeaders).forEach(([name, value]) => headers.set(name, value));
      },
      write(chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      },
      end(chunk = "") {
        if (chunk) this.write(chunk);
        resolve(new Response(Buffer.concat(chunks), { status: this.statusCode, headers }));
      }
    };

    Promise.resolve((backend.default || backend).handleApi(nodeReq, nodeRes, url)).catch((error) => {
      console.error(error);
      headers.set("content-type", "application/json; charset=utf-8");
      resolve(new Response(JSON.stringify({ error: "Erro interno do servidor." }), { status: 500, headers }));
    });
  });
}

export const GET = route;
export const POST = route;
export const PUT = route;
export const DELETE = route;
