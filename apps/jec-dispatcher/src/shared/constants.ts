export const CALLBACK_KEY_ID =
  process.env.CALLBACK_HMAC_KEY_ID || "development-key";
export const CALLBACK_SECRET =
  process.env.CALLBACK_HMAC_SECRET || "development-only-secret-change-me";

export const CALLBACK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
export const TASK_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const NONCE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const MAX_RECENT_TASKS = 25;

export const STORE_KEYS = {
  setup: "setup:current",
  taskIndex: "task:index",
  taskProjection: (taskId: string) => `task:${taskId}:projection`,
  taskEvents: (taskId: string) => `task:${taskId}:events`,
  nonce: (nonce: string) => `nonce:${nonce}`,
};
