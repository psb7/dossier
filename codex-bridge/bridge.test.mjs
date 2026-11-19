import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { writeFile, access } from 'node:fs/promises';
import { createBridge } from './server.mjs';
import { runCodex } from './runner.mjs';

const token = 'test-only-bridge-token-with-at-least-32-characters';
const request = { model: 'codex-default', messages: [{ role: 'system', content: 'Be factual.' }, { role: 'user', content: 'Write a CV.' }] };
async function withServer(t, runner, timeoutMs) {
  const server = createBridge({ token, runner, timeoutMs });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return (body, path = '/v1/chat/completions', auth = token) => fetch(url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

test('requires a strong token at startup and authentication on every route', async t => {
  assert.throws(() => createBridge({ token: 'short' }));
  const send = await withServer(t, () => { throw Error('must not call'); });
  assert.equal((await send(undefined, '/v1/models', 'wrong')).status, 401);
  assert.equal((await send(request, undefined, '')).status, 401);
  const models = await (await send(undefined, '/v1/models')).json();
  assert.equal(models.data[0].id, 'codex-default');
});

test('translates Dossier structured-output requests and token usage', async t => {
  const schema = { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false };
  let received;
  const send = await withServer(t, async r => { received = r; return { text: '{"summary":"Hello"}', usage: { input_tokens: 11, output_tokens: 3 } }; });
  const res = await send({ ...request, response_format: { type: 'json_schema', json_schema: { name: 'cv', schema } } });
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.deepEqual(received.schema, schema);
  assert.deepEqual(received.messages, request.messages);
  assert.equal(JSON.parse(result.choices[0].message.content).summary, 'Hello');
  assert.equal(result.usage.total_tokens, 14);
});

test('rejects malformed, oversized and unsupported requests before invoking Codex', async t => {
  const send = await withServer(t, () => { throw Error('must not call'); });
  for (const body of ['{broken', { ...request, model: '--injected' }, { ...request, stream: true }, { ...request, tools: [] },
    { ...request, messages: [{ role: 'user', content: {} }] },
    { ...request, response_format: { type: 'json_schema' } }]) assert.equal((await send(body)).status, 400);
  assert.equal((await send({ ...request, messages: [{ role: 'user', content: 'x'.repeat(2 * 1024 * 1024) }] })).status, 413);
  assert.equal((await send(undefined, '/unknown')).status, 404);
});

test('handles one generation at a time and releases the slot', async t => {
  let finish;
  let started;
  const ready = new Promise(r => { started = r; });
  const send = await withServer(t, () => { started(); return new Promise(r => { finish = r; }); });
  const first = send(request);
  await ready;
  assert.equal((await send(request)).status, 429);
  finish({ text: 'Done' });
  assert.equal((await first).status, 200);
});

test('redacts backend errors and forwards timeout cancellation', async t => {
  const send = await withServer(t, async (_r, { signal }) => {
    await once(signal, 'abort');
    throw Error('cancelled');
  }, 10);
  assert.equal((await send(request)).status, 504);
  const broken = await withServer(t, async () => { throw Error('PRIVATE PROFILE AND TOKEN'); });
  const response = await broken(request);
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('PRIVATE'));
});

function fakeProcess(onInput, exit = 0) {
  return (command, args, options) => {
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.kill = () => proc.emit('close', 1);
    let input = '';
    proc.stdin = new Writable({ write(chunk, _enc, done) { input += chunk; done(); }, final(done) {
      Promise.resolve(onInput({ command, args, options, input })).then(() => {
        proc.stdout.end('{"type":"turn.completed","usage":{"input_tokens":2,"output_tokens":1}}\n');
        done(); proc.emit('close', exit);
      });
    } });
    return proc;
  };
}

test('runner uses stdin, no shell, an isolated directory, schema and cleanup', async () => {
  let directory;
  const injection = '$(touch private) `whoami`';
  const result = await runCodex({ ...request, messages: [{ role: 'user', content: injection }], schema: { type: 'object' } }, {
    spawnProcess: fakeProcess(async ({ args, options, input }) => {
      directory = options.cwd;
      assert.equal(options.shell, false);
      assert.ok(input.includes(injection));
      assert.ok(!args.join(' ').includes(injection));
      assert.ok(args.includes('--ephemeral'));
      assert.ok(args.includes('--ignore-user-config'));
      assert.ok(args.includes('--output-schema'));
      assert.ok(args.includes('read-only'));
      await writeFile(args[args.indexOf('--output-last-message') + 1], '{"summary":"OK"}');
    }),
  });
  assert.equal(result.text, '{"summary":"OK"}');
  assert.equal(result.usage.input_tokens, 2);
  await assert.rejects(access(directory));
});

test('runner rejects nonzero exit and malformed structured output', async () => {
  await assert.rejects(runCodex(request, { spawnProcess: fakeProcess(async () => {}, 1) }), /codex-failed/);
  await assert.rejects(runCodex({ ...request, schema: { type: 'object' } }, {
    spawnProcess: fakeProcess(async ({ args }) => { await writeFile(args[args.indexOf('--output-last-message') + 1], 'not JSON'); }),
  }), /codex-invalid-output/);
});
