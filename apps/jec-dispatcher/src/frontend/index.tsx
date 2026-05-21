import { invoke } from "@forge/bridge";
import ForgeReconciler, {
  Button,
  ButtonGroup,
  DynamicTable,
  Heading,
  Inline,
  Label,
  Lozenge,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  TextArea,
  Textfield,
} from "@forge/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

type TaskMode = "simulator" | "jec";
type TaskStatus = "pending" | "running" | "complete" | "failed" | "expired";
type MessageAppearance = "success" | "warning" | "error" | "information";

type ModeOption = { label: string; value: TaskMode };
type UiMessage = { appearance: MessageAppearance; text: string };

type Task = {
  id: string;
  name: string;
  mode: TaskMode;
  channelId: string;
  status: TaskStatus;
  updatedAt: string;
  lastEventType: string;
};

type TaskEvent = {
  id: string;
  createdAt: string;
  type: string;
  status?: string;
  message?: string;
};

type ChannelSetup = {
  channelId: string;
  mode: TaskMode;
  note: string;
};

type TaskDetail = {
  task: Task;
  events: TaskEvent[];
};

type ResolverResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

const modeOptions: ModeOption[] = [
  { label: "Simulator", value: "simulator" },
  { label: "Real JEC adapter seam", value: "jec" },
];

const statusAppearance: Record<
  TaskStatus,
  "default" | "inprogress" | "success" | "removed" | "moved"
