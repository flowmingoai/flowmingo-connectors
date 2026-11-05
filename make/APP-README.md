# Flowmingo

Flowmingo is an AI interview and hiring platform. Use this app to start scenarios when something happens in Flowmingo, and to
invite candidates, move applications and review results.

## Connect

1. In Flowmingo, open **Settings > API keys** and create a key. It starts with `fl_`.
2. Give the key the scopes your scenarios need:
   - `read_hiring`: the Watch modules and the lists;
   - `read_candidates`: names and emails;
   - `invite_candidates`: Invite a candidate;
   - `write_pipeline`: add, move, reject, note, rate and shortlist;
   - `create_project`: Create a hiring project.
3. In Make, create a Flowmingo connection and paste the key.

The Watch modules read a company-wide events feed, so they need a key created by an **Owner or Admin**.

## Good to know

- **Invite a candidate emails the invitation at once.** Turn **Send invitation** off to add someone without an email.
- **Moving or rejecting an application can email the candidate**, when your team switched that on for the stage.
- **Each API key can make 600 requests a minute.** Make retries automatically after a rate-limit error.

API guide: https://flowmingo.ai/integration/api-integration
