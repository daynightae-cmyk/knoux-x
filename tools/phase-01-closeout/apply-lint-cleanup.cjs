'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || process.cwd());

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content, 'utf8');
}

function replaceExact(relativePath, before, after, label) {
  const source = read(relativePath);
  if (source.includes(after)) {
    console.log(`[SKIP] ${relativePath}: ${label} already applied`);
    return;
  }
  if (!source.includes(before)) {
    throw new Error(`Expected block for ${label} was not found in ${relativePath}`);
  }
  write(relativePath, source.replace(before, after));
  console.log(`[FIX] ${relativePath}: ${label}`);
}

// Keep the splash text list stable so the progress effect has an accurate dependency set.
replaceExact(
  'src/App.tsx',
  "interface SplashScreenProps {\n  onComplete: () => void;\n}\n\nconst SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {",
  "const SPLASH_LOADING_TEXTS = [\n  'Initializing Core Systems',\n  'Loading Neural DSP Engine',\n  'Connecting AI Services',\n  'Optimizing Video Pipeline',\n  'Loading Media Library',\n  'Ready to Launch',\n] as const;\n\ninterface SplashScreenProps {\n  onComplete: () => void;\n}\n\nconst SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {",
  'define stable splash loading texts',
);
replaceExact(
  'src/App.tsx',
  "\n  const loadingTexts = [\n    'Initializing Core Systems',\n    'Loading Neural DSP Engine',\n    'Connecting AI Services',\n    'Optimizing Video Pipeline',\n    'Loading Media Library',\n    'Ready to Launch',\n  ];\n",
  '',
  'remove component-local splash loading texts',
);
{
  const relativePath = 'src/App.tsx';
  const source = read(relativePath);
  const updated = source
    .replace(/loadingTexts\.length/g, 'SPLASH_LOADING_TEXTS.length')
    .replace(/loadingTexts\[textIndex\]/g, 'SPLASH_LOADING_TEXTS[textIndex]');
  if (updated !== source) {
    write(relativePath, updated);
    console.log(`[FIX] ${relativePath}: reference stable splash loading texts`);
  }
}

replaceExact(
  'src/components/neon/NeonInput.tsx',
  "import React, { useState, forwardRef } from 'react';",
  "import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';",
  'use named React value and type imports',
);
replaceExact(
  'src/components/neon/NeonInput.tsx',
  'export interface NeonInputProps extends React.InputHTMLAttributes<HTMLInputElement> {',
  'export interface NeonInputProps extends InputHTMLAttributes<HTMLInputElement> {',
  'use direct InputHTMLAttributes type',
);
{
  const relativePath = 'src/components/neon/NeonInput.tsx';
  const source = read(relativePath);
  const updated = source.replace(/React\.ReactNode/g, 'ReactNode');
  if (updated !== source) {
    write(relativePath, updated);
    console.log(`[FIX] ${relativePath}: use direct ReactNode type`);
  }
}

replaceExact(
  'src/main.tsx',
  "import ReactDOM from 'react-dom/client';",
  "import { createRoot } from 'react-dom/client';",
  'use named createRoot import',
);
replaceExact(
  'src/main.tsx',
  "const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);",
  "const root = createRoot(document.getElementById('root') as HTMLElement);",
  'call named createRoot import',
);

