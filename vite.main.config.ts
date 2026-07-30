import { defineConfig } from 'vite';
export default defineConfig({build:{sourcemap:true,rollupOptions:{external:['electron','electron-squirrel-startup','electron-log','better-sqlite3','sharp','onnxruntime-node','@tensorflow/tfjs-node']}}});
