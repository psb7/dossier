# Independent Dossier logins on one hostname

The upstream Dossier 1.15.1 image uses the cookie names `dossier_session` and `dossier_browser`. Browser cookies do not distinguish ports, so two installations on the same hostname overwrite each other's login cookies even with independent passwords and databases.

This small packaging layer gives the second installation a unique suffix for both cookies. It rewrites their quoted string literals in every compiled Next.js server bundle, including the proxy and server-action copies. It preserves the upstream authentication/encryption logic, password validation and all other cookies. It intentionally supports the pinned upstream 1.15.1 image; packaging fails before writing any changes if the expected cookie names are absent. Review/retest the layer before changing the base image version.

From a cloned checkout:

```bash
docker build -t dossier-personal-app:v1.15.1 --build-arg COOKIE_NAMESPACE=personal instance-image
```

In the second installation's private `.env`, set:

```dotenv
DOSSIER_IMAGE=dossier-personal-app:v1.15.1
DOSSIER_PORT=3001
DOSSIER_PUBLIC_URL=https://YOUR_HOST.ts.net:10000
```

Generate a separate `DOSSIER_PASSWORD` hash, `DOSSIER_SECRET` and `CODEX_BRIDGE_TOKEN`. Start it with its own project name:

```bash
docker compose -p dossier-personal -f compose.home.yml up -d
docker compose -p dossier-personal -f compose.home.yml run --rm codex-bridge codex login --device-auth
```

The second project has independent data and Codex-state volumes and a separate sign-in. Keep it on a separate Docker network. Never copy a populated database when the intended result is an empty installation.

Tests (Node 24+):

```bash
node --test instance-image/namespace-cookies.test.mjs
```

The tests check all nested server copies, quote styles, preservation of unrelated assets, namespace validation and failure without partial writes on an incompatible image. Deployment checks also covered the real image build, successful browser sign-in/server actions, an empty profile and real structured Codex generation. The AGPL-3.0 license and upstream source remain applicable; this repository contains the packaging layer's source.
