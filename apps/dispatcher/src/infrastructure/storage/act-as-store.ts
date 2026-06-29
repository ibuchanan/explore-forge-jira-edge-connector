import { kvs } from "@forge/kvs";
import { STORE_KEYS } from "../../shared/constants";

export async function getActAsAccountId(): Promise<string | null> {
  return ((await kvs.get(STORE_KEYS.actAs)) as string | undefined) ?? null;
}

export async function saveActAsAccountId(accountId: string): Promise<void> {
  await kvs.set(STORE_KEYS.actAs, accountId);
}

export async function deleteActAsAccountId(): Promise<void> {
  await kvs.delete(STORE_KEYS.actAs);
}
