import { describe, expect, it } from "vitest";
import {
  getManifestScopes,
  loadManifest,
  type ParsedManifest,
} from "./manifest-helpers";

type JiraGlobalPage = {
  key: string;
  resource: string;
  render: string;
  resolver: { function: string };
};

type ManifestWithJiraGlobalPage = ParsedManifest & {
  modules: ParsedManifest["modules"] & {
    "jira:globalPage"?: JiraGlobalPage[];
    "jiraServiceManagement:queuePage"?: unknown[];
  };
};

describe("JEC sample app manifest", () => {
  it("should expose a single Jira global page backed by the resolver", () => {
    const manifest = loadManifest() as ManifestWithJiraGlobalPage;
    const globalPages = manifest.modules["jira:globalPage"] || [];

    expect(globalPages).toHaveLength(1);
    expect(globalPages[0]).toMatchObject({
      key: "jec-event-bridge-global-page",
      resource: "main",
      render: "native",
      resolver: { function: "resolver" },
    });
    expect(manifest.modules["jiraServiceManagement:queuePage"] || []).toEqual(
      [],
    );
  });

  it("should have the asApp dispatch webtrigger module", () => {
    const manifest = loadManifest();
    expect(manifest.modules.webtrigger || []).toEqual([
      expect.objectContaining({
        key: "jec-dispatch-webtrigger",
        function: "dispatchViaWebtrigger",
      }),
    ]);
  });

  it("should wire cleanup function through scheduledTrigger", () => {
    const manifest = loadManifest();

    expect(manifest.modules.scheduledTrigger || []).toEqual([
      expect.objectContaining({
        key: "jec-cleanup",
        function: "cleanup",
        interval: "hour",
      }),
    ]);
  });

  it("should declare storage and JEC provisioning scopes", () => {
    const scopes = new Set(getManifestScopes(loadManifest()));

    expect(scopes.has("storage:app")).toBe(true);
    expect(scopes.has("read:ops-config:jira-service-management")).toBe(true);
    expect(scopes.has("write:ops-config:jira-service-management")).toBe(true);
    expect(scopes.has("delete:ops-config:jira-service-management")).toBe(true);
  });
});
