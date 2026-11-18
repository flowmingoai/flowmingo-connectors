# Testing the connectors

There are three levels, cheapest first. Each catches something the one before cannot. On a small laptop, run the
suites **one at a time**.

| Level | Where it runs | Needs | What only it catches |
| --- | --- | --- | --- |
| 1. Offline | your laptop | nothing | broken code, a contract copy that drifted, a Make module referring to a missing field |
| 2. Real runtime, pre | Zapier's runtime locally; real n8n in Docker | a test API key on pre | what the platform does to inputs, real API answers, the second run, failure paths |
| 3. In the platform | zapier.com, make.com, an n8n with the published package | accounts; a pushed / deployed / published app | the editor (dropdowns, mapping), scheduling, the marketplace review |

The end-to-end run of 2 Nov 2026 covered level 2 for Zapier and n8n. Make has no level 2: Make cannot run outside
make.com.

## Level 1: offline (about a minute)

```bash
cd zapier && npm test                  # 31 tests
cd n8n && npm test && npm run lint     # 25 tests, then n8n's own lint (also run by the n8n CI)
cd make && npm test                    # src/ up to date + 21 structural tests
```

`/integration-check` adds the cross-checks against the server code and the public docs (`check.mjs contract`).

## Level 2: each platform's real runtime, against pre

**Key.** Use a key on a test organisation on pre: sign in to pre as the QA recruiter, open Settings > API keys, and give
the key `read_hiring`, `read_candidates`, `invite_candidates`, `write_pipeline` and `create_project`. `zapier/.env` (gitignored)
already holds the 2 Nov one, for org 975.

### Zapier: `zapier-platform invoke`

`zapier/.env` holds `authData_api_key=<key>` and `FLOWMINGO_BASE_URL=https://pre-apis.flowmingo.ai/company/integration`.

```bash
cd zapier
export FLOWMINGO_BASE_URL=https://pre-apis.flowmingo.ai/company/integration
npx zapier-platform-cli@19.2.1 invoke auth test --non-interactive                            # organisation id + scopes
npx zapier-platform-cli@19.2.1 invoke trigger project_list --isFillingDynamicDropdown --non-interactive
npx zapier-platform-cli@19.2.1 invoke trigger application_created --non-interactive         # newest 100 events
npx zapier-platform-cli@19.2.1 invoke create invite_candidate --non-interactive -i @invite.json
npx zapier-platform-cli@19.2.1 invoke search find_candidate --non-interactive -i '{"email":"you+test@flowmingo.ai"}'
```

Unlike the unit tests, `invoke` converts inputs the way Zapier does. That is how the 2 Nov run found a text rating
saved as 0.

### n8n: the real editor in Docker

```bash
scripts/n8n-try.sh          # http://localhost:5678, the nodes call pre ("prod" to call production, "stop" to stop)
```

1. Create the local owner account, then a **Flowmingo API** credential with the pre key. "Test" on the credential calls
   `/me/v1`.
2. Build a workflow from the node panel ("Flowmingo"), use the dropdowns, and press **Execute step** on each node.
3. On the **Flowmingo Trigger**, "Test step" shows the newest matching event. Then activate the workflow and wait a
   minute:
   - the first poll only notes where the feed stands;
   - each poll after it runs once per batch of new events, oldest first.

### Make

There is no local runtime. Deploy to make.com (level 3) and test there.

## Level 3: inside each platform

- **Zapier:** `npx zapier-platform-cli@19.2.1 login`, then `register "Flowmingo"` and `push`.
  - To aim a private test version at pre:
    `npx zapier-platform-cli@19.2.1 env:set 1.0.0 FLOWMINGO_BASE_URL=https://pre-apis.flowmingo.ai/company/integration`.
  - Push a fresh version without that variable before you promote.
  - Zapier's review needs every trigger, action and search in a live Zap that is turned on, with at least one
    successful run.
