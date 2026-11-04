# Changelog

## 0.1.2 (2026-11-05)

- Package metadata only: the author email is now the maintainer's address (thang.nguyen@flowmingo.ai), which n8n's Creator Portal uses to confirm package ownership.

## 0.1.1 (2026-11-04)

- Package metadata only: the repository URL in npm's `git+https` form. First version released through trusted publishing.

## 0.1.0 (2026-11-04)

- Flowmingo node:
  - Candidate: Invite, Find by Email, Get.
  - Application: Add to Project, Move to Stage, Reject.
  - Result: Get, Add Note, Rate, Shortlist.
  - Project: Create, Get Many.
- Flowmingo Trigger: polls the events feed for 9 event types, each with its own filter.
- Flowmingo API credential (API key in `x-api-key`, tested on `/me/v1`).
