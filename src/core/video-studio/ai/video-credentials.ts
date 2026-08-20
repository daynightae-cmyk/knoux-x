/**
 * KNOUX-X — VIDEO STUDIO CREDENTIALS
 *
 * Credential validation and consent management for video providers.
 * Follows the same architecture as the Image Studio credentials module.
 */

import type { VideoProviderId } from './video-catalog';

// ═══════════════════════════════════════════════════════════════════════════
// Credential status
// ═══════════════════════════════════════════════════════════════════════════

export interface VideoProviderCredentialStatus {
  provider: VideoProviderId;
  configured: boolean;
  keyMasked: string | null;
  consented: boolean;
  scopes: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Key validation
// ═══════════════════════════════════════════════════════════════════════════

export function validateVideoApiKey(provider: VideoProviderId, key: string): { valid: boolean; reason?: string } {
  if (!key || key.trim().length === 0) return { valid: false, reason: 'Key is empty' };

  switch (provider) {
    case 'huggingface':
      if (!key.startsWith('hf_')) return { valid: false, reason: 'HF token must start with hf_' };
      if (key.length < 25) return { valid: false, reason: 'HF token too short' };
      return { valid: true };
    case 'fal':
      if (key.length < 32) return { valid: false, reason: 'fal.ai key too short (min 32 chars)' };
      return { valid: true };
    case 'replicate':
      if (!key.startsWith('r8_')) return { valid: false, reason: 'Replicate token must start with r8_' };
      if (key.length < 30) return { valid: false, reason: 'Replicate token too short' };
      return { valid: true };
    case 'openrouter':
      if (!key.startsWith('sk-or-')) return { valid: false, reason: 'OpenRouter key must start with sk-or-' };
      if (key.length < 40) return { valid: false, reason: 'OpenRouter key too short' };
      return { valid: true };
    default:
      return { valid: false, reason: `No key validation for provider: ${provider}` };
  }
}

export function validateKnouxVideoSessionToken(token: string): { valid: boolean; reason?: string } {
  if (!token || token.trim().length === 0) return { valid: false, reason: 'Session token is empty' };
  if (token.startsWith('sk-') || token.startsWith('hf_') || token.startsWith('fal-') || token.startsWith('r8_'))
    return { valid: false, reason: 'Session token looks like a provider API key — rejected' };
  if (token.length < 16) return { valid: false, reason: 'Session token too short' };
  return { valid: true };
}

export function validateVideoGatewayBaseUrl(url: string): { valid: boolean; reason?: string } {
  if (!url || url.trim().length === 0) return { valid: false, reason: 'Gateway URL is empty' };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost')
      return { valid: false, reason: 'Gateway URL must use HTTPS (or localhost)' };
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Required scopes per provider
// ═══════════════════════════════════════════════════════════════════════════

export const VIDEO_PROVIDER_REQUIRED_SCOPES: Record<VideoProviderId, string[]> = {
  huggingface: ['inference', 'video'],
  fal: ['video', 'generate'],
  'knoux-cloud': ['video', 'generate'],
  replicate: ['video', 'generate'],
  openrouter: ['video', 'generate'],
  mock: [],
};

export function videoProvidersForScope(scope: string): VideoProviderId[] {
  return (Object.keys(VIDEO_PROVIDER_REQUIRED_SCOPES) as VideoProviderId[]).filter(
    (id) => VIDEO_PROVIDER_REQUIRED_SCOPES[id].includes(scope),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Mask key for display
// ═══════════════════════════════════════════════════════════════════════════

export function maskVideoKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}