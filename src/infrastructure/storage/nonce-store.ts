import { kvs } from "@forge/kvs";
import { NONCE_RETENTION_MS, STORE_KEYS } from "../../shared/constants";

export async function assertNonceUnused(
  nonce: string,
  nowIso: string,
): Promise<void> {
  const existing = await kvs.get(STORE_KEYS.nonce(nonce));

  if (existing) {
    throw new Error("Callback nonce has already been used.");
  }

  await kvs.set(STORE_KEYS.nonce(nonce), {
    nonce,
    usedAt: nowIso,
    expiresAt: new Date(Date.parse(nowIso) + NONCE_RETENTION_MS).toISOString(),
  });
}
