# Flowmingo for Make

A Make custom app over `https://apis.flowmingo.ai/company/integration`, in the local-project layout of Make's VS Code
extension (Make Apps Editor): `src/makecomapp.json` plus one folder per component.

**Never edit `src/` by hand.** `build.mjs` writes all of it from `../shared/contract.json` and the definitions in the
script, and `npm test` fails when `src/` differs from what the script produces.

```bash
node build.mjs   # regenerate src/
npm test         # src/ up to date + 21 structural tests (node:test, no dependencies)
```

## What is in it

**Connection.** API key, masked, sent as `x-api-key`. It is tested on `/me/v1`, and the connection is labelled with the
organisation id.

**Base.** Errors read `[status] message (error code: …)` from the API's own body. A 401 is `InvalidAccessTokenError`, so
Make deactivates the scenario and asks for a new key. A 429 keeps Make's default `RateLimitError`, so Make retries.
The key is sanitized from the logs.

| Group | Modules |
| --- | --- |
| Triggers (polling, one per event type in the contract) | Watch New Applications, Watch Stage Changes, Watch Rejected Applications, Watch Interview Status Changes, Watch AI Evaluations, Watch Completed Assessments (with an Assessment Type filter), Watch Invitations, Watch Invitation Emails, Watch Result Reviews |
| Candidates | Invite a Candidate, Search Candidates, Get a Candidate |
| Applications | Add a Candidate to a Hiring Project, Move an Application to a Stage, Reject an Application |
| Results | Get a Result, Add a Note to a Result, Rate a Result, Shortlist a Result |
| Hiring Projects | Create a Hiring Project, List Hiring Projects |
| Other | Make an API Call (universal) |

**Dropdown RPCs:** `listProjects`, `listAssessments` (only the kinds the invite route can send), `listJobPosts`, and
`listStages` (nested under the picked project).

**How the triggers poll.** Each one reads `GET /events/v1?event_type=…` newest first and follows `next_cursor`. Make
dedupes on `event_id` and `timestamp` (`trigger.type: date`, `order: desc`), and the required **Limit** caps one run.

**Behaviour to know:**
- **Invite a Candidate fails only when nothing was created.** On a partial refusal it returns the per-assessment and
  per-project messages in `*_error_messages`.
- **Create a Hiring Project always sends `assessments: []`.** Making assessments takes up to 45 s, past Make's 40 s
  module timeout.

## Deploy (owner)

1. Create a Make account.
2. In VS Code, install **Make Apps Editor** and give it a Make API key.
3. Create an app named "Flowmingo" in Make, so there is an app id to deploy to.
4. In VS Code, right-click `make/src/makecomapp.json` and choose **Deploy to Make**. The extension fills `origins` with the
   app id.

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
