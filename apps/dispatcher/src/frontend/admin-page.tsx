import { invoke, router } from "@forge/bridge";
import ForgeReconciler, {
  Badge,
  Box,
  Button,
  Heading,
  Inline,
  SectionMessage,
  Stack,
  Text,
  xcss,
} from "@forge/react";
import React, { useCallback, useEffect, useState } from "react";

type TaskMode = "simulator" | "jec";

type ChannelSetup = {
  channelId: string;
  mode: TaskMode;
  provisionedAt: string;
  note: string;
};

type ResolverResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

type HealthCheck = {
  configured: { ok: boolean; detail: string };
  receiver: { ok: boolean; detail: string };
  usage: { ok: boolean; detail: string };
  setup: ChannelSetup | null;
};

const cardStyles = xcss({
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border",
  borderRadius: "radius.small",
  padding: "space.200",
});

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "An unexpected error occurred.";
}

const checksFrom = (health: HealthCheck) => [
  { label: "Channel configuration", ...health.configured },
  { label: "Receiver setup", ...health.receiver },
  { label: "Usage gate", ...health.usage },
];

const App = () => {
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runChecks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await invoke<ResolverResponse<HealthCheck>>(
        "getConnectionHealth",
        {},
      );
      if (!response.ok || !response.data) {
        setError(response.error || "Could not run status checks.");
        return;
      }
      setHealth(response.data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  const checks = health ? checksFrom(health) : [];
  const allOk = checks.every((check) => check.ok);

  return (
    <Stack space="space.300">
      <Heading as="h1">JEC Event Bridge Status</Heading>
      <Text>
        Admin status for the dispatcher channel, receiver setup, and whether the
        main usage screen is currently open or blocked.
      </Text>

      {error && (
        <SectionMessage appearance="error" title="Status check failed">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {!loading && health && (
        <SectionMessage
          appearance={allOk ? "success" : "warning"}
          title={allOk ? "Dispatcher is ready" : "Action needed"}
        >
          <Text>
            {allOk
              ? "Users can dispatch work from the JEC Event Bridge page."
              : "Configure a channel before users try to dispatch work."}
          </Text>
        </SectionMessage>
      )}

      {loading ? (
        <Text>Running checks…</Text>
      ) : (
        <Stack space="space.100">
          {checks.map((check) => (
            <Box key={check.label} xcss={cardStyles}>
              <Inline space="space.150" alignBlock="start">
                <Badge appearance={check.ok ? "added" : "removed"}>
                  {check.ok ? "OK" : "Action needed"}
                </Badge>
                <Stack space="space.0">
                  <Text weight="medium">{check.label}</Text>
                  <Text color="color.text.subtle">{check.detail}</Text>
                </Stack>
              </Inline>
            </Box>
          ))}
        </Stack>
      )}

      <Inline space="space.100">
        <Button
          appearance="primary"
          onClick={() =>
            void router.navigate({
              target: "module",
              moduleKey: "jec-event-bridge-configure-page",
            })
          }
        >
          Configure App
        </Button>
        <Button appearance="subtle" isDisabled={loading} onClick={runChecks}>
          {loading ? "Checking…" : "Refresh"}
        </Button>
      </Inline>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
