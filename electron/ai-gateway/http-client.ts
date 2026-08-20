/**
 * Minimal injectable HTTP client for the AI gateway, main-process only.
 *
 * Kept tiny on purpose: no provider SDKs. A `fetch` implementation is
 * injected so unit tests can stub every network call without a server.
 */
import { AiGatewayError } from './contracts';

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  /** Text form of the body (empty when the body is not text). */
  body: string;
  /** Raw body bytes; present when the response was fetched as binary. */
  bytes: Uint8Array | null;
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Raw body override; when set, `body` is ignored. */
  rawBody?: string;
  rawContentType?: string;
  /** Fetch the response body as binary bytes instead of text. */
  binary?: boolean;
}

export interface HttpClient {
  post(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  get(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  delete(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function createHttpClient(fetchImpl: typeof fetch = fetch): HttpClient {
  async function request(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          ...(options.headers ?? {}),
          ...(options.rawBody !== undefined
            ? { 'content-type': options.rawContentType ?? 'application/json' }
            : options.body !== undefined
              ? { 'content-type': 'application/json' }
              : {}),
        },
        body:
          options.rawBody !== undefined
            ? options.rawBody
            : options.body !== undefined
              ? JSON.stringify(options.body)
              : undefined,
        signal: controller.signal,
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      if (options.binary === true) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        return { status: response.status, headers, body: '', bytes };
      }
      const text = await response.text();
      return { status: response.status, headers, body: text, bytes: null };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AiGatewayError('timeout', `Request to ${redactUrl(url)} timed out.`, null, true);
      }
      throw new AiGatewayError(
        'http',
        `Request to ${redactUrl(url)} failed: ${error instanceof Error ? error.message : String(error)}`,
        null,
        true
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    post: (url, options) => request('POST', url, options),
    get: (url, options) => request('GET', url, options),
    delete: (url, options) => request('DELETE', url, options),
  };
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return '(invalid url)';
  }
}