import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

import { sessionOptions, type SessionData } from "./session";

export type Role = "indexer" | "publisher";

export const ROLES: readonly Role[] = ["indexer", "publisher"] as const;

export function isRole(value: unknown): value is Role {
  return value === "indexer" || value === "publisher";
}

export function roleHomeHref(role: Role): string {
  return role === "publisher" ? "/publisher/radar" : "/dashboard";
}

export async function getPreferredRole(): Promise<Role | null> {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  return session.preferredRole ?? null;
}
