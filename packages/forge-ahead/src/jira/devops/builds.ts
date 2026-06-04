/**
 * Typed wrapper for the Jira Builds API (POST /rest/builds/0.1/bulk).
 *
 * Manifest requirement — the app must declare this module or the platform
 * returns 403:
 * ```yaml
 * modules:
 *   devops:buildInfoProvider:
 *     - key: my-build-provider
 *       name: My Build Provider
 * ```
 *
 * @see {@link https://developer.atlassian.com/cloud/jira/software/rest/api-group-builds/|Builds API reference}
 */

import api, { route } from "@forge/api";

import type { operations } from "../../apis/jira-software/types";
import type { IssueAssociation } from "./types";

// ── Type aliases from generated spec ─────────────────────────────────────────

type SubmitBuildsRequestBody =
  operations["submitBuilds"]["requestBody"]["content"]["application/json"];

type SubmitBuildsResponseBody =
  operations["submitBuilds"]["responses"][202]["content"]["application/json"];

/**
 * A single build record to submit to Jira.
 *
 * Derived directly from the Jira Software OpenAPI spec. Composite key:
 * `(pipelineId, buildNumber)`. Submit the same composite key with a higher
 * `updateSequenceNumber` to update an existing record.
 *
 * At least one entry in `associations` is required for the record to appear
 * in Jira's development panel.
 *
 * Notable fields:
 * - `updateSequenceNumber` — use `Date.now()` at call time; stale values
 *   cause Jira to silently discard the update.
 * - `associations` — use the `issueKeys()` helper to construct the value.
 * - `references` — optional commit/branch metadata for richer SCM linking.
 * - `testInfo.numberSkipped` — optional (defaults to 0 in Jira).
 */
export type BuildData = SubmitBuildsRequestBody["builds"][number];

export type BuildState = BuildData["state"];
export type TestInfo = NonNullable<BuildData["testInfo"]>;
export type BuildReference = NonNullable<BuildData["references"]>[number];

// ── Response shapes (derived from generated OpenAPI types) ───────────────────

export type AcceptedBuild = NonNullable<
  SubmitBuildsResponseBody["acceptedBuilds"]
>[number];

export type RejectedBuild = NonNullable<
  SubmitBuildsResponseBody["rejectedBuilds"]
>[number];

export type BuildError = RejectedBuild["errors"][number];

/**
 * Response from `submitBuilds`.
 *
 * The API returns 202 Accepted — the response body reports which builds were
 * accepted (queued for indexing) and which were rejected (with reasons).
 * Accepted builds appear in Jira within seconds under normal load.
 *
 * Note: `rejectedBuilds[].key` contains the composite key fields; errors are
 * in `rejectedBuilds[].errors`.
 */
export interface SubmitBuildsResponse {
  acceptedBuilds: AcceptedBuild[];
  rejectedBuilds: RejectedBuild[];
  unknownIssueKeys?: string[];
  unknownAssociations?: IssueAssociation[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Wraps an array of Jira issue keys into the `IssueAssociation` shape.
 *
 * @example
 * issueKeys(["PROJ-1", "PROJ-2"])
 * // → { associationType: "issueIdOrKeys", values: ["PROJ-1", "PROJ-2"] }
 */
export function issueKeys(keys: string[]): IssueAssociation {
  return { associationType: "issueIdOrKeys", values: keys };
}

/**
 * Creates a `BuildData` object with `updateSequenceNumber` set to `Date.now()`
 * and `schemaVersion` defaulted to `"1.0"`.
 *
 * This eliminates the most common mistake: forgetting to set a fresh timestamp,
 * which causes stale writes to silently discard newer data.
 *
 * @example
 * const build = buildNow({
 *   pipelineId: "my-org/my-repo",
 *   buildNumber: 42,
 *   displayName: "Build #42",
 *   url: "https://ci.example.com/builds/42",
 *   state: "successful",
 *   lastUpdated: new Date().toISOString(),
 *   associations: [issueKeys(["PROJ-1"])],
 * });
 */
export function buildNow(
  partial: Omit<BuildData, "updateSequenceNumber" | "schemaVersion">,
): BuildData {
  return {
    ...partial,
    updateSequenceNumber: Date.now(),
    schemaVersion: "1.0",
  };
}

// ── API call ─────────────────────────────────────────────────────────────────

/**
 * Submits one or more build records to Jira via the Builds API.
 *
 * Returns 202 Accepted — data is eventually consistent and typically appears
 * in Jira's development panel within seconds. Check `rejectedBuilds` in the
 * response to detect validation errors.
 *
 * Requires the app manifest to declare `devops:buildInfoProvider`.
 *
 * @example
 * const result = await submitBuilds([buildNow({ ... })]);
 * if (result.rejectedBuilds.length > 0) {
 *   console.error("Rejected:", result.rejectedBuilds);
 * }
 */
export async function submitBuilds(
  builds: BuildData[],
): Promise<SubmitBuildsResponse> {
  const body: SubmitBuildsRequestBody = { builds };
  console.debug(`Request: submitBuilds count=${builds.length}`);

  const response = await api.asApp().requestJira(route`/rest/builds/0.1/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  console.debug(`Response: ${response.status} ${response.statusText}`);

  if (!response.ok && response.status !== 202) {
    const text = await response.text();
    console.error(`Failed submitBuilds: ${response.status} ${text}`);
    throw new Error(
      `submitBuilds failed: ${response.status} ${response.statusText}`,
    );
  }

  const raw = (await response.json()) as SubmitBuildsResponseBody;
  const result: SubmitBuildsResponse = {
    acceptedBuilds: raw.acceptedBuilds ?? [],
    rejectedBuilds: raw.rejectedBuilds ?? [],
    unknownIssueKeys: raw.unknownIssueKeys,
    unknownAssociations: raw.unknownAssociations as
      | IssueAssociation[]
      | undefined,
  };
  console.debug(
    `submitBuilds: accepted=${result.acceptedBuilds.length} rejected=${result.rejectedBuilds.length}`,
  );
  return result;
}
