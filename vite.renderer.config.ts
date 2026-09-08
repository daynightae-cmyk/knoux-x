import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function knouxReleaseIdentity(): { version: string; sha: string; builtAt: string } {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
  const version = String(manifest.version || '').trim() || '0.0.0-dev';
  // KNOUX_RELEASE_SHA / KNOUX_RELEASE_BUILT_AT are stamped by the release
  // pipeline. Vercel production builds contribute VERCEL_GIT_COMMIT_SHA.
  // Anything else is honestly empty (never a fake "runtime" SHA).
  const sha = (process.env.KNOUX_RELEASE_SHA || process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
  const builtAt = (process.env.KNOUX_RELEASE_BUILT_AT || new Date().toISOString()).trim();
  return { version, sha, builtAt };
}

export default defineConfig({base:'./',plugins:[react()],define:{__KNOUX_RELEASE__:JSON.stringify(knouxReleaseIdentity())},build:{sourcemap:true,rollupOptions:{input:{index:path.resolve(__dirname,'index.html'),splash:path.resolve(__dirname,'splash.html')}}},resolve:{alias:{'@':path.resolve(__dirname,'src'),'@core':path.resolve(__dirname,'src/core'),'@components':path.resolve(__dirname,'src/components'),'@features':path.resolve(__dirname,'src/features'),'@store':path.resolve(__dirname,'src/store'),'@styles':path.resolve(__dirname,'src/styles'),'@assets':path.resolve(__dirname,'assets')}}});
