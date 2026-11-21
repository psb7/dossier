import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Cookies are scoped by hostname and path, not port. The pinned upstream
// runtime hard-codes these two names in its compiled authentication modules.
// Rewrite every server-side copy, including proxy and server-action bundles,
// when packaging another private instance on the same hostname.
export async function namespaceCookies(root, namespace) {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(namespace ?? '')) throw new Error('Invalid cookie namespace');
  const totals = { dossier_session: 0, dossier_browser: 0 };
  const changes = [];
  async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (entry.isFile() && /\.(?:c|m)?js$/.test(entry.name)) {
        const old = await readFile(file, 'utf8');
        const updated = old.replace(/(["'`])(dossier_session|dossier_browser)\1/g, (_match, quote, name) => {
          totals[name]++;
          return `${quote}${name}_${namespace}${quote}`;
        });
        if (updated !== old) changes.push([file, updated]);
      }
    }
  }
  await scan(root);
  // Fail closed on an incompatible/upgraded image before changing any file.
  if (!totals.dossier_session || !totals.dossier_browser) throw new Error('Expected upstream authentication cookies not found');
  for (const [file, updated] of changes) await writeFile(file, updated);
  return { namespace, files: changes.length, replacements: totals };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await namespaceCookies(process.argv[2], process.argv[3])));
}
