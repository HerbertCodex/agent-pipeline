import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig, fail } from "./lib.mjs";
import { createTrackerIssue, createTrackerSpec, ensureTrackerLink } from "./issue-tracker.mjs";

function readRequest(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`tracker mutation request is unreadable: ${error.message}`);
  }
}

function main() {
  const path = process.argv[2];
  if (path == null) fail("usage: tracker-mutate.mjs <request.json>");
  const request = readRequest(path);
  const config = loadConfig();
  try {
    if (request?.operation === "create_issue") {
      const outcome = createTrackerIssue(request, config);
      console.log(JSON.stringify({ operation: request.operation, id: outcome.entry.record.id, skipped: outcome.skipped === true }));
      return;
    }
    if (request?.operation === "create_spec") {
      const outcome = createTrackerSpec(request, config);
      console.log(JSON.stringify({ operation: request.operation, id: outcome.entry.record.id, skipped: outcome.skipped === true }));
      return;
    }
    if (request?.operation === "link") {
      const outcome = ensureTrackerLink(request, config);
      console.log(JSON.stringify({ operation: request.operation, skipped: outcome.skipped === true }));
      return;
    }
    fail("tracker mutation operation must be create_issue, create_spec or link");
  } catch (error) {
    fail(error.message);
  }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) main();
