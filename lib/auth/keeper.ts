// Shared-secret auth for the settlement keeper / on-chain indexer when it
// writes server-to-server (e.g. filling pb_earnings from real fee events).
// Mirrors the CRON_SECRET pattern already used by the snapshot cron.
//
// The keeper path is DISABLED unless KEEPER_SECRET is configured, so a missing
// env var can never silently open the write path. The pure check lives in
// ./keeperPolicy.ts for unit tests.

import "server-only";

import type { NextRequest } from "next/server";

import { KEEPER_SECRET_HEADER, keeperSecretValid } from "./keeperPolicy";

export { KEEPER_SECRET_HEADER, keeperSecretValid } from "./keeperPolicy";

export function isKeeperRequest(req: NextRequest): boolean {
  return keeperSecretValid(
    req.headers.get(KEEPER_SECRET_HEADER),
    process.env.KEEPER_SECRET,
  );
}
