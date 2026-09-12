import { spawn } from 'node:child_process';

// Exercise the production React/Vite bundle without touching deployment output.
// In-browser development transforms and StrictMode are not release behaviour.
const env = { ...process.env, NODE_ENV: 'production' };
const args = ['--filter', '@atheriam/client', 'exec', 'vite'];
// pretest:e2e builds this isolated output before the backend servers start.
const preview = spawn(
  'pnpm',
  [
    ...args,
    'preview',
    '--outDir',
    '../../.e2e-client',
    '--port',
    process.env['VITE_PORT']!,
    '--strictPort',
  ],
  { env, stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => preview.kill(signal));
preview.on('exit', (code) => process.exit(code ?? 1));
