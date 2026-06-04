import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    actiontypes: "./src/actiontypes.ts",
    "util/errors": "./src/util/errors.ts",
    "config/index": "./src/config/index.ts",
    "rovo/index": "./src/rovo/index.ts",
    "forge/remote/index": "./src/forge/remote/index.ts",
    "forge/remote/jwt": "./src/forge/remote/jwt.ts",
    // OpenAPI type-only subpath exports (apis/*)
    "apis/api-access": "./src/apis/api-access/types.ts",
    "apis/assets": "./src/apis/assets/types.ts",
    "apis/bitbucket": "./src/apis/bitbucket/types.ts",
    "apis/confluence-1": "./src/apis/confluence-1/types.ts",
    "apis/confluence-2": "./src/apis/confluence-2/types.ts",
    "apis/jira-platform-2": "./src/apis/jira-platform-2/types.ts",
    "apis/jira-platform-3": "./src/apis/jira-platform-3/types.ts",
    "apis/jira-service-desk-ops": "./src/apis/jira-service-desk-ops/types.ts",
    "apis/jira-servicedesk": "./src/apis/jira-servicedesk/types.ts",
    "apis/jira-software": "./src/apis/jira-software/types.ts",
    // Jira typed-wrapper subpath exports (jira/*)
    "jira/devops": "./src/jira/devops/index.ts",
  },
  format: ["esm"],
  sourcemap: true,
  target: "node20",
  deps: {
    external: ["typescript", "yaml"],
  },
});
