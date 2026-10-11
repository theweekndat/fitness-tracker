# Hub

Single-user fitness PWA (training, nutrition, health dashboard, readiness) for an iPhone Home-Screen install, backed by one Cloudflare Worker. The full design brief is `docs/BRIEF.md`; decisions that change the brief go in `docs/DECISIONS.md`.

## Constraints and principles (brief §1)

**Zero new spend.** The user already pays for Hevy Pro and an Oura membership. Nothing else may cost money.

- Allowed services, all on free tiers: Cloudflare Workers (static assets, KV, cron triggers) on a free Cloudflare account, Open Food Facts, the Hevy API, the Oura API. No Mac, no Xcode, no Apple Developer Program.
- Before adding any package, service or API with a paid tier, a trial, a usage-based bill, or a card requirement, stop and ask. Default answer is no.
- If a free tier cannot do something, degrade the feature (brief §11) rather than pay for it.

Principles:
- One app that replaces three: Hevy (training log), MyFitnessPal (nutrition log), a health dashboard, with a readiness layer on top. It logs natively and also reads from Hevy and Oura.
- Accuracy over gamification. Every number shows its inputs and source on tap.
- Every suggestion (calories, protein, weights, alerts) carries a one-line rationale.
- Local-first: it works offline; sync fills in the rest.
- Deterministic algorithms only. No LLM calls on health data (see Oura terms, brief §4.2).
- The user is an advanced lifter. No beginner scaffolding.
- Not medical advice. Targets are estimates; show the uncertainty.

## Rules for Claude Code (brief §12)

- Plan first, then build per phase. Stop at each gate.
- **Never add a paid service, paid tier, trial or card-requiring signup.** If something needs one, stop and ask.
- Fetch and read vendor docs before writing any client. Never invent endpoint fields. Treat "verify" items as unconfirmed.
- Keep formulas in `src/domain` with tests; keep UI free of maths.
- Every user-facing number gets an info sheet with inputs, source and last-updated time.
- No LLM calls on Oura or any health data. No analytics scripts. No runtime third-party CDNs.
- Never commit secrets. Use `.dev.vars.example` and Worker secrets.
- Small commits with passing tests; keep `docs/DECISIONS.md` updated when a brief assumption changes.
- TypeScript strict; metric units internally, convert at the edge.