replaceExact(
  'src/core/services/ai/OpenRouterService.ts',
  "export interface ServiceStatus {\n  isOnline: boolean;\n  latency: number;\n  model: string;\n}\n",
  "export interface ServiceStatus {\n  isOnline: boolean;\n  latency: number;\n  model: string;\n}\n\ninterface OpenRouterMessage {\n  role: ChatMessage['role'];\n  content: string;\n}\n\ninterface OpenRouterErrorResponse {\n  error?: {\n    message?: string;\n  };\n}\n\ninterface OpenRouterChatResponse {\n  choices?: Array<{\n    message?: {\n      content?: string;\n    };\n  }>;\n}\n\ninterface OpenRouterStreamChunk {\n  choices?: Array<{\n    delta?: {\n      content?: string;\n    };\n  }>;\n}\n",
  'define typed OpenRouter payloads',
);
replaceExact(
  'src/core/services/ai/OpenRouterService.ts',
  '  private requestQueue: Promise<any> = Promise.resolve();',
  '  private requestQueue: Promise<unknown> = Promise.resolve();',
  'type the serialized request queue',
);
replaceExact(
  'src/core/services/ai/OpenRouterService.ts',
  "  private async makeRequest(endpoint: string, body: any): Promise<any> {\n    if (!this.apiKey) {\n      throw new Error('API key not configured');\n    }\n\n    return this.requestQueue = this.requestQueue.then(async () => {\n      this.abortController = new AbortController();\n\n      try {\n        const response = await fetch(`${this.baseUrl}${endpoint}`, {\n          method: 'POST',\n          headers: {\n            'Authorization': `Bearer ${this.apiKey}`,\n            'Content-Type': 'application/json',\n            'HTTP-Referer': 'https://knoux-player.app',\n            'X-Title': 'KNOUX Player X',\n          },\n          body: JSON.stringify(body),\n          signal: this.abortController.signal,\n        });\n\n        if (!response.ok) {\n          const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));\n          throw new Error(error.error?.message || `HTTP ${response.status}`);\n        }\n\n        return response.json();\n      } catch (error) {\n        if (error instanceof Error && error.name === 'AbortError') {\n          throw new Error('Request cancelled');\n        }\n        throw error;\n      }\n    });\n  }",
  "  private async makeRequest<TResponse>(\n    endpoint: string,\n    body: Record<string, unknown>\n  ): Promise<TResponse> {\n    if (!this.apiKey) {\n      throw new Error('API key not configured');\n    }\n\n    const request = this.requestQueue.then(async (): Promise<TResponse> => {\n      this.abortController = new AbortController();\n\n      try {\n        const response = await fetch(`${this.baseUrl}${endpoint}`, {\n          method: 'POST',\n          headers: {\n            'Authorization': `Bearer ${this.apiKey}`,\n            'Content-Type': 'application/json',\n            'HTTP-Referer': 'https://knoux-player.app',\n            'X-Title': 'KNOUX Player X',\n          },\n          body: JSON.stringify(body),\n          signal: this.abortController.signal,\n        });\n\n        if (!response.ok) {\n          const errorPayload = await response.json().catch(\n            (): OpenRouterErrorResponse => ({ error: { message: 'Unknown error' } })\n          ) as OpenRouterErrorResponse;\n          throw new Error(errorPayload.error?.message || `HTTP ${response.status}`);\n        }\n\n        return response.json() as Promise<TResponse>;\n      } catch (error) {\n        if (error instanceof Error && error.name === 'AbortError') {\n          throw new Error('Request cancelled');\n        }\n        throw error;\n      }\n    });\n\n    this.requestQueue = request;\n    return request;\n  }",
  'type generic OpenRouter requests and responses',
);
replaceExact(
  'src/core/services/ai/OpenRouterService.ts',
  "      const response = await this.makeRequest('/chat/completions', {",
  "      const response = await this.makeRequest<OpenRouterChatResponse>('/chat/completions', {",
  'type chat completion response',
);
replaceExact(
  'src/core/services/ai/OpenRouterService.ts',
  '              const parsed = JSON.parse(data);',
  '              const parsed = JSON.parse(data) as OpenRouterStreamChunk;',
  'type streamed response chunks',
);
replaceExact(
  'src/core/services/ai/OpenRouterService.ts',
  '  private buildMessages(userMessage: string): any[] {\n    const messages: any[] = [',
  '  private buildMessages(userMessage: string): OpenRouterMessage[] {\n    const messages: OpenRouterMessage[] = [',
  'type OpenRouter message construction',
);

replaceExact(
  'src/core/services/audio/AudioEngine.ts',
  "  public async setAudioDevice(deviceId: string): Promise<void> {\n    if (this.mediaElement) {\n      if (typeof (this.mediaElement as any).setSinkId === 'function') {\n        await (this.mediaElement as any).setSinkId(deviceId);\n        this.emit('device-change', deviceId);\n      }\n    }\n  }",
  "  public async setAudioDevice(deviceId: string): Promise<void> {\n    if (!this.mediaElement) return;\n\n    const sinkCapableElement = this.mediaElement as HTMLMediaElement & {\n      setSinkId?: (sinkId: string) => Promise<void>;\n    };\n\n    if (typeof sinkCapableElement.setSinkId === 'function') {\n      await sinkCapableElement.setSinkId(deviceId);\n      this.emit('device-change', deviceId);\n    }\n  }",
  'type setSinkId support without any',
);

console.log('KNOUX Phase 01 lint cleanup completed.');
