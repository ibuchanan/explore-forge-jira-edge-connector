import { invoke, router } from "@forge/bridge";
import ForgeReconciler, {
  Badge,
  Box,
  Button,
  ButtonGroup,
  Heading,
  Inline,
  Label,
  LoadingButton,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  Textfield,
  xcss,
} from "@forge/react";
import React, { useCallback, useEffect, useState } from "react";

type TaskMode = "simulator" | "jec";

type Task = {
  id: string;
  name: string;
  context: string;
  mode: TaskMode;
  channelId: string;
  status: "pending" | "dispatched" | "dispatch_failed" | "expired";
  createdAt: string;
  updatedAt: string;
  lastEventType: string;
  lastMessage: string;
};

type TaskEvent = {
  id: string;
  taskId: string;
  type: string;
  createdAt: string;
  status?: string;
  message?: string;
  channelId?: string;
  mode?: string;
};

type ChannelSetup = {
  channelId: string;
  apiKey: string;
  mode: TaskMode;
  provisionedAt: string;
  note: string;
};

const CONFIGURE_MODULE_KEY = "jec-event-bridge-configure-page";

type TaskDetail = {
  task: Task;
  events: TaskEvent[];
};

type ResolverResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

// Maps task/event status to Badge appearance and label.
// Badge appearances: default | primary | added | removed | important | information | success | danger | neutral | inverse | primaryInverted | discovery | warning
const statusAppearance: Record<
  string,
  {
    appearance:
      | "default"
      | "primary"
      | "added"
      | "removed"
      | "important"
      | "information"
      | "success"
      | "danger"
      | "neutral"
      | "inverse";
    label: string;
  }
> = {
  pending: { appearance: "default", label: "Pending" },
  dispatched: { appearance: "added", label: "Dispatched" },
  dispatch_failed: { appearance: "removed", label: "Dispatch Failed" },
  expired: { appearance: "default", label: "Expired" },
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "An unexpected error occurred.";
}

function getResponseData<T>(response: ResolverResponse<T>, fallback: T): T {
  if (response.ok && response.data !== undefined) {
    return response.data;
  }
  return fallback;
}

const cardStyles = xcss({
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border",
  borderRadius: "radius.small",
  padding: "space.200",
});

