import { createHmac, timingSafeEqual } from "node:crypto";
import { CALLBACK_TIMESTAMP_TOLERANCE_MS } from "../shared/constants";
import { hashBody } from "./callback-events";

export interface SignatureInput {
  method: string;
  path: string;
  body: string;
  timestamp: string;
  nonce: string;
  taskId: string;
  channelId: string;
}

export interface SignatureHeaders {
  keyId: string;
  signature: string;
  timestamp: string;
  nonce: string;
}

export function createCanonicalString(input: SignatureInput): string {
  return [
    input.method.toUpperCase(),
    input.path,
    hashBody(input.body),
    input.timestamp,
    input.nonce,
    input.taskId,
    input.channelId,
  ].join("\n");
}

export function signCanonicalString(
  canonicalString: string,
  secret: string,
): string {
  return createHmac("sha256", secret).update(canonicalString).digest("hex");
}

export function verifySignature(
  input: SignatureInput,
  expectedSignature: string,
  secret: string,
): boolean {
  const actualSignature = signCanonicalString(
    createCanonicalString(input),
    secret,
  );
  const actual = Buffer.from(actualSignature, "hex");
  const expected = Buffer.from(expectedSignature, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

export function assertFreshTimestamp(
  timestamp: string,
  nowMs = Date.now(),
): void {
  const timestampMs = Date.parse(timestamp);

  if (Number.isNaN(timestampMs)) {
    throw new Error("Callback timestamp is not a valid ISO date.");
  }

  if (Math.abs(nowMs - timestampMs) > CALLBACK_TIMESTAMP_TOLERANCE_MS) {
    throw new Error(
      "Callback timestamp is outside the allowed freshness window.",
    );
  }
}

export function extractHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  const value = entry?.[1];

  if (Array.isArray(value)) {
    return value[0] || "";
  }

  return value || "";
}

export function extractSignatureHeaders(
  headers: Record<string, string | string[] | undefined>,
): SignatureHeaders {
  const keyId = extractHeader(headers, "x-callback-key-id");
  const signature = extractHeader(headers, "x-callback-signature");
  const timestamp = extractHeader(headers, "x-request-timestamp");
  const nonce = extractHeader(headers, "x-request-nonce");

  if (!keyId || !signature || !timestamp || !nonce) {
    throw new Error("Callback request is missing required signature headers.");
  }

  return { keyId, signature, timestamp, nonce };
}
