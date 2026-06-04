/**
 * Jira DevOps module — typed wrappers for the Builds and Deployments APIs.
 *
 * All data types are derived directly from the Jira Software OpenAPI spec so
 * they stay in sync with the actual API schema automatically.
 *
 * Both APIs require manifest module declarations to avoid 403 errors.
 * See `builds.ts` and `deployments.ts` for details.
 *
 * @example
 * import {
 *   submitBuilds,
 *   submitDeployments,
 *   buildNow,
 *   deploymentNow,
 *   issueKeys,
 * } from "forge-ahead/jira/devops";
 *
 * // In a webtrigger handler:
 * const build = buildNow({
 *   pipelineId: "my-org/my-repo",
 *   buildNumber: payload.buildNumber,
 *   displayName: `Build ${payload.buildNumber}`,
 *   url: payload.buildUrl,
 *   state: payload.success ? "successful" : "failed",
 *   lastUpdated: new Date().toISOString(),
 *   associations: [issueKeys(payload.issueKeys)],
 * });
 * const result = await submitBuilds([build]);
 */

// Build types, helpers, and API wrapper
export type {
  AcceptedBuild,
  BuildData,
  BuildError,
  BuildReference,
  BuildState,
  RejectedBuild,
  SubmitBuildsResponse,
  TestInfo,
} from "./builds";
export { buildNow, issueKeys, submitBuilds } from "./builds";
// Deployment types, helpers, and API wrapper
export type {
  AcceptedDeployment,
  DeploymentData,
  DeploymentError,
  DeploymentState,
  Environment,
  EnvironmentType,
  Pipeline,
  RejectedDeployment,
  SubmitDeploymentsResponse,
} from "./deployments";
export { deploymentNow, submitDeployments } from "./deployments";
// Shared primitives
export type {
  IssueAssociation,
  PipelineId,
  UpdateSequenceNumber,
} from "./types";
