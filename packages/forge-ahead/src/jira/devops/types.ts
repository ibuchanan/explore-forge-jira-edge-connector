/**
 * Shared types for the Jira Builds and Deployments (Open Toolchain) APIs.
 *
 * Types are derived from the generated OpenAPI types in
 * `src/apis/jira-software/types.ts` where possible, so they stay in sync with
 * the actual API schema.
 *
 * Both APIs require the corresponding manifest module to be declared:
 *   - devops:buildInfoProvider  (for submitBuilds)
 *   - devops:deploymentInfoProvider  (for submitDeployments)
 *
 * Without the module declaration the platform returns 403 even if the API
 * call is otherwise valid.
 *
 * @see {@link https://developer.atlassian.com/cloud/jira/software/rest/api-group-builds/|Builds API}
 * @see {@link https://developer.atlassian.com/cloud/jira/software/rest/api-group-deployments/|Deployments API}
 */

import type { components } from "../../apis/jira-software/types";

/**
 * Monotonically increasing integer used for idempotent writes.
 *
 * If Jira already holds a record with a **higher** updateSequenceNumber than
 * the incoming value, the incoming data is silently discarded.
 *
 * Always use `Date.now()` (Unix milliseconds) at call time to generate this
 * value. Using a static constant causes stale writes to silently win in
 * concurrent pipelines.
 */
export type UpdateSequenceNumber = number;

/**
 * Stable identifier for a pipeline (build plan, job name, workflow name).
 * Must be unique within the app.
 *
 * @example "my-org/my-repo"
 * @example "jenkins/my-job"
 */
export type PipelineId = string;

/**
 * Links build/deployment records to Jira issues.
 *
 * Derived from the generated `IssueIdOrKeysAssociation` component.
 * Always use `associations` (not the deprecated `issueKeys` field) for
 * consistency. The Deployments API requires this form.
 *
 * @example
 * { associationType: "issueIdOrKeys", values: ["PROJ-1", "PROJ-2"] }
 */
export type IssueAssociation =
  components["schemas"]["IssueIdOrKeysAssociation"];
