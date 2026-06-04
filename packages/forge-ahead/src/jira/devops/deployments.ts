/**
 * Typed wrapper for the Jira Deployments API (POST /rest/deployments/0.1/bulk).
 *
 * Manifest requirement — the app must declare this module or the platform
 * returns 403:
 * ```yaml
 * modules:
 *   devops:deploymentInfoProvider:
 *     - key: my-deployment-provider
 *       name: My Deployment Provider
 * ```
 *
 * @see {@link https://developer.atlassian.com/cloud/jira/software/rest/api-group-deployments/|Deployments API reference}
 */

import api, { route } from "@forge/api";

import type { operations } from "../../apis/jira-software/types";
import type { IssueAssociation } from "./types";

// ── Type aliases from generated spec ─────────────────────────────────────────

type SubmitDeploymentsRequestBody =
  operations["submitDeployments"]["requestBody"]["content"]["application/json"];

type SubmitDeploymentsResponseBody =
  operations["submitDeployments"]["responses"][202]["content"]["application/json"];

/**
 * A single deployment record to submit to Jira.
 *
 * Derived directly from the Jira Software OpenAPI spec. Composite key:
 * `(pipelineId, environmentId, deploymentSequenceNumber)`. Submit the same
 * composite key with a higher `updateSequenceNumber` to update an existing
 * record.
 *
 * At least one entry in `associations` is required for the record to appear
 * in Jira's release panel.
 *
 * The `environment.type` controls which panel in Jira shows the deployment:
 * - `production` / `staging` → Releases panel
 * - `development` / `testing` → Development panel
 * - `unmapped` → suppressed
 *
 * Notable fields:
 * - `updateSequenceNumber` — use `Date.now()` at call time; stale values
 *   cause Jira to silently discard the update.
 * - `description` — required by the spec (unlike builds where it is optional).
 * - `associations` — use the `issueKeys()` helper to construct the value.
 */
export type DeploymentData =
  SubmitDeploymentsRequestBody["deployments"][number];

export type DeploymentState = DeploymentData["state"];
export type EnvironmentType = DeploymentData["environment"]["type"];
export type Environment = DeploymentData["environment"];
export type Pipeline = DeploymentData["pipeline"];

// ── Response shapes (derived from generated OpenAPI types) ───────────────────

export type AcceptedDeployment = NonNullable<
  SubmitDeploymentsResponseBody["acceptedDeployments"]
>[number];

export type RejectedDeployment = NonNullable<
  SubmitDeploymentsResponseBody["rejectedDeployments"]
>[number];

export type DeploymentError = RejectedDeployment["errors"][number];

/**
 * Response from `submitDeployments`.
 *
 * The API returns 202 Accepted — the response body reports which deployments
 * were accepted (queued for indexing) and which were rejected (with reasons).
 * Accepted deployments appear in Jira within seconds under normal load.
 *
 * Note: `rejectedDeployments[].key` contains the composite key fields; errors
 * are in `rejectedDeployments[].errors`.
 */
export interface SubmitDeploymentsResponse {
  acceptedDeployments: AcceptedDeployment[];
  rejectedDeployments: RejectedDeployment[];
  unknownIssueKeys?: string[];
  unknownAssociations?: IssueAssociation[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a `DeploymentData` object with `updateSequenceNumber` set to
 * `Date.now()` and `schemaVersion` defaulted to `"1.0"`.
 *
 * This eliminates the most common mistake: forgetting to set a fresh timestamp,
 * which causes stale writes to silently discard newer data.
 *
 * @example
 * const deployment = deploymentNow({
 *   pipelineId: "my-org/my-repo",
 *   environmentId: "production",
 *   deploymentSequenceNumber: 7,
 *   displayName: "Deploy to production",
 *   description: "Release 1.2.3",
 *   url: "https://ci.example.com/deploys/7",
 *   state: "successful",
 *   lastUpdated: new Date().toISOString(),
 *   pipeline: { id: "my-org/my-repo", displayName: "My Repo", url: "https://github.com/my-org/my-repo" },
 *   environment: { id: "production", displayName: "Production", type: "production" },
 *   associations: [{ associationType: "issueIdOrKeys", values: ["PROJ-1"] }],
 * });
 */
export function deploymentNow(
  partial: Omit<DeploymentData, "updateSequenceNumber" | "schemaVersion">,
): DeploymentData {
  return {
    ...partial,
    updateSequenceNumber: Date.now(),
    schemaVersion: "1.0",
  };
}

// ── API call ─────────────────────────────────────────────────────────────────

/**
 * Submits one or more deployment records to Jira via the Deployments API.
 *
 * Returns 202 Accepted — data is eventually consistent and typically appears
 * in Jira's release panel within seconds. Check `rejectedDeployments` in the
 * response to detect validation errors.
 *
 * Requires the app manifest to declare `devops:deploymentInfoProvider`.
 *
 * @example
 * const result = await submitDeployments([deploymentNow({ ... })]);
 * if (result.rejectedDeployments.length > 0) {
 *   console.error("Rejected:", result.rejectedDeployments);
 * }
 */
export async function submitDeployments(
  deployments: DeploymentData[],
): Promise<SubmitDeploymentsResponse> {
  const body: SubmitDeploymentsRequestBody = { deployments };
  console.debug(`Request: submitDeployments count=${deployments.length}`);

  const response = await api
    .asApp()
    .requestJira(route`/rest/deployments/0.1/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  console.debug(`Response: ${response.status} ${response.statusText}`);

  if (!response.ok && response.status !== 202) {
    const text = await response.text();
    console.error(`Failed submitDeployments: ${response.status} ${text}`);
    throw new Error(
      `submitDeployments failed: ${response.status} ${response.statusText}`,
    );
  }

  const raw = (await response.json()) as SubmitDeploymentsResponseBody;
  const result: SubmitDeploymentsResponse = {
    acceptedDeployments: raw.acceptedDeployments ?? [],
    rejectedDeployments: raw.rejectedDeployments ?? [],
    unknownIssueKeys: raw.unknownIssueKeys,
    unknownAssociations: raw.unknownAssociations as
      | IssueAssociation[]
      | undefined,
  };
  console.debug(
    `submitDeployments: accepted=${result.acceptedDeployments.length} rejected=${result.rejectedDeployments.length}`,
  );
  return result;
}
