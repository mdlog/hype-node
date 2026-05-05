import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { isRole, roleHomeHref } from "@/lib/auth/role";
import { sessionOptions, type SessionData } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Accepts both JSON (from RoleSwitcher fetch) and form-encoded (from the
// landing page <form> tombol). Form posts get a 303 redirect so the no-JS
// path lands on the role's home; JSON posts get a JSON ack.
export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  let role: unknown;
  let redirect: string | null = null;
  let isForm = false;

  if (ct.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as {
      role?: unknown;
      redirect?: unknown;
    };
    role = body.role;
    redirect = typeof body.redirect === "string" ? body.redirect : null;
  } else {
    isForm = true;
    const form = await req.formData();
    role = form.get("role");
    const r = form.get("redirect");
    redirect = typeof r === "string" ? r : null;
  }

  if (!isRole(role)) {
    return NextResponse.json(
      { ok: false, error: "role must be 'indexer' or 'publisher'" },
      { status: 400 },
    );
  }

  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  session.preferredRole = role;
  await session.save();

  // Only honour same-origin path redirects to avoid open-redirect abuse.
  const safeRedirect =
    redirect && redirect.startsWith("/") && !redirect.startsWith("//")
      ? redirect
      : roleHomeHref(role);

  if (isForm) {
    // 303 forces the browser to follow with GET — correct for POST → page.
    return NextResponse.redirect(new URL(safeRedirect, req.url), { status: 303 });
  }
  return NextResponse.json({ ok: true, role, redirect: safeRedirect });
}
