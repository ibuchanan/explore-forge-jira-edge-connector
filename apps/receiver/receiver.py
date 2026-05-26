#!/usr/bin/env python3
"""
JEC receiver script — invoked by the JEC binary as an OS process.

JEC passes the following CLI flags when it invokes this script:
  --payload        JSON string (deserialised SendJecActionDto.details)
  --apiKey         JEC API key (treat as secret)
  --jsmUrl         JSM base URL (https://api.atlassian.com)
  --logLevel       Log level string (INFO, DEBUG, etc.)
  --jecNamedPipe   Path to named pipe for writing result back to JEC (optional)

The script:
  1. Parses CLI flags with argparse
  2. Deserialises --payload as JSON
  3. Validates required payload fields (taskId, taskType)
  4. Appends a structured event to a local log file
     ← In a real deployment, replace this with publish_to_kafka() or equivalent
  5. If --jecNamedPipe is present, writes a JSON result to the pipe

Exit codes:
  0  Success
  1  Validation or processing error
"""

import argparse
import json
import logging
import os
import sys
from datetime import UTC, datetime

LOG_FILE = os.environ.get("JEC_RECEIVER_LOG", "/var/log/jec/receiver-events.jsonl")
REQUIRED_PAYLOAD_FIELDS = ["taskId", "taskType"]


def configure_logging(log_level: str) -> None:
    numeric = getattr(logging, log_level.upper(), logging.INFO)
    logging.basicConfig(
        level=numeric,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stderr,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="JEC receiver script for the Forge dispatcher exemplar."
    )
    parser.add_argument("--payload", required=True, help="JSON task payload from JEC")
    parser.add_argument("--apiKey", required=True, help="JEC API key")
    parser.add_argument("--jsmUrl", required=True, help="JSM base URL")
    parser.add_argument("--logLevel", required=True, help="Log level")
    parser.add_argument(
        "--jecNamedPipe",
        required=False,
        default=None,
        help="Named pipe path for returning result to JEC",
    )
    return parser.parse_args()


def validate_payload(payload: dict) -> None:
    """Raise ValueError if any required fields are missing from the payload."""
    missing = [f for f in REQUIRED_PAYLOAD_FIELDS if f not in payload]
    if missing:
        raise ValueError(f"Payload is missing required fields: {', '.join(missing)}")


def append_to_log(payload: dict) -> None:
    """
    Append a structured event to the local log file.

    In a real customer deployment, replace this function body with:
        kafka_producer.publish("jec-tasks", payload)
    or equivalent integration with your messaging or workflow system.
    """
    event = {
        "receivedAt": datetime.now(UTC).isoformat(),
        "taskId": payload.get("taskId"),
        "taskType": payload.get("taskType"),
        "context": payload.get("context"),
        "channelId": payload.get("channelId"),
        "payload": payload,
    }

    log_dir = os.path.dirname(LOG_FILE)
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)

    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(event) + "\n")

    logging.info("Event appended to log: taskId=%s", payload.get("taskId"))


def write_named_pipe_result(pipe_path: str, task_id: str) -> None:
    """
    Write a JSON result to the JEC named pipe.

    JEC creates the named pipe at the path given in --jecNamedPipe. Writing
    to this pipe signals that the script has finished processing. On Enterprise
    JSM plans, the triggering flow can await this result for up to 15 minutes.

    Note: The exact JSON schema JEC expects is not formally documented. The
    sample uses {"result": "success", "taskId": "..."} — tune as needed.
    """
    result = json.dumps({"result": "success", "taskId": task_id})
    logging.info("Writing result to named pipe: %s", pipe_path)
    with open(pipe_path, "w", encoding="utf-8") as pipe:
        pipe.write(result)


def main() -> int:
    args = parse_args()
    configure_logging(args.logLevel)

    logging.info("JEC receiver started: jsmUrl=%s", args.jsmUrl)

    try:
        payload = json.loads(args.payload)
    except json.JSONDecodeError as exc:
        logging.error("Failed to parse --payload as JSON: %s", exc)
        return 1

    try:
        validate_payload(payload)
    except ValueError as exc:
        logging.error("Payload validation failed: %s", exc)
        return 1

    try:
        append_to_log(payload)
    except OSError as exc:
        logging.error("Failed to append event to log: %s", exc)
        return 1

    if args.jecNamedPipe:
        try:
            write_named_pipe_result(args.jecNamedPipe, payload["taskId"])
        except OSError as exc:
            logging.error("Failed to write to named pipe: %s", exc)
            return 1

    logging.info("JEC receiver completed successfully: taskId=%s", payload.get("taskId"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
