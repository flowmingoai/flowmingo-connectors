# Flowmingo for Zapier

Zapier Platform CLI app (`zapier-platform-core` 19.2.1) over `https://apis.flowmingo.ai/company/integration`.

## What it does

**Authentication:** API key (`x-api-key`), tested on `GET /me/v1`. A 401 marks the connection expired. A 429 or a coded 503
asks Zapier to retry after `Retry-After`. Every other error shows the API's own `message`.

**Triggers.** Each one polls `GET /events/v1?event_type=…&limit=100` and is deduped on `event_id`. The `candidate` and
`result` fields are hydrated lazily, only when a later step uses them.

| Key | Event | Filter |
| --- | --- | --- |
| `application_created` | `application.created` | |
| `candidate_stage_changed` | `candidate.stage_changed` | |
| `application_rejected` | `application.rejected` | |
| `interview_status_updated` | `interview.status.update` | status |
| `interview_evaluated` | `interview.evaluation.update` | evaluation type |
| `assessment_completed` | `assessment.completed` | assessment type |
| `invitation_lifecycle_updated` | `invitation.lifecycle.update` | status |
| `invitation_email_status` | `invitation.status.update` | status (delivered, opened, clicked, failed, spam) |
| `submission_reviewed` | `submission.review.update` | action |

**Hidden dropdown triggers:** `project_list`, `assessment_list` (only kinds the invite route can send), `job_post_list`,
`stage_list` (depends on the picked project).

**Actions:**
- `invite_candidate`: emails the candidate unless Send Invitation is off. It fails the step only when nothing was created;
  partial refusals go to `warnings`.
- `add_application`
- `move_application_stage`
- `reject_application`
- `add_note`
- `rate_result`
- `shortlist_result`
- `create_project`: always sends `assessments: []`. Making assessments takes up to 45 s, past Zapier's step timeout.

**Searches:**
- `find_candidate`: exact email; rows re-checked for an exact match.
- `find_result`: result with its AI evaluation; 404 = not found.

## Run it

```bash
npm install
npm test                                     # Jest, run in band (one worker)
npx zapier-platform-cli@19.2.1 validate --without-style
```

`FLOWMINGO_BASE_URL` overrides the API base for a local stack. Never set it on a published version.

## Before submitting to Zapier (their publishing requirements)

- [ ] `npx zapier-platform-cli@19.2.1 login` by the owner, then `… register "Flowmingo"` and `… push` (the binary is `zapier-platform`)
- [ ] A Zapier team admin with a flowmingo.ai address
- [ ] Every trigger, action and search in a live test Zap that is turned on and has at least one successful run (keep them)
- [ ] No unhandled errors on the Monitoring page
- [ ] A non-expiring Flowmingo account for `integration-testing@zapier.com` with every paid feature on
- [ ] Listing: name "Flowmingo", description "Flowmingo is a…", homepage https://flowmingo.ai, logo, API docs link
