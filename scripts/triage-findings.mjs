import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadConfig, readJsonl, sha256 } from './lib.mjs';

/** Previews or persists explicit finding triage without creating or scheduling issues. */
function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file || (flag && flag !== '--apply')) throw new Error('usage: triage-findings.mjs <triage.json> [--apply]');
  const entries = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(entries)) throw new Error('Triage must be a list');
  const config = loadConfig();
  const records = readJsonl(join(config.store_dir, 'issues.jsonl'));
  const grouped = new Map();
  for (const entry of entries) {
    const record = records.find((item) => item.record.id === entry.source_issue);
    const finding = record?.record.discoveries_declared?.find((item) => item.title === entry.title);
    if (!finding) throw new Error(`Unknown finding: ${entry.source_issue}: ${entry.title}`);
    if (!['parked', 'resolved', 'duplicate', 'promoted'].includes(entry.status)) throw new Error('Unknown triage status');
    if (typeof entry.group !== 'string' || !entry.group.trim()) throw new Error('Triage group is required');
    if (entry.status !== 'parked' && (typeof entry.evidence !== 'string' || !entry.evidence.trim())) throw new Error('Resolution, duplicate and promotion need evidence or an explicit target');
    const request = grouped.get(entry.source_issue) ?? { target: { kind: 'issue', id: entry.source_issue }, expected_record_hash: sha256(record.raw), discoveries_declared: [] };
    request.discoveries_declared.push({ ...finding, status: entry.status, triage: { group: entry.group, evidence: entry.evidence ?? null, at: new Date().toISOString() } });
    grouped.set(entry.source_issue, request);
  }
  const requests = [...grouped.values()];
  if (!flag) { console.log(JSON.stringify(requests, null, 2)); return; }
  const directory = mkdtempSync(join(tmpdir(), 'pipeline-triage-'));
  try {
    for (const [index, request] of requests.entries()) {
      const path = join(directory, `${index}.json`); writeFileSync(path, JSON.stringify(request));
      execFileSync(process.execPath, [fileURLToPath(new URL('./store-update.mjs', import.meta.url)), path], { stdio: 'inherit' });
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
