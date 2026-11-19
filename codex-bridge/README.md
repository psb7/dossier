# Dossier with Codex on a private home server

This optional bridge makes Dossier's existing **OpenAI-compatible** provider call the official Codex CLI. Dossier's own Generate, Score and Refine actions can use it. No database migration is needed. Source: https://github.com/psb7/dossier/tree/feat/codex-provider (AGPL-3.0; retain Dossier's LICENSE and notices).

This is a personal, single-user integration, not a hosted multi-user service. It currently supports **Codex only**. Claude Code is not implemented.

## What you need

- A Linux machine with Docker Engine and Compose v2, internet access, and approximately 3 GB free RAM for Dossier, PostgreSQL and the bridge. Codex inference runs remotely; no GPU is needed. Check RAM and CPU architecture before deployment. The bridge requires a Linux architecture supported by the pinned Codex CLI.
- Tailscale on that machine and on your laptop, with access restricted to your devices.
- A supported Codex sign-in with model access. No credentials belong in GitHub.

**Authentication is a separate prerequisite.** This bridge does not implement Sign in with ChatGPT registration, consent or token transfer. It uses the official CLI's supported authentication on the machine where it runs. Availability and usage limits depend on that sign-in. For an open-source app using ChatGPT plan access on a remote VM, follow the official [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source) and [self-hosted VM](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms) flows. Do not assume copying desktop credentials or a subscription token into Dossier's API-key field is supported. For a commercial or hosted service, use the supported product integration; legacy app-server sign-in is not a blanket authorization for hosted services.

## Install privately

Clone the fork's feature branch on the Linux machine:

```bash
git clone --branch feat/codex-provider https://github.com/psb7/dossier.git
cd dossier
umask 077
printf 'POSTGRES_PASSWORD=%s\nDOSSIER_SECRET=%s\nCODEX_BRIDGE_TOKEN=%s\nTZ=Europe/Berlin\n' \
  "$(openssl rand -hex 24)" "$(openssl rand -base64 32)" "$(openssl rand -hex 32)" > .env
docker run --rm -it ghcr.io/aientech/dossier:v1.15.1 hash-password
```

Add the printed hash to `.env` as `DOSSIER_PASSWORD=argon2id:...`. Add `DOSSIER_IMAGE=ghcr.io/aientech/dossier:v1.15.1` to pin Dossier. Keep the secrets and existing volumes when upgrading. Choose a model available to your account by adding `CODEX_BRIDGE_MODEL=<model-id>`; `codex-default` omits the CLI model argument and uses Codex's built-in default (user config is deliberately ignored).

Build the bridge, then check the CLI's supported login methods:

```bash
docker compose -f compose.production.yml -f compose.codex.yml build codex-bridge
docker compose -f compose.production.yml -f compose.codex.yml run --rm codex-bridge codex login --help
```

Complete the appropriate official sign-in for your account and deployment before starting generation. The `codex-state` named volume retains the CLI's state. The bridge token is only a private password between Dossier and the bridge; **it is not an OpenAI API key**. If using API-key authentication instead, usage is billed as API usage, not subscription usage. Never paste secrets into issue reports or application prompts.

```bash
docker compose -f compose.production.yml -f compose.codex.yml up -d
```

Open Dossier over an SSH tunnel through Tailscale:

```bash
ssh -L 3000:127.0.0.1:3000 YOUR_USER@YOUR_TAILSCALE_HOST
```

Visit `http://localhost:3000` on the laptop. No router port-forwarding is needed. For a persistent browser address, configure Tailscale Serve separately and follow its HTTPS setup. The Compose files bind Dossier to loopback and never publish the bridge or database ports.

In a fresh Dossier the Compose environment selects the bridge. **Previously saved AI settings override environment defaults.** If you've saved settings before, choose Settings → AI provider → OpenAI-compatible, set URL `http://codex-bridge:8787/v1`, model `codex-default` (or your configured model), API key to the `CODEX_BRIDGE_TOKEN` value, and timeout 360 seconds. Press Test connection, then test one real posting and inspect the resulting PDFs.

## Behaviour and limits

- `/v1/models` lists only operator-configured models; it is not an entitlement check. A successful generation verifies actual access.
- `/v1/chat/completions` supports text and JSON-schema requests, one generation at a time. Dossier retains its own schema validation and factual checks. The CLI receives the whole supplied conversation on every request, in a fresh ephemeral run.
- The runner uses stdin and an argument array (no shell), a temporary working directory, read-only Codex sandboxing, no user config/rules, and disabled shell, patch and web-search features. The container mounts no host workspace or Docker socket. These reduce agent capabilities; this is still an agent process, not a pure inference API.
- Request size is limited to 2 MiB; streaming and tool calls are rejected. Cancellation and the five-minute timeout stop the CLI. Supported reasoning efforts are low, medium and high. Temperature and max-token fields are not enforced by this CLI adapter; Dossier's output validation still detects invalid results. Token usage is recorded when the CLI reports it.
- Profile and posting content goes to the model service used by Codex. Temporary files are removed after each request. The CLI credential volume is sensitive; keep it private. Dossier's application data and backups remain in its existing volumes.
- Back up Dossier using Settings → Data and backups → Export. Do not use `docker compose down -v` unless you intend to erase volumes. Stopping the stack preserves data.

## Verification

No application dependency installation is needed for the bridge tests (Node 24+):

```bash
node --test codex-bridge/bridge.test.mjs
```

These test authentication, request validation, schema forwarding, OpenAI response/usage conversion, cancellation, concurrency, error redaction, CLI arguments and temporary-file cleanup with a fake CLI process. They do not prove model entitlement, PDF quality or successful Docker deployment. Those require a real signed-in runtime and a running Dossier instance. Docker builds and a complete application/PDF run must be checked on the target machine before relying on the integration.
