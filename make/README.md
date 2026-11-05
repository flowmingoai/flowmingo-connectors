# Flowmingo for Make

A Make custom app over `https://apis.flowmingo.ai/company/integration`, in the local-project layout of Make's VS Code
extension (Make Apps Editor): `src/makecomapp.json` plus one folder per component.

**Never edit `src/` by hand.** `build.mjs` writes all of it from `../shared/contract.json` and the definitions in the
script, and `npm test` fails when `src/` differs from what the script produces.

```bash
node build.mjs   # regenerate src/
npm test         # src/ up to date + 30 structural tests (node:test, no dependencies), Make review rules included
```

## What is in it

**Connection.** API key, masked, sent as `x-api-key`. It is tested on `/me/v1`, and the connection is labelled with the
organisation id.

**Base.** Errors read `[status] message (error code: …)` from the API's own body. A 401 is `InvalidAccessTokenError`, so
Make deactivates the scenario and asks for a new key. A 429 keeps Make's default `RateLimitError`, so Make retries.
The key is sanitized from the logs.

| Group | Modules |
| --- | --- |
| Triggers (polling, one per event type in the contract) | Watch new applications, Watch stage changes, Watch rejected applications, Watch interview status changes, Watch AI evaluations, Watch completed assessments, Watch invitations, Watch invitation emails, Watch result reviews (each with a filter named after its sub-event field when it has one) |
| Candidates | Search candidates, Get a candidate, Invite a candidate |
| Applications | Add a candidate to a hiring project, Move an application to a stage, Reject an application |
| Results | Get a result, Add a note to a result, Rate a result, Shortlist a result |
| Hiring projects | List hiring projects, Create a hiring project |
| Other | Make an API call (universal, pinned to the API address) |

**Dropdown RPCs:** `listProjects`, `listAssessments` (only the kinds the invite route can send), `listJobPosts` (by the
module's project when it has one, labelled with the post's creation date), and `listStages` (the route returns every stage
of a project at once).

**Parameters are named after the API fields they fill** (`tal_candidate_id`, `com_project_id`, `idempotency_key`…), so each
request body is `{{parameters}}`, or a spread of it with `omit()` for what goes in the path or only fills a dropdown. A field
the API adds later needs only a new parameter. **Outputs return the whole response**, with every date parsed by `parseDate`
after it (the interface type alone leaves dates as text). Lists read 100 per page, the events feed 200 (the largest each
route serves), and the user's **Limit** stops a run: optional on the searches (empty returns everything), required on the
triggers.

**How the triggers poll.** Each one reads `GET /events/v1?event_type=…` newest first and follows `next_cursor`. Make
dedupes on `event_id` and the parsed `timestamp` (`trigger.type: date`, `order: desc`). The output is the event's data at the
top level, then `event_id`, `event_type`, `sub_event` and `timestamp`.

**Behaviour to know:**
- **Invite a candidate fails only when nothing was created.** On a partial refusal it returns the per-assessment and
  per-project messages in `*_error_messages`.
- **Create a hiring project always sends `assessments: []`.** Making assessments takes up to 45 s, past Make's 40 s
  module timeout.

## Deploy

`deploy.mjs` pushes `src/` to an existing Make app through Make's SDK API (the calls Make's VS Code extension makes). It
updates every component in place, creates missing ones, never deletes, and sets each action module's **Module action**
(`crud`), which the VS Code layout keeps as `actionCrud`.

```bash
npm test
node deploy.mjs flowmingo-41rlf7 1 --dry-run   # prints the writes it would make
node deploy.mjs flowmingo-41rlf7 1             # the production app (eu1)
```

The token comes from `MAKE_TOKEN` or `~/.config/flowmingo-connectors/make-token` (Make scopes `apps:read`, `apps:write`).

## Before requesting Make's review (their prerequisites)

- [ ] Every module in at least one test scenario that runs without errors, modules chained by object
- [ ] Searches at the end of their own routes, run so the logs show pagination
- [ ] One scenario that produces an error on purpose
- [ ] No personal data in scenarios or logs: use a test organisation with fake candidates
- [ ] Run every scenario right before requesting review, because Make keeps logs only for a short time
- [ ] **Publish** (cannot be undone), then **Request review** with the API docs link
  (https://flowmingo.ai/integration/api-integration), scenario links, categories (HR / Recruiting) and the logo

**To confirm on the first live run:**
- Make sends the literal `assessments: []` of Create a Hiring Project.
- Make drops the empty optional fields of Invite a Candidate, as its docs say. If it doesn't, the API answers 400 on a
  blank `cv_link` or `firstname`.
