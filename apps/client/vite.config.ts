import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // The browser tests run their own copy on another port, so that they never
    // collide with — or quietly drive — the live game on this machine.
    port: Number(process.env['VITE_PORT'] ?? 5173),
    strictPort: true,
  },
  build: {
    target: 'es2022',
    // Phaser is large and changes rarely; keeping it in its own file means a
    // change to our code does not make players download the engine again.
    rollupOptions: {
      input: {
        site: fileURLToPath(new URL('./index.html', import.meta.url)),
        play: fileURLToPath(new URL('./play/index.html', import.meta.url)),
      },
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
});
