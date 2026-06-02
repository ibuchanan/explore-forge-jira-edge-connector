"""
Tests for receiver.py.

Covers:
  1. Non-dict payload guard (null, array, scalar → exit 1)
  2. validate_payload type checks (taskId / taskType must be non-empty strings)
  3. Named-pipe write timeout (OSError raised when reader never arrives)
  4. Optional-field warnings (context / channelId absent → WARNING logged)
  5. Happy-path: successful run writes a well-formed JSONL event
  6. Pure-core unit tests: parse_payload, build_event_record, TaskEvent

Architecture note: the pure-core tests (group 6) require no mocks and no I/O.
"""

import json
import logging
import os
import tempfile
import threading
from datetime import UTC, datetime
from unittest.mock import patch

import pytest

import receiver
from receiver import (
    NAMED_PIPE_TIMEOUT_SECONDS,
    EventRecord,
    TaskEvent,
    append_to_log,
    build_event_record,
    parse_payload,
    validate_payload,
    write_named_pipe_result,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

VALID_PAYLOAD = {
    "taskId": "task-123",
    "taskType": "report",
    "context": {"issueKey": "PROJ-1"},
    "channelId": "chan-abc",
}


def run_main(payload_obj: object, *, named_pipe: str | None = None) -> int:
    """
    Call receiver.main() with a synthetic argv, returning the exit code.

    Patches sys.argv so argparse picks up the right flags, and patches
    LOG_FILE to a temp file so tests don't need /var/log/jec.
    """
    payload_str = json.dumps(payload_obj)
    argv = [
        "receiver.py",
        "--payload", payload_str,
        "--apiKey", "test-key",
        "--jsmUrl", "https://api.atlassian.com",
        "--logLevel", "INFO",
    ]
    if named_pipe:
        argv += ["--jecNamedPipe", named_pipe]

    with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as f:
        log_path = f.name

    try:
        with patch("sys.argv", argv), patch.object(receiver, "LOG_FILE", log_path):
            return receiver.main()
    finally:
        os.unlink(log_path)


# ---------------------------------------------------------------------------
# 1. Non-dict payload guard
# ---------------------------------------------------------------------------

class TestNonDictPayloadGuard:
    def test_null_payload_returns_exit_1(self, caplog: pytest.LogCaptureFixture) -> None:
        with caplog.at_level(logging.ERROR):
            result = run_main(None)
        assert result == 1
        assert "JSON object" in caplog.text

    def test_array_payload_returns_exit_1(self, caplog: pytest.LogCaptureFixture) -> None:
        with caplog.at_level(logging.ERROR):
            result = run_main([{"taskId": "x", "taskType": "y"}])
        assert result == 1
        assert "JSON object" in caplog.text

    def test_string_payload_returns_exit_1(self, caplog: pytest.LogCaptureFixture) -> None:
        # json.loads('"hello"') is valid JSON but not a dict
        with caplog.at_level(logging.ERROR):
            result = run_main("hello")
        assert result == 1
        assert "JSON object" in caplog.text

    def test_number_payload_returns_exit_1(self, caplog: pytest.LogCaptureFixture) -> None:
        with caplog.at_level(logging.ERROR):
            result = run_main(42)
        assert result == 1

    def test_valid_dict_payload_succeeds(self) -> None:
        result = run_main(VALID_PAYLOAD)
        assert result == 0

    def test_invalid_json_string_returns_exit_1(self, caplog: pytest.LogCaptureFixture) -> None:
        """A payload that is not valid JSON at all → JSONDecodeError branch → exit 1."""
        argv = [
            "receiver.py",
            "--payload", "not-valid-json{{{",
            "--apiKey", "test-key",
            "--jsmUrl", "https://api.atlassian.com",
            "--logLevel", "INFO",
        ]
        with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as f:
            log_path = f.name
        try:
            with patch("sys.argv", argv), patch.object(receiver, "LOG_FILE", log_path), \
                    caplog.at_level(logging.ERROR):
                result = receiver.main()
        finally:
            os.unlink(log_path)
        assert result == 1
        assert "parse" in caplog.text.lower() or "json" in caplog.text.lower()


# ---------------------------------------------------------------------------
# 2. validate_payload type checks
# ---------------------------------------------------------------------------

class TestValidatePayload:
    def test_valid_payload_passes(self) -> None:
        validate_payload({"taskId": "t1", "taskType": "report"})  # no exception

    def test_missing_task_id_raises(self) -> None:
        with pytest.raises(ValueError, match="taskId"):
            validate_payload({"taskType": "report"})

    def test_missing_task_type_raises(self) -> None:
        with pytest.raises(ValueError, match="taskType"):
            validate_payload({"taskId": "t1"})

    def test_task_id_integer_raises(self) -> None:
        with pytest.raises(ValueError, match="taskId"):
            validate_payload({"taskId": 123, "taskType": "report"})

    def test_task_id_none_raises(self) -> None:
        with pytest.raises(ValueError, match="taskId"):
            validate_payload({"taskId": None, "taskType": "report"})

    def test_task_id_empty_string_raises(self) -> None:
        with pytest.raises(ValueError, match="taskId"):
            validate_payload({"taskId": "", "taskType": "report"})

    def test_task_type_integer_raises(self) -> None:
        with pytest.raises(ValueError, match="taskType"):
            validate_payload({"taskId": "t1", "taskType": 0})

    def test_task_type_empty_string_raises(self) -> None:
        with pytest.raises(ValueError, match="taskType"):
            validate_payload({"taskId": "t1", "taskType": ""})

    def test_empty_payload_raises_listing_missing_fields(self) -> None:
        with pytest.raises(ValueError, match="taskId.*taskType|taskType.*taskId|taskId|taskType"):
            validate_payload({})


class TestBlankPayload:
    """Blank payload ({}) should log a warning and exit 0 without errors."""

    def test_blank_payload_returns_exit_0(self, caplog: pytest.LogCaptureFixture) -> None:
        with caplog.at_level(logging.WARNING):
            result = run_main({})
        assert result == 0

    def test_blank_payload_logs_warning(self, caplog: pytest.LogCaptureFixture) -> None:
        with caplog.at_level(logging.WARNING):
            run_main({})
        warning_records = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert warning_records, "Expected at least one WARNING for blank payload"
        assert any("empty" in r.message.lower() for r in warning_records)


# ---------------------------------------------------------------------------
# 3. Named-pipe write timeout
# ---------------------------------------------------------------------------

class TestNamedPipeTimeout:
    def test_successful_write_via_real_fifo(self, tmp_path: "os.PathLike[str]") -> None:
        """Write succeeds when a reader consumes the pipe concurrently."""
        pipe_path = str(tmp_path / "test.pipe")
        os.mkfifo(pipe_path)

        received: list[str] = []

        def reader() -> None:
            with open(pipe_path, encoding="utf-8") as f:
                received.append(f.read())

        t = threading.Thread(target=reader, daemon=True)
        t.start()
        write_named_pipe_result(pipe_path, "task-123")
        t.join(timeout=5)

        assert not t.is_alive(), "Reader thread did not finish within timeout"
        assert len(received) == 1, "Reader did not receive any data"
        data = json.loads(received[0])
        assert data["result"] == "success"
        assert data["taskId"] == "task-123"

    def test_timeout_raises_oserror_when_no_reader(
        self, tmp_path: "os.PathLike[str]", monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """OSError is raised when no reader opens the pipe within the timeout."""
        pipe_path = str(tmp_path / "timeout.pipe")
        os.mkfifo(pipe_path)

        monkeypatch.setattr(receiver, "NAMED_PIPE_TIMEOUT_SECONDS", 1)
        with pytest.raises(OSError, match="Timed out"):
            write_named_pipe_result(pipe_path, "task-xyz")

    def test_write_error_is_re_raised(self, tmp_path: "os.PathLike[str]") -> None:
        """An OSError from the write itself (e.g. bad path) is re-raised."""
        with pytest.raises(OSError):
            write_named_pipe_result("/nonexistent/path/pipe", "task-abc")


# ---------------------------------------------------------------------------
# 4. Optional-field warnings
# ---------------------------------------------------------------------------

class TestOptionalFieldWarnings:
    def _run_append(self, payload: dict, tmp_path: "os.PathLike[str]") -> None:
        """
        Exercise the optional-field warning path via main(), which is where
        the shell now emits warnings based on TaskEvent.missing_optional_fields.
        """
        log_file = str(tmp_path / "events.jsonl")
        argv = [
            "receiver.py",
            "--payload", json.dumps(payload),
            "--apiKey", "test-key",
            "--jsmUrl", "https://api.atlassian.com",
            "--logLevel", "INFO",
        ]
        with patch("sys.argv", argv), patch.object(receiver, "LOG_FILE", log_file):
            receiver.main()

    def test_no_warnings_when_all_fields_present(
        self, tmp_path: "os.PathLike[str]", caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.WARNING):
            self._run_append(VALID_PAYLOAD, tmp_path)
        warning_records = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert not warning_records, f"Unexpected warnings: {[r.message for r in warning_records]}"

    def test_warns_when_context_missing(
        self, tmp_path: "os.PathLike[str]", caplog: pytest.LogCaptureFixture
    ) -> None:
        payload = {**VALID_PAYLOAD}
        del payload["context"]
        with caplog.at_level(logging.WARNING):
            self._run_append(payload, tmp_path)
        assert "context" in caplog.text

    def test_warns_when_channel_id_missing(
        self, tmp_path: "os.PathLike[str]", caplog: pytest.LogCaptureFixture
    ) -> None:
        payload = {**VALID_PAYLOAD}
        del payload["channelId"]
        with caplog.at_level(logging.WARNING):
            self._run_append(payload, tmp_path)
        assert "channelId" in caplog.text

    def test_warns_for_both_when_both_missing(
        self, tmp_path: "os.PathLike[str]", caplog: pytest.LogCaptureFixture
    ) -> None:
        payload = {"taskId": "t1", "taskType": "report"}
        with caplog.at_level(logging.WARNING):
            self._run_append(payload, tmp_path)
        assert "context" in caplog.text
        assert "channelId" in caplog.text

    def test_log_file_contains_null_for_missing_fields(
        self, tmp_path: "os.PathLike[str]"
    ) -> None:
        log_file = str(tmp_path / "events.jsonl")
        payload = {"taskId": "t1", "taskType": "report"}
        argv = [
            "receiver.py",
            "--payload", json.dumps(payload),
            "--apiKey", "test-key",
            "--jsmUrl", "https://api.atlassian.com",
            "--logLevel", "INFO",
        ]
        with patch("sys.argv", argv), patch.object(receiver, "LOG_FILE", log_file):
            receiver.main()
        with open(log_file, encoding="utf-8") as f:
            event = json.loads(f.read())
        assert event["context"] is None
        assert event["channelId"] is None


# ---------------------------------------------------------------------------
# 5. Happy-path: successful run writes a well-formed JSONL event
# ---------------------------------------------------------------------------

class TestSuccessfulRunWritesEvent:
    def test_writes_valid_jsonl_event_with_correct_fields(self, tmp_path: "os.PathLike[str]") -> None:
        """A complete successful run writes one JSONL line with expected fields."""
        log_file = str(tmp_path / "events.jsonl")
        argv = [
            "receiver.py",
            "--payload", json.dumps(VALID_PAYLOAD),
            "--apiKey", "test-key",
            "--jsmUrl", "https://api.atlassian.com",
            "--logLevel", "INFO",
        ]
        with patch("sys.argv", argv), patch.object(receiver, "LOG_FILE", log_file):
            result = receiver.main()

        assert result == 0

        with open(log_file, encoding="utf-8") as f:
            lines = f.readlines()

        assert len(lines) == 1, "Expected exactly one JSONL event"
        event = json.loads(lines[0])
        assert event["taskId"] == VALID_PAYLOAD["taskId"]
        assert event["taskType"] == VALID_PAYLOAD["taskType"]
        assert event["channelId"] == VALID_PAYLOAD["channelId"]
        assert event["context"] == VALID_PAYLOAD["context"]
        assert "receivedAt" in event
        assert "payload" in event


# ---------------------------------------------------------------------------
# 6. Pure-core unit tests — no mocks, no I/O, no logging
# ---------------------------------------------------------------------------


class TestParsePayload:
    """parse_payload() is pure: given a dict it returns a TaskEvent or raises."""

    def test_valid_full_payload_returns_task_event(self) -> None:
        event = parse_payload(VALID_PAYLOAD)
        assert isinstance(event, TaskEvent)
        assert event.task_id == VALID_PAYLOAD["taskId"]
        assert event.task_type == VALID_PAYLOAD["taskType"]
        assert event.context == VALID_PAYLOAD["context"]
        assert event.channel_id == VALID_PAYLOAD["channelId"]
        assert event.raw == VALID_PAYLOAD

    def test_missing_task_id_raises(self) -> None:
        with pytest.raises(ValueError, match="taskId"):
            parse_payload({"taskType": "report"})

    def test_missing_task_type_raises(self) -> None:
        with pytest.raises(ValueError, match="taskType"):
            parse_payload({"taskId": "t1"})

    def test_empty_payload_raises(self) -> None:
        with pytest.raises(ValueError):
            parse_payload({})

    def test_optional_fields_absent_returns_none(self) -> None:
        event = parse_payload({"taskId": "t1", "taskType": "report"})
        assert event.context is None
        assert event.channel_id is None

    def test_task_event_is_immutable(self) -> None:
        event = parse_payload(VALID_PAYLOAD)
        with pytest.raises(Exception):
            event.task_id = "mutated"  # type: ignore[misc]


class TestTaskEventMissingOptionalFields:
    """TaskEvent.missing_optional_fields returns names of absent optional fields."""

    def test_no_missing_fields_when_all_present(self) -> None:
        event = parse_payload(VALID_PAYLOAD)
        assert event.missing_optional_fields == []

    def test_context_listed_when_absent(self) -> None:
        event = parse_payload({"taskId": "t1", "taskType": "report", "channelId": "c1"})
        assert "context" in event.missing_optional_fields
        assert "channelId" not in event.missing_optional_fields

    def test_channel_id_listed_when_absent(self) -> None:
        event = parse_payload({"taskId": "t1", "taskType": "report", "context": {}})
        assert "channelId" in event.missing_optional_fields
        assert "context" not in event.missing_optional_fields

    def test_both_listed_when_both_absent(self) -> None:
        event = parse_payload({"taskId": "t1", "taskType": "report"})
        missing = event.missing_optional_fields
        assert "context" in missing
        assert "channelId" in missing


class TestBuildEventRecord:
    """build_event_record() is pure: given a TaskEvent and timestamp it returns an EventRecord."""

    def _make_event(self, payload: dict | None = None) -> TaskEvent:
        return parse_payload(payload or VALID_PAYLOAD)

    def test_returns_event_record(self) -> None:
        event = self._make_event()
        record = build_event_record(event, "2026-06-01T12:00:00+00:00")
        assert isinstance(record, EventRecord)

    def test_received_at_is_passed_through(self) -> None:
        ts = "2026-06-01T12:00:00+00:00"
        record = build_event_record(self._make_event(), ts)
        assert record.received_at == ts

    def test_fields_match_task_event(self) -> None:
        event = self._make_event()
        record = build_event_record(event, "2026-06-01T00:00:00+00:00")
        assert record.task_id == event.task_id
        assert record.task_type == event.task_type
        assert record.context == event.context
        assert record.channel_id == event.channel_id
        assert record.payload == event.raw

    def test_to_dict_has_camel_case_keys(self) -> None:
        record = build_event_record(self._make_event(), "2026-06-01T00:00:00+00:00")
        d = record.to_dict()
        assert "receivedAt" in d
        assert "taskId" in d
        assert "taskType" in d
        assert "channelId" in d
        assert "context" in d
        assert "payload" in d

    def test_missing_optional_fields_are_null_in_dict(self) -> None:
        event = parse_payload({"taskId": "t1", "taskType": "report"})
        record = build_event_record(event, "2026-06-01T00:00:00+00:00")
        d = record.to_dict()
        assert d["context"] is None
        assert d["channelId"] is None

    def test_clock_is_not_called_inside_build(self) -> None:
        """build_event_record must not read the clock — timestamp comes from caller."""
        before = datetime.now(UTC).isoformat()
        record = build_event_record(self._make_event(), "1970-01-01T00:00:00+00:00")
        after = datetime.now(UTC).isoformat()
        # The record should use the injected timestamp, not the real clock
        assert record.received_at == "1970-01-01T00:00:00+00:00"
        assert record.received_at != before
        assert record.received_at != after
