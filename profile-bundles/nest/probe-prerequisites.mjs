import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// CI-only prerequisite installation; host setup itself never installs dependencies.
const { runtime_dependencies: dependencies } = JSON.parse(readFileSync(new URL("./compatibility.json", import.meta.url), "utf8"));
if (!Array.isArray(dependencies) || dependencies.length !== 1) throw new Error("Nest compatibility needs one runtime prerequisite");
const dependency = dependencies[0];
if (!/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(dependency.name) || !/^\d+\.\d+\.\d+$/.test(dependency.version)) throw new Error("Invalid tracker probe prerequisite");
execFileSync("npm", ["install", "--global", `${dependency.name}@${dependency.version}`], { stdio: "inherit", timeout: 300000 });
