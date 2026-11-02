# n8n-nodes-flowmingo

This is an n8n community node. It lets you use [Flowmingo](https://flowmingo.ai) in your n8n workflows.

Flowmingo is an AI interview and hiring platform. Recruiters invite candidates to AI interviews, role-plays, CV evaluations,
skill tests and technical tests. Flowmingo scores each result, and recruiters review candidates through a hiring pipeline.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation) ·
[Operations](#operations) ·
[Trigger](#trigger) ·
[Credentials](#credentials) ·
[Compatibility](#compatibility) ·
[Usage](#usage) ·
[Resources](#resources) ·
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes
documentation. The package name is `n8n-nodes-flowmingo`.

## Operations

The **Flowmingo** node:

| Resource | Operation | What it does |
| --- | --- | --- |
| Candidate | Invite | Adds a candidate and invites them to an assessment, a hiring project, or both. **Emails the invitation** unless Send Invitation is off. |
| Candidate | Find by Email | Finds a candidate in your pipelines by exact email address. |
| Candidate | Get | Gets one candidate. |
| Application | Add to Project | Puts a candidate already in your account into a hiring project. |
| Application | Move to Stage | Moves an application to another stage. Emails the candidate if your team switched that on for the stage. |
| Application | Reject | Moves an application into its project's Rejected stage. Nothing is deleted. |
| Result | Get | Gets one result with its AI evaluation: score, summary, strengths and gaps. |
| Result | Add Note | Adds a note, and optionally a rating. |
| Result | Rate | Rates a result from 0 to 10. |
| Result | Shortlist | Shortlists a result, or removes the mark. |
| Project | Create | Creates a hiring project with its default stages and an AI-drafted job post. |
| Project | Get Many | Lists your hiring projects. |

The node can also be used as a tool by an n8n AI Agent.

## Trigger

The **Flowmingo Trigger** node polls Flowmingo's events feed and starts the workflow on:

- New Application
- Candidate Moved to a Stage
- Application Rejected
- Interview Status Changed (opened, started, completed)
- AI Evaluation Ready (CV, interview, or combined), with the score out of 10
- Assessment Completed (Skill Test, Technical Test, Showcase, Questionnaire, CV or recording evaluation)
- Invitation Created or Sent
- Invitation Email Status Changed (delivered, opened, clicked, failed, marked as spam)
- Result Reviewed (note, rating, shortlist)

How it polls:
- The first poll after you activate the workflow only records where the feed stands. Past events are not replayed.
- Each later poll emits the new events, oldest first, and reads up to 500 of them per poll.
- **Test step** shows the newest matching event.

Each item carries the event payload plus `event_id`, `event_type`, `sub_event` and `timestamp`. Use `submission_id` with
**Result > Get**, or a candidate id with **Candidate > Get**, to read names, emails and the full evaluation.

## Credentials

1. In Flowmingo, open **Settings > API keys** and create a key. It starts with `fl_`.
2. Give the key the scopes your workflows need:
   - `read_hiring`: the trigger and the lists;
   - `read_candidates`: names and emails;
   - `invite_candidates`: Invite;
   - `write_pipeline`: Add, Move, Reject, Note, Rate, Shortlist;
   - `create_project`: Project > Create.
3. In n8n, create a **Flowmingo API** credential and paste the key.

The trigger reads a company-wide feed, so it needs a key created by an **Owner or Admin**. A key created by someone who can
see only some projects is refused with a 403.

## Compatibility

Built with `@n8n/node-cli` 0.54 against `n8n-workflow` 2.45. No runtime dependencies.

## Usage

**Example 1: post finished assessments to Slack.**
1. Flowmingo Trigger, set to **Assessment Completed**.
2. Flowmingo, **Result > Get**, with `{{ $json.submission_id }}`.
3. Slack, a message with `candidate_name`, `assessment_name` and `overall_score`.

**Example 2: invite applicants from a form.**
1. Form Trigger.
2. Flowmingo, **Candidate > Invite**: pick the assessment and hiring project, and map the email and names.

**Things to know:**
- **Invite emails the candidate at once.** Turn **Send Invitation** off to add someone without an email.
- **Results can carry warnings.** When Flowmingo refuses part of an invite (for example "Candidate has already applied
  to this project"), the item still succeeds with the message in `warnings`. When nothing was created, the node fails with
  the message.
- **Rate limit.** Each API key can make 600 requests a minute. Use the node's Retry On Fail setting for busy workflows.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Flowmingo API guide](https://flowmingo.ai/integration/api-integration)
- [Flowmingo events and webhooks](https://flowmingo.ai/integration/webhook)

## Version history

See [CHANGELOG.md](CHANGELOG.md).
