import type {
  AdrResponse,
  AdrsResponse,
  ApiError,
  CheckResponse,
  ForResponse,
  GraphResponse,
  MetaResponse,
} from '@adrien/api/contract';
import { type DecisionFilters, toApiQuery } from './filters.ts';

/** A failed API call, carrying the server's own `error.message` when it sent one. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

/** 4xx: asking again will not help, so queries do not retry these. */
export function isClientError(err: unknown): boolean {
  return err instanceof ApiRequestError && err.status >= 400 && err.status < 500;
}

const isApiError = (body: unknown): body is ApiError =>
  typeof body === 'object' &&
  body !== null &&
  typeof (body as ApiError).error === 'object' &&
  typeof (body as ApiError).error?.message === 'string';

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/** GET a path under `/api` on the same origin. */
export async function apiGet<T>(path: string, params?: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const query = params?.toString();
  const url = query ? `${path}?${query}` : path;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiRequestError(
      'Could not reach the Adrien server. Check that `adrien serve` is still running, then reload.',
      0,
      'NETWORK',
    );
  }

  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  if (!res.ok) {
    const body = isJson ? await readJson(res) : undefined;
    if (isApiError(body)) throw new ApiRequestError(body.error.message, res.status, body.error.code);
    throw new ApiRequestError(
      `The server answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''} for ${path}.`,
      res.status,
      'HTTP_ERROR',
    );
  }
  if (!isJson) {
    throw new ApiRequestError(
      `Expected JSON from ${path} but got ${res.headers.get('content-type') || 'no content type'}. Is this page served by \`adrien serve\`?`,
      res.status,
      'BAD_RESPONSE',
    );
  }
  return (await res.json()) as T;
}

export const api = {
  meta: (signal?: AbortSignal) => apiGet<MetaResponse>('/api/meta', undefined, signal),
  adrs: (filters: DecisionFilters, signal?: AbortSignal) =>
    apiGet<AdrsResponse>('/api/adrs', toApiQuery(filters), signal),
  adr: (id: string, signal?: AbortSignal) =>
    apiGet<AdrResponse>(`/api/adrs/${encodeURIComponent(id)}`, undefined, signal),
  graph: (signal?: AbortSignal) => apiGet<GraphResponse>('/api/graph', undefined, signal),
  forFiles: (paths: string[], signal?: AbortSignal) =>
    apiGet<ForResponse>('/api/for', new URLSearchParams(paths.map((p) => ['path', p])), signal),
  check: (lint: boolean, signal?: AbortSignal) =>
    apiGet<CheckResponse>('/api/check', lint ? new URLSearchParams({ lint: '1' }) : undefined, signal),
};
