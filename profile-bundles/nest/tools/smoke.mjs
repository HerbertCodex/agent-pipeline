import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/** Starts the built application on a temporary port and always terminates it. */
export async function smoke(settings) {
  const entry = ["dist/main.js", "dist/src/main.js"].find((path) => existsSync(path));
  if (!entry) throw new Error("No built Nest entry point; run the build gate first.");
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const child = spawn(process.execPath, [entry], { env: { ...process.env, PORT: String(port), NODE_ENV: "production" }, stdio: "inherit" });
  let exited = false;
  let failure;
  const closed = new Promise((resolve) => child.once("close", () => { exited = true; resolve(); }));
  child.once("error", (error) => { failure = error; });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const deadline = Date.now() + settings.timeout_ms;
    while (Date.now() < deadline && !exited) {
      if (failure) throw failure;
      try {
        const response = await fetch(`http://127.0.0.1:${port}${settings.path}`, { signal: AbortSignal.timeout(1000), redirect: "manual" });
        await response.body?.cancel();
        if (exited) break;
        if (response.status !== settings.status) throw new Error(`Smoke expected HTTP ${settings.status}, received ${response.status}`);
        console.log(`smoke: ${settings.path} returned HTTP ${response.status}`);
        return;
      } catch (error) {
        if (error.message.startsWith("Smoke expected")) throw error;
      }
      await delay(100);
    }
    throw new Error("Smoke failed: application exited or did not become ready before its deadline.");
  } finally {
    stop();
    const force = setTimeout(() => child.kill("SIGKILL"), 1000);
    await closed;
    clearTimeout(force);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
