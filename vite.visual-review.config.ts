import { mergeConfig } from 'vite';
import application from './vite.renderer.config';
// Visual review only: use the real Android React routes with the existing browser
// adapter. This supplies runtime identity, never native capabilities or results.
export default mergeConfig(application, {
  plugins: [{
    name: 'knoux-visual-review',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head><script>
        if (!new URLSearchParams(location.search).has('desktop')) window.Capacitor = { getPlatform: () => 'android', isNativePlatform: () => true };
      </script>`);
    },
  }],
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
});