- **Make:** deploy `make/src` with `node deploy.mjs flowmingo 1`, after a `--dry-run` (`make/README.md`, "Deploy").
  - The app calls production, so test with a production key on a test organisation.
  - Make's review needs a scenario per module, one that fails on purpose, and searches run so the logs show
    pagination.
- **n8n:** after `npm publish`, install it in a real n8n under Settings > Community nodes > `n8n-nodes-flowmingo`. That
  is the only test of the installed package name; `n8n-try.sh` loads the nodes as `CUSTOM.*`.

## The flows to run, the same on every platform

Run them in this order; each leaves the data the next one needs. "Test trigger" / "Test step" fetches at once.
Otherwise a trigger waits for its schedule: n8n every minute, Make your schedule, Zapier 1 to 15 minutes by plan.

| # | Flow | Pass when |
| --- | --- | --- |
| 1 | **Form → Invite Candidate**, to your own plus address, with an AI Interview, a project and Send Invitation on | the person is in the project in Flowmingo, the invitation email arrives, and Invitation Created/Sent and Invitation Email Status (delivered) fire once each |
| 2 | **New Application → Move Application to Stage** (stage picked from the project's dropdown) | the card moves in Flowmingo, and Candidate Moved to a Stage fires once |
| 3 | **Invite with a CV link to a CV Evaluation → AI Evaluation Ready → Get Result → a message with the score** | the score and summary in the message match the result page in Flowmingo; the fastest way to make an evaluation event without doing an interview |
| 4 | **Result Reviewed, filtered to "Rated"** then rate and shortlist the result | only the rating fires, and it fires once |
| 5 | **Create Hiring Project** twice with the same Unique Key | the second run returns the same project (`idempotent_replay`) |

Each time, also check that:
- the next poll does **not** fire the same event again;
- candidate names and emails come through (Get Candidate, or Zapier's lazy `candidate` field);
- Flowmingo's own screen shows the change.

**Failure paths**, each must show a readable message, not a crash:

| Do this | Expect |
| --- | --- |
| a revoked or wrong key | "did not accept the API key … reconnect / update the credential" |
| invite the same person twice | success with `warnings` ("Email already invited") |
| invite to a draft assessment (labelled "Draft" in the dropdown) | success with `warnings` ("… is a draft, so this invitation is not emailed …"), and no email |
| reject twice | the same answer, nothing changes |
| rating "great" or 11 | refused, with the rule |
| a stage of another project | "com_stage_id is not a valid stage of the target project" |

## Known on 2 Nov 2026 (not connector bugs)

- **Find Candidate on pre** finds only people among the newest 10: pre does not have the server's `email` filter yet
  (on `main` since 2 Nov). The connectors' own exact-email check keeps them from returning the wrong person.
- **Invitation Email Status events** carry no `candidate_id` when delivered, and the **invitation** id in `candidate_id`
  when failed (a server bug, handed off). Get Candidate on a failed one answers "no details".
- **A repeat invite's warning** reads `errors.Candidate was already in this project` (an untranslated server message).
- **Applications created by an invite carry no stage** (`com_stage_id` empty on New Application; Add Candidate to Hiring
  Project sets one).

## Found in the Zapier and Make editors, 3 Nov 2026

- **A draft assessment could be invited and was never emailed** (status 2 in the assessments list; the sender mails only
  an active assessment). Fixed: the three dropdowns label drafts, inactive and archived assessments, and the server's
  invite answer carries `warnings` (code `assessment_not_active`), which every connector passes on in its `warnings`
  output. On pre and production since 3 Nov 2026 (checked on pre with Zapier's `invoke create invite_candidate` to a
  draft).
- **Make's dropdowns showed only the title**, so two assessments of the same name looked the same. The assessment list now
  names the kind too ("Sales (AI Interview)"); same-named projects still look alike there.

After any run, `/integration-check` reads the same signals across every integration, and `/integration-improve` fixes
what it finds.
