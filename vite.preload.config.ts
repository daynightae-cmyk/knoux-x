import { defineConfig } from 'vite';
export default defineConfig({build:{sourcemap:process.env.KNOUX_SOURCEMAPS === '1',rollupOptions:{external:['electron']}}});
