import { createServer } from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { runCodex } from './runner.mjs';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function authorised(header, token) {
  const a = Buffer.from(header ?? '');
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function bodyOf(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) throw new HttpError(413, 'Request too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new HttpError(400, 'Invalid JSON.'); }
}

export function validateRequest(body, models) {
  if (!body || !models.includes(body.model)) throw new HttpError(400, 'Choose a model listed by /v1/models.');
  if (body.stream) throw new HttpError(400, 'Streaming is not supported.');
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 200 ||
      body.messages.some(m => !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) {
    throw new HttpError(400, 'messages must contain system, user or assistant text messages.');
  }
  if (body.tools || body.tool_choice) throw new HttpError(400, 'Tools are not supported.');
  const format = body.response_format;
  let schema;
  if (format) {
    if (format.type === 'json_schema') {
      schema = format.json_schema?.schema;
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new HttpError(400, 'Invalid JSON schema.');
    } else if (format.type === 'json_object') {
      throw new HttpError(400, 'response_format json_object is unsupported; use json_schema or a JSON prompt.');
    } else if (format.type !== 'text') throw new HttpError(400, 'Unsupported response_format.');
  }
  const effort = body.reasoning_effort;
  if (effort !== undefined && !['low', 'medium', 'high'].includes(effort)) throw new HttpError(400, 'Unsupported reasoning_effort.');
  return { model: body.model, messages: body.messages, schema, effort };
}

export function createBridge({ token, models = ['codex-default'], timeoutMs = 300_000, runner = runCodex }) {
  if (!token || token.length < 32) throw new Error('Set CODEX_BRIDGE_TOKEN to at least 32 random characters.');
  if (!models.length || models.some(m => !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,150}$/.test(m))) throw new Error('Invalid CODEX_BRIDGE_MODELS.');
  let active = false;
  const send = (res, status, value) => {
    if (res.destroyed) return;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const server = createServer(async (req, res) => {
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      if (!authorised(req.headers.authorization, token)) throw new HttpError(401, 'Invalid bridge token.');
      if (req.method === 'GET' && req.url === '/v1/models') {
        send(res, 200, { object: 'list', data: models.map(id => ({ id, object: 'model', owned_by: 'codex-bridge' })) }); return;
      }
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') throw new HttpError(404, 'Not found.');
      const request = validateRequest(await bodyOf(req), models);
      if (active) throw new HttpError(429, 'Codex is busy. Try again after the current task.');
      active = true;
      try {
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]);
        const result = await runner(request, { signal });
        if (signal.aborted) throw new Error('cancelled');
        const usage = result.usage;
        send(res, 200, { id: `chatcmpl-${randomUUID()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000),
          model: request.model, choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: 'stop' }],
          ...(usage ? { usage: { prompt_tokens: usage.input_tokens ?? 0, completion_tokens: usage.output_tokens ?? 0,
            total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) } } : {}) });
      } finally { active = false; }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error.message === 'cancelled' ? 504 : 502;
      const message = error instanceof HttpError ? error.message : 'Codex could not complete the request. Check its installation, sign-in, model access and usage limits.';
      send(res, status, { error: { message, type: 'bridge_error', code: status } });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const models = (process.env.CODEX_BRIDGE_MODELS || 'codex-default').split(',').map(s => s.trim());
  const timeoutMs = Number(process.env.CODEX_BRIDGE_TIMEOUT_SECONDS || 300) * 1000;
  const port = Number(process.env.CODEX_BRIDGE_PORT || 8787);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3_600_000) throw new Error('Invalid bridge timeout.');
  const server = createBridge({ token: process.env.CODEX_BRIDGE_TOKEN, models, timeoutMs });
  server.listen(port, process.env.CODEX_BRIDGE_HOST || '127.0.0.1', () => console.log(`Dossier Codex bridge listening on port ${port}`));
  const stop = () => { server.close(); server.closeAllConnections(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
