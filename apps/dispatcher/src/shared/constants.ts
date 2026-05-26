export const TASK_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const MAX_RECENT_TASKS = 25;

export const STORE_KEYS = {
  setup: "setup:current",
  taskIndex: "task:index",
  taskProjection: (taskId: string) => `task:${taskId}:projection`,
  taskEvents: (taskId: string) => `task:${taskId}:events`,
};
