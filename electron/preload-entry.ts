/**
 * Packaged preload entrypoint.
 *
 * Forge builds this file as the single renderer bridge. Each imported module
 * exposes one documented, least-privilege API namespace; keeping the assembly
 * here prevents the packaged app from silently receiving a settings-only API.
 */
import './preload-runtime';
import './preload';
import './preload-creative-expose';
import './preload-image-studio';
import './preload-multitrack';
import './preload-recording';
import './preload-slideshow';
import './preload-audio-tools';
import './preload-video-studio';
