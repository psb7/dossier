import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { namespaceCookies } from './namespace-cookies.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dossier-cookie-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'chunks'));
  return root;
}

test('namespaces all compiled auth copies and preserves unrelated cookies and assets', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'proxy.js'), 'read("dossier_session"); read("other_cookie");');
  await writeFile(join(root, 'chunks', 'actions.js'), "set('dossier_session'); set(`dossier_browser`);");
  await writeFile(join(root, 'chunks', 'assets.json'), '"dossier_session"');
  const result = await namespaceCookies(root, 'personal');
  assert.equal(result.files, 2);
  assert.deepEqual(result.replacements, { dossier_session: 2, dossier_browser: 1 });
  assert.equal(await readFile(join(root, 'proxy.js'), 'utf8'), 'read("dossier_session_personal"); read("other_cookie");');
  assert.equal(await readFile(join(root, 'chunks', 'actions.js'), 'utf8'), "set('dossier_session_personal'); set(`dossier_browser_personal`);");
  assert.equal(await readFile(join(root, 'chunks', 'assets.json'), 'utf8'), '"dossier_session"');
});

test('rejects invalid namespaces and unexpected upstream bundles without partial writes', async t => {
  const root = await fixture(t);
  const file = join(root, 'proxy.js');
  await writeFile(file, 'read("dossier_session");');
  for (const name of ['', 'x; Domain=example.com', '../escape', 'a'.repeat(33)]) {
    await assert.rejects(namespaceCookies(root, name), /Invalid/);
  }
  await assert.rejects(namespaceCookies(root, 'personal'), /not found/);
  assert.equal(await readFile(file, 'utf8'), 'read("dossier_session");');
});
