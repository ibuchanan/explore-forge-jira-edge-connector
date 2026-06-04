# JEC Receiver

On-premise Python action script and JEC configuration for the [JEC Event Bridge Forge app](../../apps/dispatcher/). When the Forge app dispatches a task, the Jira Edge Connector (JEC) binary invokes `receiver.py` as an OS process. This sample appends each event to a local JSONL log as a stand-in for a real message queue.

## Quick verification

Run the script directly — no live JEC needed:

```bash
chmod +x receiver.py
python3 receiver.py \
  --payload '{"taskId":"test-1","taskType":"demo","context":"test","channelId":"sim-abc"}' \
  --apiKey "test-key" \
  --jsmUrl "https://api.atlassian.com" \
  --logLevel INFO
```

Then check the output log (default path):

```bash
cat /var/log/jec/receiver-events.jsonl
```

## Files

| File | Purpose |
| --- | --- |
| `receiver.py` | Python script invoked by JEC as an OS process |
| `jec-config.example.json` | JEC binary configuration template (copy to `jec-config.json` and fill in secrets) |
| `jec-config.json` | Your local JEC config with real API key — **not checked in** |

## Customer setup

### 1. Install JEC

Follow Atlassian's official [Install Jira Edge Connector](https://support.atlassian.com/jira-service-management-cloud/docs/install-jira-edge-connector/) guide for the latest packages and platform notes.

JEC is distributed as OS-specific installation packages. Atlassian currently documents support for Debian-based Linux, Red Hat-based Linux, and Windows Server environments.

1. Download the latest JEC package from Atlassian's `jsm-integration-scripts` repository, as linked from the official install guide.
2. Install the package for your platform:

   ```bash
   # Debian-based distributions
   sudo dpkg -i <your-package-name>.deb

   # Red Hat-based distributions
   sudo rpm -i <your-package-name>.rpm
   ```

3. On Windows:
   1. Extract the JEC zip file into a folder.
   2. Rename `jecService.json.example` to `jecService<32|64>.json`.
   3. Set `JECPath` in that service file to the extracted `JiraEdgeConnector<32|64>.exe` path.
   4. Install the Windows service:

      ```powershell
      jecService<32|64>.exe install
      ```

### 2. Configure this receiver

See Atlassian's [Configure Jira Edge Connector](https://support.atlassian.com/jira-service-management-cloud/docs/configure-jira-edge-connector/) guide for the full configuration reference. For this sample, copy the example and fill in your secrets:

```bash
cp jec-config.example.json jec-config.json
mkdir -p /var/log/jec
chmod +x receiver.py
```

Then edit `jec-config.json`:

```json
{
  "apiKey": "<paste-api-key-from-forge-app-channel-setup>",
  "baseUrl": "https://api.atlassian.com",
  "logLevel": "INFO",
  "actionMappings": {
    "dispatchTask": {
      "sourceType": "local",
      "filepath": "/absolute/path/to/receiver.py",
      "env": ["JEC_RECEIVER_LOG=/var/log/jec/receiver-events.jsonl"],
      "stdout": "/var/log/jec/receiver.out.txt",
      "stderr": "/var/log/jec/receiver.err.txt",
      "flags": {
        "payload":  "{{.Payload}}",
        "apiKey":   "{{.ApiKey}}",
        "jsmUrl":   "{{.JsmUrl}}",
        "logLevel": "{{.LogLevel}}"
      }
    }
  }
}
```

The `apiKey` value comes from the Forge app's **Channel Setup** panel after provisioning. The `actionMappings` key `dispatchTask` must match what the Forge app sends as the `action` field.

### 3. Point JEC at the config file

JEC reads its config from environment variables. For a local config file, set:

```bash
export JEC_CONF_SOURCE_TYPE=local
export JEC_CONF_LOCAL_FILEPATH="/absolute/path/to/jec-config.json"
```

For service-based installs, add those environment variables to the service configuration. Atlassian's [Run Jira Edge Connector](https://support.atlassian.com/jira-service-management-cloud/docs/run-jira-edge-connector) guide includes service examples for Windows and Linux.

### 4. Ensure the named pipe directory exists

JEC creates a named pipe under `/var/tmp/jec/` to receive the result back from `receiver.py`. This directory must exist before JEC starts — if it is missing, the callback write fails and the Forge app will not see a successful result.

```bash
mkdir -p /var/tmp/jec
```

If you run JEC via a wrapper script or service, add this `mkdir -p` call there so it is recreated automatically on startup (the directory may not survive a reboot on some systems).

### 5. Start JEC

```bash
JiraEdgeConnector
```

If your package installs the binary under a different name or location, use that installed path instead. JEC will poll the JSM Ops queue and invoke `receiver.py` when a task is dispatched from the Forge app.

### 6. Verify it is working

Trigger a health check from the Forge app's **Admin status page**. Then check two places:

**`receiver.err.txt`** (path set by `stderr` in `jec-config.json`) — a successful run ends with:

```text
INFO JEC receiver started: jsmUrl=https://api.atlassian.com
INFO Event appended to log: taskId=<uuid>
INFO Writing result to named pipe: /var/tmp/jec/jecCallbackPipe-<uuid>
INFO JEC receiver completed successfully: taskId=<uuid>
```

**`receiver-events.jsonl`** (path set by `JEC_RECEIVER_LOG`) — each successfully received task appends one JSON line:

```jsonl
{"taskId": "<uuid>", "taskType": "Health check test task", "context": "Sent from admin status page to verify receiver is configured.", ...}
```

If `receiver.err.txt` shows `Failed to write to named pipe: [Errno 2] No such file or directory`, the `/var/tmp/jec/` directory is missing — create it and re-trigger the health check (no JEC restart needed).

### 7. Replace the log append with your integration

In `receiver.py`, find the `append_to_log()` function and replace the file-write with your actual integration:

```python
def append_to_log(payload: dict) -> None:
    # Replace this with your real integration.
    publish_event(payload)
```

## Reference

### JEC invocation contract

JEC passes the following CLI flags when it invokes the script:

| Flag | Required | Description |
| --- | --- | --- |
| `--payload` | Yes | JSON string — the `details` map from `SendJecActionDto` |
| `--apiKey` | Yes | JEC API key (treat as secret) |
| `--jsmUrl` | Yes | JSM base URL (`https://api.atlassian.com`) |
| `--logLevel` | Yes | Log level string |
| `--jecNamedPipe` | No | Named pipe path for returning result to JEC |

The `--payload` JSON contains:

```json
{
  "taskId": "...",
  "taskType": "...",
  "context": "...",
  "channelId": "...",
  "dispatchedAt": "..."
}
```

### How it works

1. The Forge dispatcher app provisions a JEC channel via the JSM Ops API.
2. When a task is dispatched, the Forge app calls `POST /v1/jec/action?channelId={channelId}`.
3. JEC polls its queue, receives the action, and invokes `receiver.py` as an OS process.
4. `receiver.py` appends a structured event to a local log file (stand-in for a real message queue).
5. If `--jecNamedPipe` is provided, the script writes a JSON result back to JEC via the named pipe.

## Using this repo as a Git source for JEC

JEC supports sourcing action scripts from Git. Point JEC at this repository and set `sourceType: git` in your `jec-config.json`. The `apps/receiver/` directory can serve as the Git source for a real reference deployment.
