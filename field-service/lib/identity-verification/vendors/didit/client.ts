// Didit HTTP client — server-side fetch wrapper with timeout and a single
// jittered retry on transient 5xx. Never logs payload bodies or the API key.

import { getDiditConfig } from './config'
import {
  isDiditDecisionResponse,
  isDiditSessionCreateResponse,
  type DiditDecisionResponse,
  type DiditSessionCreateRequest,
  type DiditSessionCreateResponse,
} from './types'

const SESSION_PATH = '/v3/session/'
const DECISION_PATH = (sessionId: string) => `/v3/session/${encodeURIComponent(sessionId)}/decision/`

const CREATE_TIMEOUT_MS = 8_000
const READ_TIMEOUT_MS = 8_000
const RETRY_JITTER_MS = 250

export class DiditApiError extends Error {
  constructor(public readonly status: number, public readonly responseBody: string) {
    super(`Didit API error ${status}: ${responseBody.slice(0, 200)}`)
    this.name = 'DiditApiError'
  }
}

export class DiditDisabledError extends Error {
  constructor(reason: string) {
    super(`Didit adapter is disabled: ${reason}`)
    this.name = 'DiditDisabledError'
  }
}

type RequestOptions = {
  method: 'GET' | 'POST'
  path: string
  body?: unknown
  timeoutMs: number
}

async function diditRequest({ method, path, body, timeoutMs }: RequestOptions): Promise<unknown> {
  const config = getDiditConfig()
  if (!config.enabled) {
    throw new DiditDisabledError(config.reason)
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Api-Key': config.apiKey,
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const url = `${config.baseUrl}${path}`
  const send = async (): Promise<Response> => {
    return fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  let resp: Response
  try {
    resp = await send()
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new DiditApiError(0, `request timeout after ${timeoutMs}ms`)
    }
    throw err
  }

  // Single retry on transient server-side errors only. POST is technically
  // non-idempotent but Didit dedupes (workflow_id, vendor_data) tuples on the
  // session-create endpoint, so the retry is safe.
  if (resp.status >= 500 && resp.status < 600) {
    await sleep(RETRY_JITTER_MS + Math.floor(Math.random() * RETRY_JITTER_MS))
    try {
      resp = await send()
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new DiditApiError(0, `request timeout after ${timeoutMs}ms (after retry)`)
      }
      throw err
    }
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new DiditApiError(resp.status, text)
  }

  // Allow empty body for some endpoints (Didit GET decision always has a
  // body in practice, but be defensive).
  const text = await resp.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new DiditApiError(resp.status, `expected JSON response; got: ${text.slice(0, 200)}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function postSession(body: DiditSessionCreateRequest): Promise<DiditSessionCreateResponse> {
  const json = await diditRequest({ method: 'POST', path: SESSION_PATH, body, timeoutMs: CREATE_TIMEOUT_MS })
  if (!isDiditSessionCreateResponse(json)) {
    throw new DiditApiError(0, `unexpected session-create response shape: ${JSON.stringify(json).slice(0, 200)}`)
  }
  return json
}

export async function getSessionDecision(sessionId: string): Promise<DiditDecisionResponse> {
  const json = await diditRequest({ method: 'GET', path: DECISION_PATH(sessionId), timeoutMs: READ_TIMEOUT_MS })
  if (!isDiditDecisionResponse(json)) {
    throw new DiditApiError(0, `unexpected decision response shape: ${JSON.stringify(json).slice(0, 200)}`)
  }
  return json
}
