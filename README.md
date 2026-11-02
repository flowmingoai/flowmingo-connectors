# Flowmingo connectors

Flowmingo on no-code automation platforms (Zapier, Make, n8n). Each connector is a thin wrapper around the Flowmingo public
API; none of them adds server behaviour.

| Folder | What | Status |
| --- | --- | --- |
| `shared/contract.json` | The endpoints, event types and sample payloads every connector is built on | v2026-11-02 |
| `zapier/` | Zapier Platform CLI app | Built, unit-tested, validated; not yet pushed |
| `make/` | Make custom app (generated into `make/src` by `make/build.mjs`) | Built, 21 structural tests pass; not deployed |
| `n8n/` | n8n community node (`n8n-nodes-flowmingo`) | Built, unit-tested, lint clean except the repository URL; not published |

**Source of truth for the API:** https://flowmingo.ai/integration/api-integration and https://flowmingo.ai/integration/webhook.
When the API changes, update `shared/contract.json` first, run `node scripts/sync-shared.mjs`, then each connector's tests.

**No secrets in this repository.** Each platform keeps the customer's API key in its own credential store.

**Telemetry.** Each connector names itself in the `User-Agent` header: Zapier sends `flowmingo-zapier/<version>`, Make
`flowmingo-make/<version>` and n8n `n8n-nodes-flowmingo/<version>`. Recording it on the server is a planned small change.

Task: Rec0CDDJB01T5. Plan: `app/drafts/2026-11-02-Rec0CDDJB01T5-zapier-make-n8n-plan.md`.

## Run the checks

One at a time (this machine cannot take parallel test runs):

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

- **n8n** must be published to npm from GitHub Actions with provenance, and its `repository` URL must match a public GitHub
  repository. The scaffold's workflows are in `n8n/.github/workflows/` and only run from a repository root. Before the first
  release, either give the n8n package its own public repository or move them to the root with
  `working-directory: n8n`. Then replace the placeholder `repository.url` in `n8n/package.json`, which the linter flags.
- **Zapier** pushes from `zapier/` with the Zapier CLI once the owner has run `npx zapier-platform-cli@19.2.1 login` (the CLI command is `zapier-platform` since v19; plain `zapier` no longer exists).
- **Make** deploys `make/src` with Make's VS Code extension (Make Apps Editor) once the owner has a Make account and has
  created the app; see `make/README.md`.
