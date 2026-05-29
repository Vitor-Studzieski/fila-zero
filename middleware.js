import { NextResponse } from "next/server";

const protectedPages = new Set(["/", "/attendant", "/admin"]);

export function middleware(request) {
  const { pathname } = request.nextUrl;
  if (!protectedPages.has(pathname)) return NextResponse.next();

  const hasSession = Boolean(request.cookies.get("fz_auth")?.value);
  if (hasSession) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/", "/attendant", "/admin"]
};
