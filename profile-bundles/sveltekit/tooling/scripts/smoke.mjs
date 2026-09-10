import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';

const PORT = Number(process.env.SMOKE_PORT ?? 4174);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const LISTEN_TIMEOUT_MS = 30_000;

function fail(message) {
	console.error(`smoke: FAIL — ${message}`);
	process.exit(1);
}

if (!existsSync('build/index.js')) {
	fail('build/ output not found. Run `npm run build` first (gate contract: build, then smoke).');
}

const server = spawn('node', ['build'], {
	env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
	detached: true,
	stdio: ['ignore', 'pipe', 'pipe']
});

let serverLog = '';
server.stdout.on('data', (chunk) => (serverLog += chunk));
server.stderr.on('data', (chunk) => (serverLog += chunk));

function stopServer() {
	try {
		process.kill(-server.pid, 'SIGTERM');
	} catch {
		// process group already gone
	}
}

process.on('exit', stopServer);

const deadline = Date.now() + LISTEN_TIMEOUT_MS;
let listening = false;
while (Date.now() < deadline) {
	if (server.exitCode !== null) {
		fail(`server exited before listening (code ${server.exitCode}). Output:\n${serverLog}`);
	}
	try {
		const response = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(1000) });
		await response.arrayBuffer();
		listening = true;
		break;
	} catch {
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

if (!listening) {
	stopServer();
	fail(`server did not listen on ${BASE_URL} within ${LISTEN_TIMEOUT_MS}ms. Output:\n${serverLog}`);
}

const response = await fetch(`${BASE_URL}/`);
const body = await response.text();

stopServer();

if (response.status !== 200) {
	fail(`GET / returned HTTP ${response.status}, expected 200.`);
}

console.log(`smoke: OK — GET ${BASE_URL}/ → 200 (${body.length} bytes)`);
process.exit(0);
