import { NextResponse } from "next/server";

// Same-origin redirect that emits a RELATIVE `Location` header.
//
// Why not `NextResponse.redirect(new URL(path, req.url))`? That bakes the
// request's `Host` into an absolute URL. Behind a reverse proxy / tunnel that
// forwards to an internal port (e.g. localhost:3002) without preserving the
// public `Host` header, `req.url` is the *internal* origin — so the browser
// gets sent to `https://localhost:3002/...` instead of the public domain
// (this bit the post-login role redirect on hypenode.mdloglabs.org).
//
// A relative `Location` ("/dashboard") sidesteps the whole problem: per
// RFC 9110 §10.2.2 the browser resolves it against the effective request URI —
// i.e. the address-bar origin it actually requested, which is always the
// public URL regardless of how many proxies sit in between.
//
// `path` MUST be a same-origin, "/"-prefixed path. A protocol-relative "//host"
// or anything not starting with "/" is rejected (falls back to "/") so this
// can't become an open redirect.
export function relativeRedirect(path: string, status = 303): NextResponse {
  const safe =
    path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return new NextResponse(null, { status, headers: { Location: safe } });
}
