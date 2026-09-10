import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { loadConfig, fail, matchAny } from "./lib.mjs";
import { walk } from "./surface.mjs";

/**
 * The credential shapes a line can carry, whatever the surrounding language.
 *
 * Each rule names a format tight enough that a hit is almost never chance:
 * a fixed prefix and a fixed length, a key header, or a long literal handed
 * to a variable whose name announces a credential. The list is short on
 * purpose: a scanner that flags everything is a scanner that gets switched
 * off, and a loose pattern reports so much noise that the real hit drowns.
 *
 * `secret` isolates, for the report and the allow list, the part of the
 * match that must never be printed whole. Absent a group, the whole match
 * is the secret.
 */
const RULES = [
  { name: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github-token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { name: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "high-entropy-assignment", pattern: /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"](?<secret>[^'"]{16,})['"]/i },
];

/**
 * What an absent `skip` removes: dependency mirrors, version control,
 * generated output and lockfiles. A lockfile carries resolved URLs and
 * integrity hashes that trip credential shapes without being credentials,
 * and a vendored dependency is a tree nobody here can rotate.
 */
const DEFAULT_SKIP = /(^|[/\\])(node_modules|\.git|dist|build|coverage)([/\\]|$)|(?:^|[/\\])(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;

/**
 * Replaces the secret in a line with its first characters.
 *
 * The report lands in CI logs and agent transcripts, both kept and both
 * read by whatever runs later: printing the credential would spread it
 * wider than the file ever did. The first characters stay so two hits on
 * different values can still be told apart.
 *
 * @param line - the source line carrying the hit
 * @param secret - the matched secret inside it
 * @returns the line, its secret reduced to at most four characters
 */
function redact(line, secret) {
  return line.replace(secret, `${secret.slice(0, 4)}...`);
}

/**
 * Sweeps the declared roots for hard-coded credentials.
 *
 * It reads **patterns, not entropy**. It knows a handful of credential
 * formats and nothing else: a secret of an unknown shape, one split across
 * lines, one encoded, or a short password assigned to a variable named
 * differently all pass. The sweep is a floor, not a proof of absence —
 * a project that needs more replaces it through `commands.secrets_scan`
 * with a dedicated analyser, the same way a profile replaces `sast`.
 *
 * The roots are required and never guessed. A sweep of the wrong tree
 * exits zero for the wrong reason, and a green that measures nothing is
 * worse than a red: the credential sits one directory over, unscanned.
 *
 * A hit is not automatically a defect: documentation carries example keys,
 * and a fixture may plant one on purpose. Suppressing one is a gate change,
 * therefore human review — and it belongs in `secrets_scan.allow` in the
 * committed configuration, where it is read, not inline in the file it
 * excuses.
 *
 * Usage: node secrets-scan.mjs
 */
function main() {
  const config = loadConfig();
  const settings = config.secrets_scan ?? {};
  const roots = settings.roots;
  if (!Array.isArray(roots) || roots.length === 0 || roots.some((root) => typeof root !== "string" || root.trim().length === 0)) {
    fail(
      "secrets_scan.roots missing or invalid: name the directories to sweep. They are not guessed — " +
        "a sweep of the wrong tree is green for the wrong reason, and the credential sits one directory over.",
    );
  }
  const globs = Array.isArray(settings.skip) ? settings.skip : null;
  const skip = typeof settings.skip === "string" ? new RegExp(settings.skip) : (globs == null ? DEFAULT_SKIP : null);
  const allowed = (Array.isArray(settings.allow) ? settings.allow : []).map((source) => new RegExp(source));

  const findings = [];
  let files = 0;

  for (const root of roots) {
    for (const path of walk(root, skip)) {
      const shown = relative(".", path).split(sep).join("/");
      if (globs != null && matchAny(shown, globs)) continue;
      files += 1;
      readFileSync(path, "utf8").split("\n").forEach((line, index) => {
        for (const { name, pattern } of RULES) {
          const match = line.match(pattern);
          if (match == null) continue;
          const secret = match.groups?.secret ?? match[0];
          if (allowed.some((regex) => regex.test(secret))) continue;
          findings.push(`${shown}:${index + 1}: ${name} — ${redact(line.trim(), secret)}`);
        }
      });
    }
  }

  if (files === 0) fail(`no file to sweep under ${roots.join(", ")}: a scan of nothing is green for the wrong reason.`);

  if (findings.length > 0) {
    console.error(`${findings.length} possible credential(s):`);
    for (const line of findings) console.error(`  ${line}`);
    fail(
      "Each one is a value to rotate or to argue, never to ignore. A known-safe hit — a documentation " +
        "example key — belongs in secrets_scan.allow in the committed configuration, with its reason, " +
        "never inline in the file it excuses.",
    );
  }
  console.log(`secrets_scan: ${files} file(s) swept, no recognized credential.`);
  console.log("  It matches tight patterns, not entropy: a secret of an unknown shape, split across lines or encoded, passes.");
}

main();
