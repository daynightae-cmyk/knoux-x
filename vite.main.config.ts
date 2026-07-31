import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: {
      external: [
        'electron',
        'better-sqlite3',
        'sharp',
        'onnxruntime-node',
        '@tensorflow/tfjs-node',
      ],
    },
  },
});
