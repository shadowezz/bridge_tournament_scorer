import { NextResponse, type NextRequest } from "next/server";
import { newClientId } from "@/lib/ids";
import { CLIENT_COOKIE } from "@/lib/cookies";

/**
 * Issue an anonymous client id on first contact.
 *
 * This is the only thing gating what a player can see of an in-progress
 * round, so it is set server-side before the first render rather than from
 * the browser, and it is deliberately not httpOnly: the page mirrors it to
 * localStorage so a lost cookie can be restored.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.get(CLIENT_COOKIE)?.value) return NextResponse.next();

  const clientId = newClientId();
  request.cookies.set(CLIENT_COOKIE, clientId);

  const response = NextResponse.next({ request });
  response.cookies.set(CLIENT_COOKIE, clientId, {
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
