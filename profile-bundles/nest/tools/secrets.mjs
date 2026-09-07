import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";

export function secretKind(text) {
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(text)) return "private key";
  if (/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(text)) return "AWS access key";
  if (/\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/.test(text)) return "GitHub token";
  if (/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/.test(text)) return "Slack token";
  return null;
}

/** Scans tracked and untracked non-ignored files without printing credentials. */
export function scanSecrets() {
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ".",
    ":(exclude)node_modules/**", ":(exclude)dist/**", ":(exclude)coverage/**", ":(exclude)agent-pipeline/**"],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\0").filter(Boolean);
  const findings = [];
  for (const path of new Set(paths)) {
    if (path.startsWith("agent-pipeline/")) continue;
    let stat;
    try { stat = lstatSync(path); } catch { continue; }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const data = readFileSync(path);
    if (data.includes(0)) continue;
    const kind = secretKind(data.toString("utf8"));
    if (kind) findings.push(`${path}: ${kind}`);
  }
  if (findings.length) throw new Error(findings.join("\n"));
  console.log(`secrets_scan: ${paths.length} candidate file(s), no recognized credential.`);
}
