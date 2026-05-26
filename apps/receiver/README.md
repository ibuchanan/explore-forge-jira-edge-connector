# JEC Receiver

On-premise assets for the JEC Event Bridge Forge app. This directory contains the Python action script that the JEC binary invokes, plus the JEC configuration file.

## Contents

| File | Purpose |
|---|---|
| `receiver.py` | Python script invoked by JEC as an OS process |
| `jec-config.json` | JEC binary configuration (action mappings, poller settings) |

## How it works

1. The Forge dispatcher app provisions a JEC channel via the JSM Ops API.
2. When a task is dispatched, the Forge app calls `POST /v1/jec/action?channelId={channelId}`.
3. JEC polls its queue, receives the action, and invokes `receiver.py` as an OS process.
4. `receiver.py` appends a structured event to a local log file (stand-in for a real message queue).
5. If `--jecNamedPipe` is provided, the script writes a JSON result back to JEC.

## JEC invocation contract

JEC passes the following CLI flags when it invokes the script:

| Flag | Required | Description |
|---|---|---|
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

## Customer setup

### 1. Install JEC

Download and install the JEC binary from your JSM instance. See the [Atlassian documentation](https://support.atlassian.com/jira-service-management-cloud/docs/set-up-jira-edge-connector/) for platform-specific instructions.

### 2. Configure JEC

Edit `jec-config.json`:

```json
{
  "apiKey": "<paste-api-key-from-forge-app-channel-setup>",
  "baseUrl": "https://api.atlassian.com",
  ...
  "actionMappings": {
    "dispatchTask": {
      "sourceType": "local",
      "filepath": "/absolute/path/to/receiver.py",
      ...
    }
  }
}
```

The `apiKey` value comes from the Forge app's **Channel Setup** panel after provisioning. The `actionMappings` key `dispatchTask` must match what the Forge app sends as the `action` field.

### 3. Set the receiver log path (optional)

By default, events are appended to `/var/log/jec/receiver-events.jsonl`. Override this with:

```bash
export JEC_RECEIVER_LOG=/your/preferred/path/receiver-events.jsonl
```

### 4. Replace log append with your integration

In `receiver.py`, find the `append_to_log()` function and replace the file-write with your actual integration:

```python
def append_to_log(payload: dict) -> None:
    # Replace this with your real integration:
    kafka_producer.publish("jec-tasks", payload)
```

### 5. Start JEC

```bash
jec -conf /path/to/jec-config.json
```

JEC will poll the JSM Ops queue and invoke `receiver.py` when a task is dispatched from the Forge app.

## Using this repo as a Git source for JEC

JEC supports sourcing action scripts from Git. Point JEC at this repository and set `sourceType: git` in your `jec-config.json`. The `apps/receiver/` directory can serve as the Git source for a real reference deployment.

## Local testing

Run the script directly to verify it works without a live JEC:

```bash
python3 receiver.py \
  --payload '{"taskId":"test-1","taskType":"demo","context":"test","channelId":"sim-abc"}' \
  --apiKey "test-key" \
  --jsmUrl "https://api.atlassian.com" \
  --logLevel INFO
```

Check the output log:

```bash
cat /var/log/jec/receiver-events.jsonl
```
