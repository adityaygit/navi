# Claude Code Cloud — Navi kickoff prompt

Build **Navi**, the AI-native personal Life OS, in the private GitHub repository:

`https://github.com/adityaygit/navi`

I'm providing `Navi_Product_Spec.md`, `CLAUDE.md`, and `BUILD_INTELLIGENCE.md` (plus the duplicate PDF of the product spec). **Read the Markdown spec and both instructions first; the PDF is for reference, not a separate conflicting specification.**

Your job is to be the **lead developer and orchestrator**. Make the decisions you can reasonably make yourself. Use ordinary subagents when independent work benefits from delegation. Don't stop at a roadmap, prototype, or pretty UI: build a working, intuitive product, test it, fix it, and continue through the V1 requirements as far as the environment and usage limits allow.

You're operating **in Claude Code Cloud**, not on my laptop. Inspect the repository and authenticated tools/CLIs, and **verify GitHub write access immediately** with a safe development-branch push. My earlier Fairylearn build ended with unpushed commits due to a 403; avoid repeating that. Do not assume you can use my local Edge session or sign in to my accounts just because I provided a Google email address. Configure/provision anything you can through authorized tools. For the few actions requiring account login, credentials, payment, or consequential approval, record a precise blocker and continue independent tasks. Never put secrets in the repo or logs.

**The product requirements really matter:** Navi's text-or-voice onboarding should actually create a reviewed, populated personal OS; the hybrid dashboard/chat, review inbox, projects/goals, persistent memory, useful day/week planning, strict-but-fair accountability, briefings, and internal autonomy must function. V1 also includes Google + email auth, real-time voice, an installable iPhone PWA, opted-in push, and basic offline capture. Keep the design intentionally basic and intuitive. Initial app-runtime provider preferences, budget, and operational defaults are in the spec; verify provider APIs before relying on them.

Use `BUILD_INTELLIGENCE.md` as a durable project brain: record the full V1 roadmap, verified milestones, important decisions, tests, blockers, commits, and the next action. Make checkpoint commits frequently. Treat unfinished or unverified work honestly. When I later say **"resume"**, read saved state and current code and continue without asking me to repeat the plan.

**Start now:** inspect access and the repo, establish the smallest functional end-to-end slice, and keep implementing. Ask me only when no authorized way exists to proceed with an essential external dependency; do not pause independent work for that.
