import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const server = await createServer({ root });
await server.listen();
const { port } = server.httpServer.address();
const env = { ...process.env, UNDERCTRL_VITE_PORT: String(port) };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [root, ...process.argv.slice(2)], { stdio: 'inherit', env });
process.once('SIGINT', () => child.kill());
process.once('SIGTERM', () => child.kill());
try {
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('exit', code => resolve(code ?? 0));
    child.once('error', reject);
  });
} finally { await server.close(); }
