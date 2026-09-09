import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Pins the working directory to the framework root.
 *
 * Several suites resolve fixtures, shipped templates and adapter tools
 * against the working directory, and one reads the durable run store the
 * working directory points at. Run from a host repository — which the
 * installation guide and the generated CI both do — they read the host's
 * files instead of their own. The runner gives each test file its own
 * process, so pinning the directory here reaches no other suite.
 */
export function chdirToFramework() {
  process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
}