const App = () => {
  const [setup, setSetup] = useState<ChannelSetup | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);
  const [taskName, setTaskName] = useState("");
  const [taskContext, setTaskContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadSetup = useCallback(async () => {
    try {
      const response = await invoke<
        ResolverResponse<{ setup: ChannelSetup | null }>
      >("getSetupStatus", {});
      const data = getResponseData(response, { setup: null });
      setSetup(data.setup);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const response = await invoke<ResolverResponse<{ tasks: Task[] }>>(
        "listTasks",
        {},
      );
      const data = getResponseData(response, { tasks: [] });
      setTasks(data.tasks);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadSetup();
    void loadTasks();
  }, [loadSetup, loadTasks]);

  const handleCreateTask = useCallback(async () => {
    if (!taskName.trim()) {
      setError("Task name is required.");
      return;
    }
    if (!setup) {
      setError("Configuration is required before dispatching work.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await invoke<ResolverResponse<{ task: Task }>>(
        "createTask",
        {
          name: taskName,
          context: taskContext,
          mode: setup.mode,
        },
      );
      if (!response.ok) {
        setError(response.error || "Task creation failed.");
      } else {
        setTaskName("");
        setTaskContext("");
        setSuccessMessage(`Task "${response.data?.task.name}" dispatched.`);
        await loadTasks();
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [taskName, taskContext, setup, loadTasks]);

  const handleViewTask = useCallback(async (taskId: string) => {
    setError(null);
    try {
      const response = await invoke<
        ResolverResponse<{ detail: TaskDetail | null }>
      >("getTask", { taskId });
      const data = getResponseData(response, { detail: null });
      setSelectedTask(data.detail);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  const statusInfo = (status: string) =>
    statusAppearance[status] || {
      appearance: "default" as const,
      label: status,
    };

  return (
    <Stack space="space.300">
      <Heading as="h1">JEC Event Bridge</Heading>
      <Text>
        Dispatch on-premise tasks via the Jira Edge Connector (JEC) using the
        JSM Ops REST API. Use Simulator mode for local development — no live JEC
        installation required.
      </Text>

      {error && (
        <SectionMessage appearance="error" title="Error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {successMessage && (
        <SectionMessage appearance="information" title="Success">
          <Text>{successMessage}</Text>
        </SectionMessage>
      )}

      {/* Channel Setup */}
      <Box xcss={cardStyles}>
        <Stack space="space.200">
          <Heading as="h2">Channel Setup</Heading>

          {setup ? (
            <Stack space="space.100">
              <Inline space="space.100" alignBlock="center">
                <Text>Mode:</Text>
                <Badge
                  appearance={setup.mode === "jec" ? "primary" : "default"}
                >
                  {setup.mode === "jec" ? "JEC" : "Simulator"}
                </Badge>
              </Inline>
              <Text>Channel ID: {setup.channelId}</Text>
              <Text>
                Provisioned: {new Date(setup.provisionedAt).toLocaleString()}
              </Text>
              <Text>{setup.note}</Text>
              {setup.mode === "jec" && (
                <SectionMessage appearance="information" title="Receiver setup">
                  <Text>
                    Copy this API key into your jec-config.json under the
                    channel&apos;s apiKey field, then start the JEC binary: {setup.apiKey}
                  </Text>
                </SectionMessage>
              )}
              <Button
                appearance="subtle"
                onClick={() =>
                  void router.navigate({
                    target: "module",
                    moduleKey: CONFIGURE_MODULE_KEY,
                  })
                }
              >
                Manage configuration
              </Button>
            </Stack>
          ) : (
            <SectionMessage appearance="warning" title="Configuration required">
              <Stack space="space.100">
                <Text>
                  Dispatching is blocked until an admin provisions a simulator or
                  JEC channel. This avoids creating tasks that cannot reach the
                  on-premise receiver.
                </Text>
                <Button
                  appearance="primary"
                  onClick={() =>
                    void router.navigate({
                      target: "module",
                      moduleKey: CONFIGURE_MODULE_KEY,
                    })
                  }
                >
                  Configure App
                </Button>
              </Stack>
            </SectionMessage>
          )}
        </Stack>
      </Box>

      {/* Dispatch Task */}
      <Box xcss={cardStyles}>
        <Stack space="space.200">
          <Heading as="h2">Dispatch Task</Heading>
          <Text>
            Creates a task record and dispatches it to{" "}
            {setup?.mode === "jec" ? "JEC via JSM Ops API" : "the simulator"}.
          </Text>
          <Stack space="space.100">
            <Label labelFor="task-name">Task name</Label>
            <Textfield
              id="task-name"
              name="task-name"
              value={taskName}
              onChange={(e) =>
                setTaskName((e.target as EventTarget & { value: string }).value)
              }
              placeholder="e.g. Generate report"
            />
          </Stack>
          <Stack space="space.100">
            <Label labelFor="task-context">Context (optional)</Label>
            <Textfield
              id="task-context"
              name="task-context"
              value={taskContext}
              onChange={(e) =>
                setTaskContext(
                  (e.target as EventTarget & { value: string }).value,
                )
              }
              placeholder="e.g. Q1 sales data"
            />
          </Stack>
          <ButtonGroup>
            <LoadingButton
              appearance="primary"
              isDisabled={!setup}
              isLoading={loading}
              onClick={handleCreateTask}
            >
              Dispatch Task
            </LoadingButton>
            <Button onClick={() => void loadTasks()}>Refresh</Button>
          </ButtonGroup>
        </Stack>
      </Box>

      {/* Task List */}
      <Box xcss={cardStyles}>
        <Stack space="space.200">
          <Heading as="h2">Tasks ({tasks.length})</Heading>
          {tasks.length === 0 ? (
            <Text>No tasks yet. Dispatch a task above to get started.</Text>
          ) : (
            <Stack space="space.100">
              {tasks.map((task) => {
                const si = statusInfo(task.status);
                return (
                  <Box key={task.id} xcss={cardStyles}>
                    <Inline spread="space-between" alignBlock="center">
                      <Stack space="space.050">
                        <Inline space="space.100" alignBlock="center">
                          <Text>{task.name}</Text>
                          <Badge appearance={si.appearance}>{si.label}</Badge>
                          <Badge appearance="default">
                            {task.mode === "jec" ? "JEC" : "Sim"}
                          </Badge>
                        </Inline>
                        <Text>{task.lastMessage}</Text>
                        <Text>
                          Created: {new Date(task.createdAt).toLocaleString()}
                        </Text>
                      </Stack>
                      <Button onClick={() => void handleViewTask(task.id)}>
                        View
                      </Button>
                    </Inline>
                  </Box>
                );
              })}
            </Stack>
          )}
        </Stack>
      </Box>

      {/* Task Detail */}
      {selectedTask && (
        <Box xcss={cardStyles}>
          <Stack space="space.200">
            <Inline spread="space-between" alignBlock="center">
              <Heading as="h2">Task Detail</Heading>
              <Button onClick={() => setSelectedTask(null)}>Close</Button>
            </Inline>
            <Stack space="space.100">
              <Text>ID: {selectedTask.task.id}</Text>
              <Text>Name: {selectedTask.task.name}</Text>
              <Text>Context: {selectedTask.task.context}</Text>
              <Inline space="space.100" alignBlock="center">
                <Text>Status:</Text>
                <Badge
                  appearance={statusInfo(selectedTask.task.status).appearance}
                >
                  {statusInfo(selectedTask.task.status).label}
                </Badge>
              </Inline>
              <Text>Channel: {selectedTask.task.channelId}</Text>
              <Text>Mode: {selectedTask.task.mode}</Text>
            </Stack>

            <Heading as="h3">Event Timeline</Heading>
            {selectedTask.events.length === 0 ? (
              <Text>No events recorded.</Text>
            ) : (
              <Stack space="space.100">
                {selectedTask.events.map((event) => (
                  <Box key={event.id} xcss={cardStyles}>
                    <Stack space="space.050">
                      <Inline space="space.100" alignBlock="center">
                        <Text>{event.type}</Text>
                        {event.status && (
                          <Badge
                            appearance={statusInfo(event.status).appearance}
                          >
                            {statusInfo(event.status).label}
                          </Badge>
                        )}
                      </Inline>
                      {event.message && <Text>{event.message}</Text>}
                      <Text>{new Date(event.createdAt).toLocaleString()}</Text>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
          </Stack>
        </Box>
      )}

      {loading && (
        <Inline alignBlock="center" space="space.100">
          <Spinner size="medium" />
          <Text>Working...</Text>
        </Inline>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
