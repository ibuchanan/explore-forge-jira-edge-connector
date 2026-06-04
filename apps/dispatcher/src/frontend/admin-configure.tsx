import { invoke } from "@forge/bridge";
import ForgeReconciler, {
  Badge,
  Button,
  Heading,
  Inline,
  Label,
  LoadingButton,
  RadioGroup,
  SectionMessage,
  Stack,
  Text,
  Textfield,
} from "@forge/react";
import React, { useCallback, useEffect, useState } from "react";

type TaskMode = "simulator" | "jec";

type ChannelSetup = {
  apiKey: string;
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

type ConfigStatus = {
  isConfigured: boolean;
  setup: ChannelSetup | null;
};

const modeOptions = [
  { label: "Simulator (no live JEC required)", value: "simulator" },
  { label: "JEC (real JSM Ops API)", value: "jec" },
];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "An unexpected error occurred.";
}

const App = () => {
  const [status, setStatus] = useState<ConfigStatus>({
    isConfigured: false,
    setup: null,
  });
  const [mode, setMode] = useState<TaskMode>("simulator");
  const [ownerDomain, setOwnerDomain] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await invoke<ResolverResponse<ConfigStatus>>(
        "getConnectionStatus",
        {},
      );
      if (!response.ok) {
        setError(response.error || "Could not load configuration.");
        return;
      }
      const nextStatus = response.data || { isConfigured: false, setup: null };
      setStatus(nextStatus);
      setMode(nextStatus.setup?.mode || "simulator");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const provision = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await invoke<ResolverResponse<{ setup: ChannelSetup }>>(
        "provisionChannel",
        { mode, ...(mode === "jec" ? { ownerDomain } : {}) },
      );
      if (!response.ok || !response.data?.setup) {
        setError(response.error || "Provisioning failed.");
        return;
      }
      setStatus({ isConfigured: true, setup: response.data.setup });
      setMessage(
        mode === "jec"
          ? "JEC channel provisioned. Copy the API key shown above into jec-config.json before starting the receiver."
          : "Simulator channel provisioned. The dispatcher can now be used without a live JEC receiver.",
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [mode, ownerDomain]);

  const reset = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await invoke<ResolverResponse<ConfigStatus>>(
        "resetConnection",
        {},
      );
      if (!response.ok) {
        setError(response.error || "Reset failed.");
        return;
      }
      setStatus(response.data || { isConfigured: false, setup: null });
      setMessage(
        "Configuration cleared. Usage is blocked until a channel is provisioned again.",
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <Stack space="space.300">
      <Text>
        Provision the channel that the dispatcher uses before users can dispatch
        work to the on-premise receiver. Use simulator mode for local demos, or
        JEC mode to create a real JSM Ops channel.
      </Text>

      {error && (
        <SectionMessage appearance="error" title="Configuration error">
          <Text>{error}</Text>
        </SectionMessage>
      )}
      {message && (
        <SectionMessage appearance="success" title="Configuration updated">
          <Text>{message}</Text>
        </SectionMessage>
      )}

      {loading ? (
        <Text>Loading configuration…</Text>
      ) : (
        <Stack space="space.200">
          <Inline space="space.100" alignBlock="center">
            <Text>Status:</Text>
            <Badge appearance={status.isConfigured ? "added" : "removed"}>
              {status.isConfigured ? "Configured" : "Unconfigured"}
            </Badge>
          </Inline>

          {status.setup && (
            <Stack space="space.050">
              <Text>
                Current mode:{" "}
                {status.setup.mode === "jec" ? "JEC" : "Simulator"}
              </Text>
              <Text>Channel ID: {status.setup.channelId}</Text>
              {status.setup.mode === "jec" && (
                <Text>API key: {status.setup.apiKey}</Text>
              )}
              <Text>
                Provisioned:{" "}
                {new Date(status.setup.provisionedAt).toLocaleString()}
              </Text>
              <Text>{status.setup.note}</Text>
            </Stack>
          )}

          <Stack space="space.100">
            <Label labelFor="connection-mode">Connection mode</Label>
            <RadioGroup
              name="connection-mode"
              options={modeOptions}
              value={mode}
              onChange={(event) => setMode(event.target.value as TaskMode)}
            />
          </Stack>

          {mode === "jec" && (
            <Stack space="space.100">
              <Label labelFor="owner-domain">Owner domain</Label>
              <Textfield
                id="owner-domain"
                name="owner-domain"
                placeholder="public_<your-identifier>"
                value={ownerDomain}
                onChange={(event) =>
                  setOwnerDomain(
                    (event.target as EventTarget & { value: string }).value,
                  )
                }
              />
              <Text>
                The public owner domain for the JEC channel (e.g.
                "public_myorg"). Must start with "public_".
              </Text>
            </Stack>
          )}

          <Inline space="space.100">
            <LoadingButton
              appearance="primary"
              isLoading={busy}
              onClick={provision}
            >
              {status.isConfigured
                ? "Re-provision channel"
                : "Provision channel"}
            </LoadingButton>
            <Button isDisabled={busy || !status.isConfigured} onClick={reset}>
              Reset configuration
            </Button>
          </Inline>
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
