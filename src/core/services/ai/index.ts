/**
 * KNOUX Player X — AI service exports.
 *
 * This module exposes only the implemented OpenRouter client surface. Model
 * catalogues and media-analysis types are not exported because this client
 * does not implement those capabilities.
 */
export { OpenRouterService, openRouterService } from './OpenRouterService';
export type { AIConfig, AIResponse, StreamCallback } from './OpenRouterService';
