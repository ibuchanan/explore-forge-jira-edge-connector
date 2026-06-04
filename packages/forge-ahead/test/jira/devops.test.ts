/**
 * Tests for the Jira DevOps module (Builds and Deployments API wrappers).
 *
 * The @forge/api module is mocked so tests run outside a Forge runtime.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock @forge/api ──────────────────────────────────────────────────────────

const { mockRequestJira, mockAsApp } = vi.hoisted(() => {
  const mockRequestJira = vi.fn();
  const mockAsApp = vi.fn(() => ({ requestJira: mockRequestJira }));
  return { mockRequestJira, mockAsApp };
});

vi.mock("@forge/api", () => ({
  default: { asApp: mockAsApp },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (acc, str, i) => acc + str + (values[i] !== undefined ? values[i] : ""),
      "",
    ),
}));

// ── Imports (after mock) ─────────────────────────────────────────────────────

import type {
  BuildData,
  DeploymentData,
  SubmitBuildsResponse,
  SubmitDeploymentsResponse,
} from "../../src/jira/devops/index";
import {
  buildNow,
  deploymentNow,
  issueKeys,
  submitBuilds,
  submitDeployments,
} from "../../src/jira/devops/index";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeBuild(overrides?: Partial<BuildData>): BuildData {
  return {
    pipelineId: "my-org/my-repo",
    buildNumber: 42,
    updateSequenceNumber: 1_700_000_000_000,
    displayName: "Build #42",
    url: "https://ci.example.com/builds/42",
    state: "successful",
    lastUpdated: "2024-01-15T12:00:00.000Z",
    associations: [issueKeys(["PROJ-1"])],
    schemaVersion: "1.0",
    ...overrides,
  };
}

function makeDeployment(overrides?: Partial<DeploymentData>): DeploymentData {
  return {
    pipelineId: "my-org/my-repo",
    environmentId: "production",
    deploymentSequenceNumber: 7,
    updateSequenceNumber: 1_700_000_000_000,
    displayName: "Deploy to production",
    description: "Release 1.0.0",
    url: "https://ci.example.com/deploys/7",
    state: "successful",
    lastUpdated: "2024-01-15T13:00:00.000Z",
    pipeline: {
      id: "my-org/my-repo",
      displayName: "My Repo",
      url: "https://github.com/my-org/my-repo",
    },
    environment: {
      id: "production",
      displayName: "Production",
      type: "production",
    },
    associations: [issueKeys(["PROJ-2"])],
    schemaVersion: "1.0",
    ...overrides,
  };
}

const acceptedBuildsResponse: SubmitBuildsResponse = {
  acceptedBuilds: [{ pipelineId: "my-org/my-repo", buildNumber: 42 }],
  rejectedBuilds: [],
};

const acceptedDeploymentsResponse: SubmitDeploymentsResponse = {
  acceptedDeployments: [
    {
      pipelineId: "my-org/my-repo",
      environmentId: "production",
      deploymentSequenceNumber: 7,
    },
  ],
  rejectedDeployments: [],
};

// ── issueKeys helper ─────────────────────────────────────────────────────────

describe("issueKeys", () => {
  it("wraps a single key into an IssueAssociation", () => {
    expect(issueKeys(["PROJ-1"])).toEqual({
      associationType: "issueIdOrKeys",
      values: ["PROJ-1"],
    });
  });

  it("wraps multiple keys", () => {
    const result = issueKeys(["PROJ-1", "PROJ-2", "PROJ-3"]);
    expect(result.associationType).toBe("issueIdOrKeys");
    expect(result.values).toEqual(["PROJ-1", "PROJ-2", "PROJ-3"]);
  });

  it("wraps an empty array", () => {
    expect(issueKeys([])).toEqual({
      associationType: "issueIdOrKeys",
      values: [],
    });
  });
});

// ── buildNow helper ──────────────────────────────────────────────────────────

describe("buildNow", () => {
  it("sets updateSequenceNumber to approximately Date.now()", () => {
    const before = Date.now();
    const build = buildNow({
      pipelineId: "my-org/my-repo",
      buildNumber: 1,
      displayName: "Build #1",
      url: "https://ci.example.com/builds/1",
      state: "successful",
      lastUpdated: new Date().toISOString(),
      associations: [issueKeys(["PROJ-1"])],
    });
    const after = Date.now();

    expect(build.updateSequenceNumber).toBeGreaterThanOrEqual(before);
    expect(build.updateSequenceNumber).toBeLessThanOrEqual(after);
  });

  it("sets schemaVersion to '1.0'", () => {
    const build = buildNow({
      pipelineId: "x",
      buildNumber: 1,
      displayName: "B",
      url: "https://example.com",
      state: "pending",
      lastUpdated: new Date().toISOString(),
      associations: [issueKeys(["X-1"])],
    });
    expect(build.schemaVersion).toBe("1.0");
  });

  it("passes through all other fields unchanged", () => {
    const partial = {
      pipelineId: "my-org/my-repo",
      buildNumber: 99,
      displayName: "Build #99",
      url: "https://ci.example.com/builds/99",
      state: "failed" as const,
      lastUpdated: "2024-01-15T12:00:00.000Z",
      associations: [issueKeys(["PROJ-99"])],
      description: "A failing build",
      label: "nightly",
      testInfo: {
        totalNumber: 100,
        numberPassed: 90,
        numberFailed: 10,
        numberSkipped: 0,
      },
      references: [
        {
          commit: {
            id: "abc123",
            repositoryUri: "https://bitbucket.org/my-org/my-repo",
          },
        },
      ],
    };
    const build = buildNow(partial);

    expect(build.pipelineId).toBe(partial.pipelineId);
    expect(build.buildNumber).toBe(partial.buildNumber);
    expect(build.displayName).toBe(partial.displayName);
    expect(build.state).toBe("failed");
    expect(build.description).toBe("A failing build");
    expect(build.label).toBe("nightly");
    expect(build.testInfo).toEqual(partial.testInfo);
    expect(build.associations).toEqual(partial.associations);
    expect(build.references).toEqual(partial.references);
  });

  it("generates unique sequence numbers on successive calls", async () => {
    const partial = {
      pipelineId: "x",
      buildNumber: 1,
      displayName: "B",
      url: "https://example.com",
      state: "successful" as const,
      lastUpdated: new Date().toISOString(),
      associations: [issueKeys(["X-1"])],
    };
    const a = buildNow(partial);
    await new Promise((r) => setTimeout(r, 2));
    const b = buildNow(partial);
    expect(b.updateSequenceNumber).toBeGreaterThanOrEqual(
      a.updateSequenceNumber,
    );
  });
});

// ── deploymentNow helper ─────────────────────────────────────────────────────

describe("deploymentNow", () => {
  it("sets updateSequenceNumber to approximately Date.now()", () => {
    const before = Date.now();
    const deployment = deploymentNow({
      pipelineId: "my-org/my-repo",
      environmentId: "production",
      deploymentSequenceNumber: 1,
      displayName: "Deploy to production",
      description: "Release 1.0.0",
      url: "https://ci.example.com/deploys/1",
      state: "successful",
      lastUpdated: new Date().toISOString(),
      pipeline: { id: "p", displayName: "P", url: "https://example.com" },
      environment: {
        id: "production",
        displayName: "Production",
        type: "production",
      },
      associations: [issueKeys(["PROJ-1"])],
    });
    const after = Date.now();

    expect(deployment.updateSequenceNumber).toBeGreaterThanOrEqual(before);
    expect(deployment.updateSequenceNumber).toBeLessThanOrEqual(after);
  });

  it("sets schemaVersion to '1.0'", () => {
    const deployment = deploymentNow({
      pipelineId: "x",
      environmentId: "prod",
      deploymentSequenceNumber: 1,
      displayName: "D",
      description: "desc",
      url: "https://example.com",
      state: "pending",
      lastUpdated: new Date().toISOString(),
      pipeline: { id: "p", displayName: "P", url: "https://example.com" },
      environment: { id: "prod", displayName: "Prod", type: "production" },
      associations: [issueKeys(["X-1"])],
    });
    expect(deployment.schemaVersion).toBe("1.0");
  });

  it("passes through all other fields unchanged", () => {
    const env = {
      id: "staging",
      displayName: "Staging",
      type: "staging" as const,
    };
    const pipeline = {
      id: "pipe",
      displayName: "Pipe",
      url: "https://example.com",
    };
    const partial = {
      pipelineId: "my-org/my-repo",
      environmentId: "staging",
      deploymentSequenceNumber: 5,
      displayName: "Deploy to staging",
      description: "Staging deploy",
      url: "https://ci.example.com/deploys/5",
      state: "in_progress" as const,
      lastUpdated: "2024-01-15T13:00:00.000Z",
      pipeline,
      environment: env,
      associations: [issueKeys(["PROJ-5"])],
      duration: 120,
    };
    const deployment = deploymentNow(partial);

    expect(deployment.pipelineId).toBe(partial.pipelineId);
    expect(deployment.environmentId).toBe(partial.environmentId);
    expect(deployment.state).toBe("in_progress");
    expect(deployment.environment).toEqual(env);
    expect(deployment.pipeline).toEqual(pipeline);
    expect(deployment.description).toBe("Staging deploy");
    expect(deployment.duration).toBe(120);
  });
});

// ── submitBuilds ─────────────────────────────────────────────────────────────

describe("submitBuilds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs to /rest/builds/0.1/bulk with correct body", async () => {
    mockRequestJira.mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      json: async () => acceptedBuildsResponse,
    });

    const build = makeBuild();
    await submitBuilds([build]);

    expect(mockAsApp).toHaveBeenCalled();
    expect(mockRequestJira).toHaveBeenCalledWith(
      "/rest/builds/0.1/bulk",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ builds: [build] }),
      }),
    );
  });

  it("returns accepted and rejected build lists", async () => {
    const rejectedResponse = {
      acceptedBuilds: [],
      rejectedBuilds: [
        {
          key: { pipelineId: "my-org/my-repo", buildNumber: 42 },
          errors: [{ message: "Invalid state", errorTraceId: "trace-001" }],
        },
      ],
    };
    mockRequestJira.mockResolvedValue({
      ok: false,
      status: 202,
      statusText: "Accepted",
      json: async () => rejectedResponse,
    });

    const result = await submitBuilds([makeBuild()]);
    expect(result.acceptedBuilds).toHaveLength(0);
    expect(result.rejectedBuilds).toHaveLength(1);
    expect(result.rejectedBuilds[0]?.errors[0]?.message).toBe("Invalid state");
  });

  it("returns accepted builds on success", async () => {
    mockRequestJira.mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      json: async () => acceptedBuildsResponse,
    });

    const result = await submitBuilds([makeBuild()]);
    expect(result.acceptedBuilds).toHaveLength(1);
    expect(result.acceptedBuilds[0]).toEqual({
      pipelineId: "my-org/my-repo",
      buildNumber: 42,
    });
    expect(result.rejectedBuilds).toHaveLength(0);
  });

  it("submits multiple builds in a single request", async () => {
    mockRequestJira.mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      json: async () => ({
        acceptedBuilds: [
          { pipelineId: "my-org/my-repo", buildNumber: 1 },
          { pipelineId: "my-org/my-repo", buildNumber: 2 },
        ],
        rejectedBuilds: [],
      }),
    });

    const builds = [
      makeBuild({ buildNumber: 1 }),
      makeBuild({ buildNumber: 2 }),
    ];
    const result = await submitBuilds(builds);

    const sentBody = JSON.parse(
      mockRequestJira.mock.calls[0][1].body as string,
    );
    expect(sentBody.builds).toHaveLength(2);
    expect(result.acceptedBuilds).toHaveLength(2);
  });

  it("normalises undefined acceptedBuilds to empty array", async () => {
    mockRequestJira.mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      json: async () => ({ unknownIssueKeys: ["PROJ-999"] }),
    });

    const result = await submitBuilds([makeBuild()]);
    expect(result.acceptedBuilds).toEqual([]);
    expect(result.rejectedBuilds).toEqual([]);
    expect(result.unknownIssueKeys).toEqual(["PROJ-999"]);
  });

  it("throws on non-202 error responses", async () => {
    mockRequestJira.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "Missing manifest module",
    });

    await expect(submitBuilds([makeBuild()])).rejects.toThrow(
      "submitBuilds failed: 403 Forbidden",
    );
  });

  it("includes unknownIssueKeys when present", async () => {
    mockRequestJira.mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      json: async () => ({
        acceptedBuilds: [],
        rejectedBuilds: [],
        unknownIssueKeys: ["PROJ-999"],
      }),
    });

    const result = await submitBuilds([makeBuild()]);
    expect(result.unknownIssueKeys).toEqual(["PROJ-999"]);
  });
});

// ── submitDeployments ────────────────────────────────────────────────────────

describe("submitDeployments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs to /rest/deployments/0.1/bulk with correct body", async () => {
    mockRequestJira.mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      json: async () => acceptedDeploymentsResponse,
    });

    const deployment = makeDeployment();
    await submitDeployments([deployment]);

    expect(mockAsApp).toHaveBeenCalled();
    expect(mockRequestJira).toHaveBeenCalledWith(
      "/rest/deployments/0.1/bulk",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deployments: [deployment] }),
      }),
    );
  });

  it("returns accepted and rejected deployment lists", async () => {
    const rejectedResponse = {
      acceptedDeployments: [],
      rejectedDeployments: [
        {
          key: {
            pipelineId: "my-org/my-repo",
            environmentId: "production",
            deploymentSequenceNumber: 7,
          },
          errors: [{ message: "Unknown environment" }],
        },
      ],
    };
    mockRequestJira.mockResolvedValue({
      ok: false,
      status: 202,
      statusText: "Accepted",
      json: async () => rejectedResponse,
    });

    const result = await submitDeployments([makeDeployment()]);
    expect(result.acceptedDeployments).toHaveLength(0);
    expect(result.rejectedDeployments).toHaveLength(1);
    expect(result.rejectedDeployments[0]?.errors[0]?.message).toBe(
      "Unknown environment",
    );
  });

  it("returns accepted deployments on success", async () => {
    mockRequestJira.mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      json: async () => acceptedDeploymentsResponse,
    });

    const result = await submitDeployments([makeDeployment()]);
    expect(result.acceptedDeployments).toHaveLength(1);
    expect(result.acceptedDeployments[0]).toEqual({
      pipelineId: "my-org/my-repo",
      environmentId: "production",
      deploymentSequenceNumber: 7,
    });
    expect(result.rejectedDeployments).toHaveLength(0);
  });

  it("submits multiple deployments in a single request", async () => {
    mockRequestJira.mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      json: async () => ({
        acceptedDeployments: [
          {
            pipelineId: "my-org/my-repo",
            environmentId: "staging",
            deploymentSequenceNumber: 1,
          },
          {
            pipelineId: "my-org/my-repo",
            environmentId: "production",
            deploymentSequenceNumber: 2,
          },
        ],
        rejectedDeployments: [],
      }),
    });

    const deploys = [
      makeDeployment({ environmentId: "staging", deploymentSequenceNumber: 1 }),
      makeDeployment({
        environmentId: "production",
        deploymentSequenceNumber: 2,
      }),
    ];
    const result = await submitDeployments(deploys);

    const sentBody = JSON.parse(
      mockRequestJira.mock.calls[0][1].body as string,
    );
    expect(sentBody.deployments).toHaveLength(2);
    expect(result.acceptedDeployments).toHaveLength(2);
  });

  it("normalises undefined acceptedDeployments to empty array", async () => {
    mockRequestJira.mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      json: async () => ({ unknownIssueKeys: ["PROJ-999"] }),
    });

    const result = await submitDeployments([makeDeployment()]);
    expect(result.acceptedDeployments).toEqual([]);
    expect(result.rejectedDeployments).toEqual([]);
    expect(result.unknownIssueKeys).toEqual(["PROJ-999"]);
  });

  it("throws on non-202 error responses", async () => {
    mockRequestJira.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "Missing manifest module",
    });

    await expect(submitDeployments([makeDeployment()])).rejects.toThrow(
      "submitDeployments failed: 403 Forbidden",
    );
  });

  it("includes unknownAssociations when present", async () => {
    const unknownAssoc = {
      associationType: "issueIdOrKeys" as const,
      values: ["UNKNOWN-1"],
    };
    mockRequestJira.mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      json: async () => ({
        acceptedDeployments: [],
        rejectedDeployments: [],
        unknownAssociations: [unknownAssoc],
      }),
    });

    const result = await submitDeployments([makeDeployment()]);
    expect(result.unknownAssociations).toEqual([unknownAssoc]);
  });
});
