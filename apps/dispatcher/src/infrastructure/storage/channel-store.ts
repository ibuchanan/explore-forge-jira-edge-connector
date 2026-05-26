import { kvs } from "@forge/kvs";
import { STORE_KEYS } from "../../shared/constants";

export interface ChannelSetup {
  channelId: string;
  apiKey: string;
  mode: "jec" | "simulator";
  provisionedAt: string;
  note: string;
}

export async function getChannelSetup(): Promise<ChannelSetup | null> {
  return (
    ((await kvs.get(STORE_KEYS.setup)) as ChannelSetup | undefined) || null
  );
}

export async function saveChannelSetup(
  setup: ChannelSetup,
): Promise<ChannelSetup> {
  await kvs.set(STORE_KEYS.setup, setup);
  return setup;
}
