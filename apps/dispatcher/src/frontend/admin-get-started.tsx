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

type ResolverResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

type HealthCheck = {
  configured: { ok: boolean; detail: string };
  receiver: { ok: boolean; detail: string };
  usage: { ok: boolean; detail: string };
};

const cardStyles = xcss({
  borderWidth: "border.width",
  borderStyle: "solid",
  borderColor: "color.border",
  borderRadius: "radius.small",
  padding: "space.200",
});

const checksFrom = (health: HealthCheck) => [
  { label: "1. Provision a dispatcher channel", ...health.configured },
  { label: "2. Configure and start the receiver", ...health.receiver },
  { label: "3. Dispatch from the app page", ...health.usage },
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
        setError(response.error || "Could not load setup checklist.");
        return;
      }
      setHealth(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
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
      <Heading as="h1">Get started with JEC Event Bridge</Heading>
      <Text>
        This integration is back-end heavy, so onboarding happens through admin
        setup rather than inside an issue. Complete these steps before users try
        to dispatch work.
      </Text>

      {error && (
        <SectionMessage appearance="error" title="Could not load checklist">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {!loading && allOk && (
        <SectionMessage appearance="success" title="Ready to dispatch">
          <Text>The dispatcher channel exists and the usage page is unblocked.</Text>
        </SectionMessage>
      )}

      {loading ? (
        <Text>Loading checklist…</Text>
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
          {loading ? "Checking…" : "Refresh checks"}
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
