import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// CI-only prerequisite installation; host setup itself never installs dependencies.
const { probes } = JSON.parse(readFileSync(new URL("./compatibility.json", import.meta.url), "utf8"));
if (!/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(probes.tracker_package) || !/^\d+\.\d+\.\d+$/.test(probes.tracker_version)) throw new Error("Invalid tracker probe prerequisite");
execFileSync("npm", ["install", "--global", `${probes.tracker_package}@${probes.tracker_version}`], { stdio: "inherit", timeout: 300000 });
