import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, readJsonl } from "./lib.mjs";

/**
 * Splits a store's recorded time into work and waiting.
 *
 * The measurement this exists to make could not be made before. Between two
 * closures of a real run sat fourteen hours with no block, and nothing said
 * whether an agent was working or nobody was at the keyboard. The two are
 * opposite diagnoses — one calls for a lighter pipeline, the other for
 * nobody's attention at all — and tuning without the distinction is tuning
 * blind.
 *
 * Three timestamps bound a step. `started_at` is when the orchestrator
 * dispatched it, `ended_at` when the agent handed its work back, `at` when
 * the orchestrator finished validating and persisted. So the step splits in
 * two — the agent's turnaround, then the validation that confronts the scope
 * with the diff, replays the red proof and reads the store's invariants. What
 * lies between one `at` and the next `started_at` is time nobody spent on
 * this issue at all.
 *
 * Both stamps are the orchestrator's, written by the one role that writes the
 * store. Nothing here trusts an agent's account of its own duration.
 *
 * A step with no `started_at` is counted as unknown, never as zero: records
 * written before the stamp existed would otherwise report a pipeline faster
 * than it ever was.
 *
 * Alongside the split, `elapsed` reports what the journal could always say:
 * the wall clock between two persisted steps, work and waiting mixed. It has
 * its own column so a run recorded before the stamp is not a blank page, and
 * so nobody reads it as the split.
 *
 * @param records - the issue records to read
 * @returns totals in seconds, per phase and overall
 */
export function split(records) {
  const byPhase = {};
  let work = 0;
  let agent = 0;
  let validation = 0;
  let waiting = 0;
  let elapsed = 0;
  let unknown = 0;
  let unsplit = 0;

  for (const record of records) {
    const steps = record.transitions ?? [];
    let previousEnd = null;

    for (const step of steps) {
      const end = Date.parse(step.at);
      const phase = step.from ?? "start";
      byPhase[phase] ??= { work: 0, agent: 0, validation: 0, waiting: 0, elapsed: 0, steps: 0, unknown: 0 };
      byPhase[phase].steps += 1;

      // Elapsed is what the journal could always say: the wall clock between
      // two persisted steps, work and waiting mixed and indistinguishable. It
      // is kept in its own column so a run recorded before the stamp is not a
      // blank page, and so nobody mistakes it for the split.
      if (previousEnd != null && !Number.isNaN(end)) {
        elapsed += (end - previousEnd) / 1000;
        byPhase[phase].elapsed += (end - previousEnd) / 1000;
      }

      if (step.started_at == null) {
        unknown += 1;
        byPhase[phase].unknown += 1;
      } else {
        const begin = Date.parse(step.started_at);
        if (Number.isNaN(begin) || Number.isNaN(end)) {
          throw new Error(`${record.id}: a step carries an unreadable timestamp`);
        }
        if (begin > end) {
          throw new Error(
            `${record.id}: a step persisted at ${step.at} says it began at ${step.started_at}, which is later. ` +
              "A negative duration is a clock or a fabrication, and averaging it in would hide both.",
          );
        }
        const spent = (end - begin) / 1000;
        work += spent;
        byPhase[phase].work += spent;

        // A step with no hand-back keeps its total: it WAS measured, only its
        // split is missing. Reporting the whole of it as the agent's would
        // charge the agent for the orchestrator's validation.
        if (step.ended_at == null) {
          unsplit += 1;
        } else {
          const handed = Date.parse(step.ended_at);
          if (Number.isNaN(handed) || handed < begin || handed > end) {
            throw new Error(
              `${record.id}: ended_at ${step.ended_at} falls outside the step it belongs to ` +
                `(${step.started_at} .. ${step.at}). A hand-back the step does not contain is a clock or a fabrication.`,
            );
          }
          agent += (handed - begin) / 1000;
          validation += (end - handed) / 1000;
          byPhase[phase].agent += (handed - begin) / 1000;
          byPhase[phase].validation += (end - handed) / 1000;
        }
        if (previousEnd != null && begin > previousEnd) {
          const idle = (begin - previousEnd) / 1000;
          waiting += idle;
          byPhase[phase].waiting += idle;
        }
      }
      previousEnd = end;
    }
  }

  return { work, agent, validation, waiting, elapsed, unknown, unsplit, byPhase };
}

/**
 * Renders a duration in a form a human reads at a glance.
 *
 * @param seconds - the duration
 * @returns hours and minutes, or minutes alone under an hour
 */
function human(seconds) {
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours} h ${String(minutes).padStart(2, "0")}` : `${minutes} min`;
}

/**
 * Reports where a spec's time went, phase by phase.
 *
 * Usage: node timings.mjs [--spec <spec-id>] [--json]
 */
function main() {
  const args = process.argv.slice(2);
  const specIndex = args.indexOf("--spec");
  const specId = specIndex === -1 ? null : args[specIndex + 1];

  const config = loadConfig();
  const records = readJsonl(join(config.store_dir, "issues.jsonl"))
    .map((entry) => entry.record)
    .filter((record) => specId == null || record.spec_id === specId);

  const measured = split(records);

  if (args.includes("--json")) {
    console.log(JSON.stringify(measured, null, 2));
    return;
  }

  const rows = Object.entries(measured.byPhase).sort((a, b) => b[1].elapsed - a[1].elapsed);
  const width = Math.max(...rows.map(([phase]) => phase.length), 5);
  console.log(
    `${"phase".padEnd(width)}  ${"steps".padStart(5)}  ${"elapsed".padStart(9)}  ` +
      `${"work".padStart(9)}  ${"waiting".padStart(9)}  unmeasured`,
  );
  for (const [phase, cell] of rows) {
    console.log(
      `${phase.padEnd(width)}  ${String(cell.steps).padStart(5)}  ${human(cell.elapsed).padStart(9)}  ` +
        `${human(cell.work).padStart(9)}  ${human(cell.waiting).padStart(9)}  ` +
        `${cell.unknown > 0 ? `${cell.unknown} step(s)` : "—"}`,
    );
  }

  const measurable = measured.work + measured.waiting;
  console.log("");
  console.log(`elapsed  ${human(measured.elapsed)}   (work and waiting mixed)`);
  console.log(`worked   ${human(measured.work)}`);
  if (measured.agent > 0 || measured.validation > 0) {
    console.log(`  of which  ${human(measured.agent)} agent, ${human(measured.validation)} validation`);
  }
  console.log(`waited   ${human(measured.waiting)}`);
  if (measurable > 0) {
    console.log(`  ${Math.round((measured.work / measurable) * 100)}% of the measured time was a step running.`);
  }
  if (measured.unsplit > 0) {
    console.log(
      `\n${measured.unsplit} step(s) were measured but carry no hand-back time: their total is counted, ` +
        "their split between agent and validation is not.",
    );
  }
  if (measured.unknown > 0) {
    console.log(
      `\n${measured.unknown} step(s) carry no dispatch time and are counted in neither column. ` +
        "They were written before the stamp existed; they are not zero, they are unmeasured.",
    );
  }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) main();
