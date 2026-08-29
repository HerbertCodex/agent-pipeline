import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const dashboard = join(here, "..", "dashboard");

describe("dashboard container: isolation without pretending to contain the agent runtime", () => {
  test("runs as a non-root Node process with git and no project dependency install", () => {
    const dockerfile = readFileSync(join(dashboard, "Dockerfile"), "utf8");

    assert.match(dockerfile, /^FROM node:22-bookworm-slim$/m);
    assert.match(dockerfile, /apt-get install[^\n]*ca-certificates[^\n]*git/);
    assert.match(dockerfile, /^USER node$/m);
    assert.match(dockerfile, /^WORKDIR \/workspace$/m);
    assert.doesNotMatch(dockerfile, /npm (?:ci|install)|pnpm|yarn/);
  });

  test("publishes the page on host loopback and mounts only the declared project", () => {
    const compose = readFileSync(join(dashboard, "compose.yaml"), "utf8");

    assert.match(compose, /AGENT_PIPELINE_DASHBOARD_PORT:-4399/);
    assert.match(compose, /:4399"/);
    assert.match(compose, /AGENT_PIPELINE_PROJECT[^\n]*:\/workspace/);
    assert.match(compose, /init:\s*true/);
    assert.doesNotMatch(compose, /docker\.sock/);
  });

  test("the image opts into container binding instead of weakening the server default", () => {
    const dockerfile = readFileSync(join(dashboard, "Dockerfile"), "utf8");

    assert.match(dockerfile, /"--host",\s*"0\.0\.0\.0"/);
    assert.match(dockerfile, /"--allow-non-loopback"/);
    assert.match(dockerfile, /HEALTHCHECK[^\n]*$/m);
    assert.match(dockerfile, /127\.0\.0\.1:4399\/api\/snapshot/);
  });
});