> = {
  pending: "default",
  running: "inprogress",
  complete: "success",
  failed: "removed",
  expired: "moved",
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

function getResponseData<T>(response: ResolverResponse<T>, fallback: T): T {
  if (!response || response.ok === false) {
    throw new Error(response?.error || "Resolver request failed.");
  }

  return response.data || fallback;
}

const App = () => {
  const [setup, setSetup] = useState<ChannelSetup | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskDetail, setSelectedTaskDetail] =
    useState<TaskDetail | null>(null);
  const [mode, setMode] = useState<ModeOption>({
    label: "Simulator",
    value: "simulator",
  });
  const [name, setName] = useState("On-premise asset report");
  const [context, setContext] = useState(
    "Example request from the Jira global page",
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const setupResponse = await invoke("getSetupStatus");
      const tasksResponse = await invoke("listReportTasks");
      setSetup(
        getResponseData<{ setup: ChannelSetup | null }>(
          setupResponse as ResolverResponse<{ setup: ChannelSetup | null }>,
          { setup: null },
        ).setup,
      );
      setTasks(
        getResponseData<{ tasks: Task[] }>(
          tasksResponse as ResolverResponse<{ tasks: Task[] }>,
          { tasks: [] },
        ).tasks,
      );
    } catch (error) {
      setMessage({ appearance: "error", text: getErrorMessage(error) });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const provisionChannel = useCallback(async () => {
    setIsBusy(true);
    try {
      const response = await invoke("provisionJecChannel", {
        mode: mode.value,
      });
      const data = getResponseData<{ setup: ChannelSetup }>(
        response as ResolverResponse<{ setup: ChannelSetup }>,
        {
          setup: setup || {
            channelId: "unknown",
            mode: mode.value,
            note: "No setup returned.",
          },
        },
      );
      setSetup(data.setup);
      setMessage({ appearance: "success", text: "Channel setup was saved." });
    } catch (error) {
      setMessage({ appearance: "error", text: getErrorMessage(error) });
    } finally {
      setIsBusy(false);
    }
  }, [mode, setup]);

  const createTask = useCallback(async () => {
    setIsBusy(true);
    try {
      const response = await invoke("createReportTask", {
        name,
        context,
        mode: mode.value,
      });
      const data = getResponseData<{ task: Task }>(
        response as ResolverResponse<{ task: Task }>,
        {
          task: {
            id: "unknown",
            name,
            mode: mode.value,
            channelId: "unknown",
            status: "pending",
            updatedAt: "",
            lastEventType: "",
          },
        },
      );
      setMessage({
        appearance: "success",
        text: `Created task ${data.task.id}.`,
      });
      await refresh();
    } catch (error) {
      setMessage({ appearance: "error", text: getErrorMessage(error) });
    } finally {
      setIsBusy(false);
    }
  }, [context, mode, name, refresh]);

  const viewTask = useCallback(async (taskId: string) => {
    setIsBusy(true);
    try {
      const response = await invoke("getReportTask", { taskId });
      const data = getResponseData<{ detail: TaskDetail | null }>(
        response as ResolverResponse<{ detail: TaskDetail | null }>,
        { detail: null },
      );
      setSelectedTaskDetail(data.detail);
    } catch (error) {
      setMessage({ appearance: "error", text: getErrorMessage(error) });
    } finally {
      setIsBusy(false);
    }
  }, []);

  const completeWithSimulator = useCallback(
    async (taskId: string) => {
      setIsBusy(true);
      try {
        await invoke("runFallbackSimulation", { taskId });
        setMessage({
          appearance: "success",
          text: "Simulator completion event appended.",
        });
        await refresh();
        await viewTask(taskId);
      } catch (error) {
        setMessage({ appearance: "error", text: getErrorMessage(error) });
      } finally {
        setIsBusy(false);
      }
    },
    [refresh, viewTask],
  );

  const taskRows = useMemo(
    () =>
      (tasks || []).map((task) => ({
        key: task.id,
        cells: [
          { key: "id", content: <Text>{task.id}</Text> },
          {
            key: "status",
            content: (
              <Lozenge appearance={statusAppearance[task.status] || "default"}>
                {task.status}
              </Lozenge>
            ),
          },
          { key: "mode", content: <Text>{task.mode}</Text> },
          { key: "updated", content: <Text>{task.updatedAt}</Text> },
          { key: "event", content: <Text>{task.lastEventType}</Text> },
          {
            key: "actions",
            content: (
              <ButtonGroup>
                <Button onClick={() => viewTask(task.id)}>View events</Button>
                <Button
                  onClick={() => completeWithSimulator(task.id)}
                  isDisabled={task.status === "complete"}
                >
                  Simulate complete
                </Button>
              </ButtonGroup>
            ),
          },
        ],
      })),
    [completeWithSimulator, tasks, viewTask],
  );

  const eventRows = useMemo(
    () =>
      (selectedTaskDetail?.events || []).map((event) => ({
        key: event.id,
        cells: [
          { key: "createdAt", content: <Text>{event.createdAt}</Text> },
          { key: "type", content: <Text>{event.type}</Text> },
          {
            key: "status",
            content: <Text>{event.status || "unchanged"}</Text>,
          },
          {
            key: "message",
            content: <Text>{event.message || "No message"}</Text>,
          },
        ],
      })),
    [selectedTaskDetail],
  );

  if (isLoading) {
    return <Spinner />;
  }

  return (
    <Stack space="space.200">
      {message && (
        <SectionMessage appearance={message.appearance}>
          {message.text}
        </SectionMessage>
      )}

      <Stack space="space.100">
        <Heading size="medium">Setup status</Heading>
        <Text>
          {setup
            ? `Channel ${setup.channelId} is provisioned in ${setup.mode} mode.`
            : "No channel has been provisioned yet."}
        </Text>
        {setup && <Text>{setup.note}</Text>}
        <Inline space="space.100" alignBlock="center">
          <Select
            inputId="mode"
            value={mode}
            options={modeOptions}
            onChange={setMode}
          />
          <Button
            appearance="primary"
            onClick={provisionChannel}
            isDisabled={isBusy}
          >
            Provision channel
          </Button>
        </Inline>
      </Stack>

      <Stack space="space.100">
        <Heading size="medium">Create report task</Heading>
        <Label labelFor="report-name">Report name</Label>
        <Textfield
          id="report-name"
          value={name}
          onChange={(event) => setName(String(event.target.value || ""))}
        />
        <Label labelFor="report-context">Report context</Label>
        <TextArea
          id="report-context"
          value={context}
          onChange={(event) => setContext(String(event.target.value || ""))}
        />
        <Button appearance="primary" onClick={createTask} isDisabled={isBusy}>
          Create task
        </Button>
      </Stack>

      <Stack space="space.100">
        <Heading size="medium">Report tasks</Heading>
        <DynamicTable
          head={{
            cells: [
              { key: "id", content: "Task ID" },
              { key: "status", content: "Status" },
              { key: "mode", content: "Mode" },
              { key: "updated", content: "Updated" },
              { key: "event", content: "Last event" },
              { key: "actions", content: "Actions" },
            ],
          }}
          rows={taskRows}
          emptyView={<Text>No report tasks have been created yet.</Text>}
        />
      </Stack>

      {selectedTaskDetail && (
        <Stack space="space.100">
          <Heading size="medium">Task event log</Heading>
          <Text>{selectedTaskDetail.task.name}</Text>
          <DynamicTable
            head={{
              cells: [
                { key: "createdAt", content: "Created" },
                { key: "type", content: "Event type" },
                { key: "status", content: "Status" },
                { key: "message", content: "Message" },
              ],
            }}
            rows={eventRows}
          />
        </Stack>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
