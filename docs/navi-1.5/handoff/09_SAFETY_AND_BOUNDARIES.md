# 09 — Engineering Authority, Safety and Boundaries

## What owner authorizes

Claude may substantially change architecture, rewrite defective components, restructure routes, revise data-layer interfaces, add tests, remove redundant implementation, and replace unreliable services **when justified by observed audit findings**. Favor maintainable, consistent, tested architecture rather than preserving existing bugs.

## What needs explicit owner approval

- Destructive, irreversible or high-risk **production** database changes; deletion or overwriting user records; production schema changes with material data risk.
- Production deployment, traffic switches, waitlist/admin flow policy changes, changes to auth provider configuration.
- Changes to billing, paid third-party services, subscriptions or infrastructure spending.
- Sending external emails/messages or invoking third-party changes on behalf of user.
- Exposing private data, disabling access controls, logging secrets or expanding permissions.
- Major changes to locked product behavior (companion-first Home, three-region workspace, reviewable actions, attention policy).
- Final visual design direction: owner chooses it collaboratively with Claude.

## Safe implementation defaults

- Develop on a new branch/worktree and use a separate preview/staging environment where possible.
- Before any migration: inventory affected tables, create backup/rollback strategy, test dry-run with nonproduction data, verify authorization impact. Do not execute destructive migration in production without approval.
- Preserve existing accounts, data, connections and waitlist; feature-flag unfinished behavior when necessary.
- Read-only inspect production configuration/data only when authorized and required; avoid unnecessary personal data access.
- Keep secrets server-side; redact logs and reports; do not include API keys in progress files or Git.
- Verify organization/user scoping, API authorization, RLS and cross-account tests.
- Use least privilege for agents, apps and cloud integrations.
- Avoid full production reset, force pushes to protected branches, and irreversible deployment changes.

## User-facing action permission model

Navi's internal AI must not confuse being capable of making a change with being authorized to make it. A user directly clicking “Complete task” is an explicit command. An ambiguous brain dump is not consent to schedule the week or send messages. Require review/confirmation for interpreted or consequential changes; persist action proposal/result and make failure visible.

## Response when blocked

If missing credentials, provider access, migration permissions or environment details prevent a test: say exactly what is blocked, what can continue independently, and what owner action is needed. Do not fabricate provider availability, test success, preview URL or autonomous background capability.
