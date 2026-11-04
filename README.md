# Flowmingo connectors

Flowmingo on no-code automation platforms (Zapier, Make, n8n). Each connector is a thin wrapper around the Flowmingo public
API; none of them adds server behaviour.

| Folder | What |
| --- | --- |
| `shared/contract.json` | The endpoints, event types and sample payloads every connector is built on |
| `zapier/` | Zapier Platform CLI app |
| `make/` | Make custom app (generated into `make/src` by `make/build.mjs`) |
| `n8n/` | n8n community node, published to npm as [`n8n-nodes-flowmingo`](https://www.npmjs.com/package/n8n-nodes-flowmingo) |

**Source of truth for the API:** https://flowmingo.ai/integration/api-integration and https://flowmingo.ai/integration/webhook.
When the API changes, update `shared/contract.json` first, run `node scripts/sync-shared.mjs`, then each connector's tests.

**No secrets in this repository.** Each platform keeps the customer's API key in its own credential store.

**Telemetry.** Each connector names itself in the `User-Agent` header: Zapier sends `flowmingo-zapier/<version>`, Make
`flowmingo-make/<version>` and n8n `n8n-nodes-flowmingo/<version>`. Recording it on the server is a planned small change.

## Run the checks

Each connector has its own tests:

```bash
cd zapier && npm install && npm test
```

```bash
cd n8n && npm install && npm test && npm run lint
```

```bash
cd make && npm test
```

## Publishing notes

- **n8n** is published to npm only from GitHub Actions, with provenance (`.github/workflows/publish.yml`, on a version tag
  such as `0.1.0`). The workflow runs in `n8n/`; n8n's linter checks the `repository` URL in `n8n/package.json`.
- **Zapier** pushes from `zapier/` with the Zapier CLI (`npx zapier-platform-cli@19.2.1 push`; the binary is
  `zapier-platform` since v19).
- **Make** deploys `make/src` with Make's VS Code extension (Make Apps Editor); see `make/README.md`.

To get a Flowmingo API key, an Owner or Admin opens Settings > API keys in Flowmingo.
