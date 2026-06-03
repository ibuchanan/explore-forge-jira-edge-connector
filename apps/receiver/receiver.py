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
  4. Builds a structured event record (pure, no I/O)
  5. Appends the event record to a local log file
     ← In a real deployment, replace this with publish_to_kafka() or equivalent
  6. If --jecNamedPipe is present, writes a JSON result to the pipe

Architecture — Functional Core / Imperative Shell (sans-IO):
  Pure core  — parse_payload(), build_event_record()
               Works on plain values only. No logging, no file I/O, no clock calls.
  I/O shell  — append_to_log(), write_named_pipe_result(), main()
               Performs all side effects; calls core functions and acts on their results.

Exit codes:
  0  Success (including blank payload — logged as warning, skipped)
  1  Validation or processing error
"""

import argparse
import json
import logging
import os
import sys
import threading
from dataclasses import dataclass
from datetime import UTC, datetime

LOG_FILE = os.environ.get("JEC_RECEIVER_LOG", "/var/log/jec/receiver-events.jsonl")
REQUIRED_PAYLOAD_FIELDS = ["taskId", "taskType"]

# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TaskEvent:
    """Validated, immutable representation of a received JEC task payload."""

    task_id: str
    task_type: str
    context: object | None
    channel_id: str | None
    raw: dict

    @property
    def missing_optional_fields(self) -> list[str]:
        """Return names of optional fields that were absent in the raw payload."""
        missing = []
        if self.context is None:
            missing.append("context")
        if self.channel_id is None:
            missing.append("channelId")
        return missing


@dataclass(frozen=True)
class EventRecord:
    """Serialisable record to be written to the log (or a message queue)."""

    received_at: str  # ISO-8601 timestamp, supplied by the shell
    task_id: str
    task_type: str
    context: object | None
    channel_id: str | None
    payload: dict

    def to_dict(self) -> dict:
        return {
            "receivedAt": self.received_at,
            "taskId": self.task_id,
            "taskType": self.task_type,
            "context": self.context,
            "channelId": self.channel_id,
            "payload": self.payload,
        }


# ---------------------------------------------------------------------------
# Pure core — no I/O, no logging, no datetime.now()
# ---------------------------------------------------------------------------


def validate_payload(payload: dict) -> None:
    """Raise ValueError if any required fields are missing or have wrong types."""
    missing = [f for f in REQUIRED_PAYLOAD_FIELDS if f not in payload]
    if missing:
        raise ValueError(f"Payload is missing required fields: {', '.join(missing)}")
    if not isinstance(payload.get("taskId"), str) or not payload["taskId"]:
        raise ValueError("Payload field 'taskId' must be a non-empty string")
    if not isinstance(payload.get("taskType"), str) or not payload["taskType"]:
        raise ValueError("Payload field 'taskType' must be a non-empty string")


def parse_payload(payload: dict) -> TaskEvent:
    """
    Validate *payload* and return an immutable TaskEvent.

    Raises ValueError for invalid payloads. Pure: no I/O, no side effects.
    """
    validate_payload(payload)
    return TaskEvent(
        task_id=payload["taskId"],
        task_type=payload["taskType"],
        context=payload.get("context"),
        channel_id=payload.get("channelId"),
        raw=payload,
    )


def build_event_record(event: TaskEvent, received_at: str) -> EventRecord:
    """
    Construct an EventRecord from a validated TaskEvent and a timestamp string.

    The timestamp is passed in (not read from the clock here) so this function
    stays pure and deterministic.
    """
    return EventRecord(
        received_at=received_at,
        task_id=event.task_id,
        task_type=event.task_type,
        context=event.context,
        channel_id=event.channel_id,
        payload=event.raw,
    )


# ---------------------------------------------------------------------------
# I/O shell — all side effects live here
# ---------------------------------------------------------------------------


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


def append_to_log(record: EventRecord) -> None:
    """
    Write an EventRecord as a JSONL line to the log file.

    In a real customer deployment, replace this function body with:
        kafka_producer.publish("jec-tasks", record.to_dict())
    or equivalent integration with your messaging or workflow system.
    """
    log_dir = os.path.dirname(LOG_FILE)
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)

    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record.to_dict()) + "\n")

    logging.info("Event appended to log: taskId=%s", record.task_id)


NAMED_PIPE_TIMEOUT_SECONDS = 30


def write_named_pipe_result(pipe_path: str, task_id: str) -> None:
    """
    Write a JSON result to the JEC named pipe with a timeout.

    JEC creates the named pipe at the path given in --jecNamedPipe. Writing
    to this pipe signals that the script has finished processing. On Enterprise
    JSM plans, the triggering flow can await this result for up to 15 minutes.

    A timeout is applied to avoid hanging indefinitely if JEC crashes or
    stops reading before this script writes.

    Note: The exact JSON schema JEC expects is not formally documented. The
    sample uses {"result": "success", "taskId": "..."} — tune as needed.
    """
    result = json.dumps({"result": "success", "taskId": task_id})
    logging.info("Writing result to named pipe: %s", pipe_path)

    error: list[Exception] = []

    def _write() -> None:
        try:
            with open(pipe_path, "w", encoding="utf-8") as pipe:
                pipe.write(result)
        except Exception as exc:  # noqa: BLE001
            error.append(exc)

    thread = threading.Thread(target=_write, daemon=True)
    thread.start()
    thread.join(timeout=NAMED_PIPE_TIMEOUT_SECONDS)

    if thread.is_alive():
        raise OSError(
            f"Timed out after {NAMED_PIPE_TIMEOUT_SECONDS}s waiting for JEC to read "
            f"named pipe: {pipe_path}"
        )
    if error:
        raise error[0]


def main() -> int:
    args = parse_args()
    configure_logging(args.logLevel)

    logging.info("JEC receiver started: jsmUrl=%s", args.jsmUrl)

    # --- Parse JSON ---
    try:
        payload = json.loads(args.payload)
    except json.JSONDecodeError as exc:
        logging.error("Failed to parse --payload as JSON: %s", exc)
        return 1

    if not isinstance(payload, dict):
        logging.error("Expected --payload to be a JSON object, got %s", type(payload).__name__)
        return 1

    if not payload:
        logging.warning("Payload is empty; skipping processing")
        return 0

    # --- Pure core: validate and build typed event ---
    try:
        event = parse_payload(payload)
    except ValueError as exc:
        logging.error("Payload validation failed: %s", exc)
        return 1

    # Warn about absent optional fields (data from the pure core, logged here in the shell)
    for field in event.missing_optional_fields:
        logging.warning("Payload is missing optional field %r; logging as null", field)

    # --- Build event record (pure, clock injected here in the shell) ---
    received_at = datetime.now(UTC).isoformat()
    record = build_event_record(event, received_at)

    # --- I/O: write to log ---
    try:
        append_to_log(record)
    except OSError as exc:
        logging.error("Failed to append event to log: %s", exc)
        return 1

    # --- I/O: write result to named pipe ---
    if args.jecNamedPipe:
        try:
            write_named_pipe_result(args.jecNamedPipe, event.task_id)
        except OSError as exc:
            logging.error("Failed to write to named pipe: %s", exc)
            return 1

    logging.info("JEC receiver completed successfully: taskId=%s", event.task_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
