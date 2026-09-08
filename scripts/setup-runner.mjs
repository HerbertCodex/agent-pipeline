import { spawn } from "node:child_process";

/** Runs one setup step with live output, a heartbeat and process-group cleanup. */
export function runStep(name, command, args = [], { cwd = process.cwd(), timeoutMs = 120000, shell = false, env = process.env } = {}) {
  console.log(`[setup] ${name}`);
  const started = performance.now();
  return new Promise((resolve) => {
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, { cwd, shell, env, detached: grouped, stdio: "inherit" });
    let timedOut = false;
    let interrupted = false;
    let error;
    let force;
    const kill = (signal) => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* The child may have exited between the timer and the signal. */ }
    };
    const stop = () => {
      kill("SIGTERM");
      force ??= setTimeout(() => kill("SIGKILL"), 1000);
    };
    const interrupt = () => { interrupted = true; stop(); };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const timeout = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const heartbeat = setInterval(() => console.log(`[setup] ${name}: ${Math.round((performance.now() - started) / 1000)} s`), 20000);
    child.once("error", (cause) => { error = cause.message; });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      clearTimeout(force);
      // Also stop descendants left behind by a timed-out shell.
      if (timedOut || interrupted) kill("SIGKILL");
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      const result = { name, code, signal, timed_out: timedOut, interrupted, duration_ms: Math.round(performance.now() - started), ...(error ? { error } : {}) };
      console.log(`[setup] ${name}: ${code === 0 && !timedOut && !interrupted && !error ? "ok" : "FAILED"} (${result.duration_ms} ms)`);
      resolve(result);
    });
  });
}
