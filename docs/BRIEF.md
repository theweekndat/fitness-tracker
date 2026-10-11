# Hub: Design Brief and Build Instructions for Claude Code (zero-cost edition)

Owner: Aiheak (Brisbane, AEST, UTC+10). Single-user personal app. Written 11 Oct 2026.

## 0. How to work on this

1. Save this file as `docs/BRIEF.md` in a new repo. Put sections 1 and 12 into `CLAUDE.md`.
2. Start in plan mode. Read the whole brief, then propose a plan for **Phase 0 only** and wait for approval.
3. Build phase by phase (section 10). Stop at each gate and show what works.
4. Do not guess external API shapes. Read the live docs, write typed clients from what they say, and treat anything marked "verify" as unconfirmed until tested.
5. All scoring and target maths lives in a pure TypeScript folder with unit tests (section 8). UI code contains no formulas.

Kickoff prompt to paste into Claude Code:

> Read docs/BRIEF.md in full. Do not write code yet. Propose a plan for Phase 0 only (the verification spike). List anything in the brief you think is wrong, unverifiable, or would cost money. Wait for my approval before building.

## 1. Constraints and principles

**Zero new spend.** The user already pays for Hevy Pro and an Oura membership. Nothing else may cost money.

- Allowed services, all on free tiers: Cloudflare Workers (static assets, KV, cron triggers) on a free Cloudflare account, Open Food Facts, the Hevy API, the Oura API. No Mac, no Xcode, no Apple Developer Program.
- Before adding any package, service or API with a paid tier, a trial, a usage-based bill, or a card requirement, stop and ask. Default answer is no.
- If a free tier cannot do something, degrade the feature (see section 11) rather than pay for it.

Principles:
- One app that replaces three: Hevy (training log), MyFitnessPal (nutrition log), a health dashboard, with a readiness layer on top. It logs natively and also reads from Hevy and Oura.
- Accuracy over gamification. Every number shows its inputs and source on tap.
- Every suggestion (calories, protein, weights, alerts) carries a one-line rationale.
- Local-first: it works offline; sync fills in the rest.
- Deterministic algorithms only. No LLM calls on health data (see Oura terms, section 4.2).
- The user is an advanced lifter. No beginner scaffolding.
- Not medical advice. Targets are estimates; show the uncertainty.

## 2. Assumptions to confirm in Phase 0

| # | Assumption | If wrong |
|---|---|---|
| A1 | iPhone, used through a **web app (PWA) added to the Home Screen**. No native app, so no HealthKit. | Android also works as a PWA; behaviour is similar. |
| A2 | Hevy Pro is active (confirmed by the user). | n/a |
| A3 | Oura ring with active membership (confirmed by the user). Oura is the source for steps, sleep, HRV and readiness inputs. | n/a |
| A4 | Protein band is 1.5 to 2.0 g per kg bodyweight. The original request said "1.5-7x ... no more than 2x". | Confirm. Implemented as a user setting with a 1.5 floor and 2.0 cap. |
| A5 | "Activity bar" means a daily progress bar for active calories (and exercise minutes) against a goal. | Confirm and adjust the dashboard tile. |
| A6 | Metric units (kg, cm, kcal). | Add a unit setting. |
| A7 | The user does not need Apple Watch or iPhone-recorded steps in the app; the ring's steps are enough. | Use the optional Shortcuts ingest in 4.3. |

## 3. Architecture

- **App:** Vite + React + TypeScript (strict), installed as a PWA (web manifest, service worker for the app shell, standalone display). Hash-based routing so static hosting needs no rewrite rules. Build the UI with plain CSS and hand-written SVG charts to keep the bundle small and avoid dependencies.
- **Local store:** IndexedDB through Dexie. All logs live here first.
- **Domain folder:** `src/domain` (pure TS, no React, no I/O). Every formula lives here. Vitest tests.
- **Barcode scanning:** `@zxing/browser` using the camera through `getUserMedia`. iOS Safari has no native barcode detector, so a JavaScript decoder is required. Fallbacks: decode from a photo (`<input type="file" accept="image/*" capture>`) and manual barcode entry.
- **One Cloudflare Worker** serves both the built app (Workers static assets) and the API under `/api/*`, so the app and API share an origin and there is no CORS to manage. Free plan limits (checked 11 Oct 2026): 100,000 requests per day, 10 ms CPU per request, 5 cron triggers, 50 subrequests per invocation. Practical rules: **never parse or transform large JSON bodies in the Worker; stream them through**, keep every route I/O-bound, and cache Open Food Facts responses with the Cache API.
- **KV namespace** (free tier) holds Oura tokens and optional data backups.
- **Hosting URL:** the free `*.workers.dev` subdomain. A custom domain is not needed.
- **Deploy:** `wrangler deploy` from the repo. Secrets set with `wrangler secret put`.

### Worker API

| Route | Purpose |
|---|---|
| `GET /api/status` | Which integrations are connected, last sync times |
| `GET /api/hevy/*` | Read-only proxy to Hevy for an allowlist of paths (workouts, workouts/count, workouts/events, exercise_templates, routines, routine_folders). The Hevy key is a Worker secret and never reaches the browser. |
| `POST /api/oura/start` | Creates a random `state` in KV (10 min TTL), returns the Oura authorise URL |
| `GET /api/oura/callback` | Validates `state`, exchanges the code, stores tokens in KV, redirects to the app |
| `GET /api/oura/data/:collection` | Proxy for `daily_sleep`, `sleep`, `daily_readiness`, `daily_activity`, with automatic token refresh |
| `POST /api/oura/disconnect` | Deletes stored tokens |
| `GET /api/off/product/:barcode`, `GET /api/off/search?q=` | Open Food Facts proxy that sets the required User-Agent and caches |
| `PUT/GET /api/backup` | Optional: store or fetch one JSON backup of the whole local database |
| `POST /api/ingest` | Optional (Phase 5): accepts weight and steps pushed from an iOS Shortcut |

Auth: every route except the Oura callback requires `Authorization: Bearer <APP_TOKEN>`. `APP_TOKEN` is a long random string set as a Worker secret and entered once into the app (kept in `localStorage`). Compare tokens in constant time. Allow no other origin.

Secrets: `APP_TOKEN`, `HEVY_API_KEY`, `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`. Plain variable: `OFF_CONTACT` (the contact string for the User-Agent; ask the user what to use, do not reuse their email without asking).

## 4. Data sources

### 4.1 Hevy (training)
- Base URL `https://api.hevyapp.com`. Auth header `api-key`. Requires Hevy Pro (the user has it). Key generated at hevy.com/settings?developer.
- Endpoints (from a client reference; confirm against https://api.hevyapp.com/docs/): `GET /v1/workouts` (`page`, `pageSize`), `GET /v1/workouts/{id}`, `GET /v1/workouts/count`, `GET /v1/workouts/events` (`page`, `pageSize`, `since`), `GET /v1/exercise_templates`, `GET /v1/routines`, `GET /v1/routine_folders`. POST/PUT exist for workouts and routines but this app only reads.
- Workout fields: `id`, `title`, `start_time`, `end_time`, `updated_at`, `created_at`, `exercises`. Each exercise carries `exercise_template_id` and `sets`. Set fields: `type` (`normal | warmup | dropset | failure`), `weight_kg`, `reps`, `distance_meters`, `duration_seconds`, `rpe` (6, 7, 7.5, 8, 8.5, 9, 9.5, 10 or null). Exact response field names for exercises and sets must be confirmed from the live docs before the parser is written.
- Events: `{type: "updated", workout}` or `{type: "deleted", id, deleted_at}`. Use these for incremental sync after the first full backfill.
- Exercise templates: `id`, `title`, `type`, `primary_muscle_group`, `secondary_muscle_groups` (array), `is_custom`. Page sizes are small by default and have maximums; request the documented maximum and handle a 400 by reducing it.
- Cache raw JSON beside normalised rows so schema changes never lose data. Throttle and back off; rate limits are not documented in sources I could reach.
- RIR from Hevy RPE: `RIR = 10 - RPE`. Warm-up sets never count as working sets.
- Local override table for exercises Hevy labels wrongly.

### 4.2 Oura
- OAuth2 only (personal access tokens were retired in December 2025). Authorise URL `https://cloud.ouraring.com/oauth/authorize`, token URL `https://api.ouraring.com/oauth/token`. Make the token URL a Worker variable, because one community write-up reports Oura serves a different token host in practice. Scopes: `email personal daily heartrate workout tag session spo2`; request only `personal daily heartrate workout session`.
- Code exchange: POST form-encoded `grant_type=authorization_code`, `code`, `redirect_uri` (must match), client credentials. **Refresh tokens are single-use**: every refresh returns a new refresh token that must be stored, and a reused one is rejected. So exactly one component (the Worker, writing to KV) owns the tokens, and the app must call Oura endpoints one at a time. Handle refresh failure with a clear "reconnect Oura" state.
- Register a free Oura OAuth application; its redirect URI is `https://<your-worker>.workers.dev/api/oura/callback`.
- Collections (v2): `daily_sleep` (score and contributors), `sleep` (per-period detail: stages, average HRV, lowest heart rate, efficiency, bedtimes), `daily_readiness` (score, contributors, temperature deviation), `daily_activity` (steps, active calories, score). Expected field names such as `steps`, `active_calories`, `average_hrv`, `lowest_heart_rate`, `score` and `day` must be verified in Phase 0 from a real payload. Oura treats `end_date` as exclusive on several endpoints, so request day D with end D+1.
- Oura data appears only after the ring has synced to the Oura app. Show "last synced" and never present a stale day as today.
- **Compliance:** a third-party summary of Oura's API agreement (effective 8 Jun 2026, section 4(d)) says API data may not be used to prompt or supply AI models. Read the agreement. All Oura-derived scoring stays deterministic and no Oura data is ever sent to an LLM. The agreement also reserves the right to charge API fees in future; if that happens, stop and ask.
- Oura's HRV is RMSSD. If Apple Health HRV (SDNN) ever arrives through the Shortcuts ingest, keep it in a separate baseline and never mix the two.

### 4.3 Apple Health (optional, free)
Browsers cannot read Apple Health, and native HealthKit access needs a paid Apple Developer account, which is out of scope. Free alternative for later: an iOS Shortcut ("Find Health Samples" for body weight or steps, then "Get Contents of URL" to `POST /api/ingest` with the bearer token) run as a Personal Automation. The Worker stores the readings in KV; the app pulls them on open. Phase 5 only; skip if Oura steps and manual weigh-ins are enough.

### 4.4 Food data and barcodes
- Primary: Open Food Facts, `GET /api/v2/product/{barcode}.json` (v2 is deprecated but supported; v3 is recommended for new work, so check which to use). No key, ODbL licence. A not-found product can come back with `status: 0`; check the body. Coverage is crowd-sourced and uneven outside Europe and North America; fields are often missing; 503s are intermittent. Nutriments are per 100 g and often per serving; watch the **kJ vs kcal** trap and the free-text `serving_size` string.
- Open Food Facts asks for a custom User-Agent in the form `AppName/Version (contact)` and limits product reads to **15 requests per minute per IP**. Browsers cannot set User-Agent, which is why the Worker proxies it. Cache every product for at least 30 days and keep a local copy in IndexedDB.
- **Phase 0 test:** scan 25 real Australian pantry and supermarket barcodes and report hit rate and field completeness.
- Fallback chain: local cache, then Open Food Facts, then **"Scan label" manual entry** that saves a custom food keyed to the barcode so it is a one-time cost per product. A second database is added only if it is genuinely free for personal use and its licence allows caching; none has been verified, so this needs the user's approval.
- Data-quality check on every imported food: compare stated kcal with 4P + 4C + 9F; flag differences over 15%; flag missing macros. Let the user fix and save a corrected copy.

## 5. Features

### 5.1 Dashboard (Today)
Four primary tiles plus a readiness chip, each tappable into a detail screen:
1. **Steps:** today's count from Oura, progress to goal (default 10,000, adjustable), 7-day sparkline, "last synced" time.
2. **Calories and macros:** remaining kcal, then P / C / F progress with grams remaining. The protein bar shades the 1.5 to 2.0 g/kg band so "inside the band" is visible.
3. **Sleep score:** last night's score with source badge (Oura or computed), duration, stage split.
4. **Activity bar:** active calories vs goal from Oura, plus exercise minutes when available (A5).
- **Readiness chip:** 0 to 100, band label, and the main driver in words.
- Below the fold: this week's muscle-group set counts with gap flags, last training effectiveness score, today's suggested session and weights.

### 5.2 Nutrition tracker (native, MyFitnessPal parity)
Core: diary by meal (breakfast, lunch, dinner, snacks, plus user-defined meals); food search; **barcode scan then instant log**; servings stepper accepting fractions in 0.25 steps and any unit (g, ml, serving, custom household measure); quick-add calories and macros; recent and frequent foods; copy meal or day; saved meals; recipe builder (ingredients, number of servings, per-serving nutrition); custom foods; water log; daily notes.
Nutrients tracked: kcal, protein, carbs, fat, plus fibre, sugars, saturated fat, sodium and any other label field present.
Goals: daily targets with **training-day vs rest-day** schedules; optional per-meal macro splits; weekly average view.
Reports: daily and 7/14/30-day averages, macro split, protein per kg over time, weight trend vs intake.
Weight: daily weigh-in log (manual, or via the Shortcuts ingest later), 7-day exponentially smoothed trend, rate of change in % bodyweight per week.
Utilities: CSV export, undo, offline logging with later sync.
Barcode flow: scan, resolve through the fallback chain, confirmation sheet showing per-100 g and per-serving values with a servings stepper pre-set to one serving, then Log. Unknown barcode opens "Scan label" pre-filled with the barcode.

### 5.3 Calorie and macro calculator (adjustable and accurate)
Inputs: sex, age, height, weight, optional body-fat % (mark measured or estimated), activity source, goal, target rate of change.

**Step 1: BMR.** Mifflin-St Jeor by default: `10·kg + 6.25·cm − 5·age + 5` (men) or `− 161` (women). If body fat is supplied, offer Katch-McArdle `370 + 21.6 · lean_mass_kg` and default to it only when body fat was measured (DEXA or equivalent). Mifflin-St Jeor lands within 10% of measured values in roughly 82% of non-obese adults, so display results as a range (±10%).

**Step 2: TDEE.** `TDEE = BMR × activity factor`. Default factor is derived from rolling 14-day average Oura steps and weekly training sessions with an editable table (steps under 5,000: 1.20; under 8,000: 1.30; under 11,000: 1.375; under 14,000: 1.45; above: 1.50; plus 0.04 per weekly session, capped at +0.20). This is a heuristic starting point; manual override allowed.

**Step 3: goal adjustment.** Express the goal as a bodyweight rate, then convert: `daily_adjustment = rate_kg_per_week × 7700 / 7`.
- Cut: 0.5 to 1.0 % of bodyweight per week (Helms et al. 2014 range for maximising muscle retention). Default 0.5%.
- Maintain: 0. Lean gain: default +0.25 % per week, adjustable.
- 7700 kcal/kg is an approximation, which is why Step 5 exists.

**Step 4: macros.**
- Protein (hard constraint): `1.5 × kg ≤ protein_g ≤ 2.0 × kg`, default 1.8 g/kg. The UI cannot leave the band unless the user changes the band in Settings. Info sheet: Morton et al. 2018 (49 studies, 1,863 participants) found no further lean-mass gain above about 1.6 g/kg/day, but the breakpoint's confidence interval is wide. Helms et al. 2014 recommend 2.3 to 3.1 g/kg of **fat-free mass** for lean athletes in a deficit; at 15% body fat that is about 1.95 g/kg bodyweight, just under a 2.0 cap. At lower body fat and a steeper deficit it exceeds the cap, so show a non-blocking note and keep the user's cap.
- Fat: default 25% of calories, adjustable within 15 to 30% (Helms 2014 range).
- Carbohydrate: the remainder, `(kcal − 4·P − 9·F) / 4`. Warn if it comes out negative.
- Live check that macro calories sum to the target.

**Step 5: adaptive recalibration.** After at least 14 days of span, 8 weigh-ins and 80% of days logged: `TDEE_obs = mean_intake − (Δtrend_weight_kg × 7700 / days)`. Blend `TDEE_used = w·TDEE_obs + (1−w)·TDEE_formula`, with w rising linearly from 0.3 at 14 days to 0.8 at 42 days. Show formula vs observed side by side and let the user accept a suggested change weekly. Never change targets silently.

**Worked example (illustrative, not the user's numbers):** 85 kg, 180 cm, 25 y, male, 15% BF, factor 1.55. Mifflin BMR 1,855; TDEE 2,875. Cut at 0.5%/wk is 0.425 kg/wk, so deficit 468 kcal and target 2,408 kcal. Protein 1.8 g/kg = 153 g; fat 25% = 67 g; carbs = 298 g. (Katch-McArdle for the same 72.25 kg lean mass gives BMR 1,931.) These must pass as unit tests.

### 5.4 Training

**Native logger (Hevy parity):** exercise library (imported Hevy templates plus custom), routines and folders, set types (warm-up, normal, drop, failure), weight × reps with **RIR per set**, rest timer, supersets, previous-session values inline, PR detection (weight, reps, e1RM), plate calculator, notes, per-exercise history, bodyweight and assisted movements, kg/lb. Offline first. Keep the screen awake during a workout with the Screen Wake Lock API where supported.

**Hevy sync:** import every Hevy workout into the same tables. De-duplicate by Hevy workout id and by (start time, exercise sequence) so native and Hevy logs never double count.

**Muscle-group coverage (weekly):**
- Weekly window Monday to Sunday, local time.
- Hard sets per muscle = working sets (warm-ups excluded). A set counts 1.0 for the primary muscle and 0.5 for each secondary muscle (configurable; partial-credit counting is a design choice, expose it).
- Default targets for an advanced lifter, editable per muscle: minimum effective volume 8, working range 12 to 20, ceiling about 22 to 24 sets for large muscles; smaller defaults for biceps, triceps, calves and accessory muscles; no alerts for lower back, adductors, abductors, neck. Basis: Schoenfeld et al.'s dose-response meta-analysis (more weekly sets, more growth, flattening past roughly 10+) and the common MEV/MAV/MRV landmarks (about 6 to 10 / 12 to 20 / 20 to 26). Per-session useful volume is roughly 6 to 10 hard sets per muscle; show a "junk volume" hint above that. These numbers are heuristics, not validated individual prescriptions.
- Alert logic: project the week as sets done plus the sets the user usually does after the same weekday in the previous four weeks (no schedule needed). If projected sets fall below a muscle's low target, flag it: "Side delts: 7 of 12 sets and nothing usually follows this late in the week." Flag muscles above their ceiling too.
- Frequency check: muscles trained on fewer than 2 distinct days in the week get a soft hint only (hypertrophy outcomes are similar when volume is matched).

**Training effectiveness score (0 to 100):**
- 100 = improvement, 80 = same or similar as usual, 60 or below = worse than usual.
- Per exercise, per week: best working set's **e1RM** by Epley with reps in reserve: `e1RM = load × (1 + (reps + RIR)/30)`. Reps above 12 are excluded from e1RM; for exercises only done above 12 reps use load × reps, mapped identically. If RIR is missing, assume RIR 0 and mark the exercise "low confidence". Only compare weeks that use the same metric kind.
- "Usual" = median of that exercise's weekly values over the previous 4 weeks (needs at least 2 prior weeks). `Δ% = (this week − usual) / usual × 100`.
- Piecewise mapping (parameters editable; defaults `up = +2`, `down = −3`, floor `−10`):
  - Δ ≥ +2 → 100
  - 0 ≤ Δ < +2 → 80 + 10·Δ
  - −3 < Δ < 0 → 80 + (20/3)·Δ
  - Δ ≤ −3 → max(0, 60 + (Δ + 3)·(60/7))
  - Test vector: Δ = +2 → 100, +1 → 90, +0.5 → 85, 0 → 80, −1 → 73.3, −3 → 60, −6 → 34.3, −10 → 0.
- Weekly score = mean across exercises with enough history, weighted by working sets. Show the per-exercise breakdown and an 8-week trend. Bands: 90 to 100 improving, 70 to 89 on par, 60 to 69 slightly down, below 60 down.
- Advanced lifters rarely beat their e1RM weekly and week-to-week noise is easily 2 to 3%. So also show a 4-week rolling average of the weekly scores, and do not treat a single 75 as a problem.

**Weekly prescription (suggested weight and rep range per exercise):**
- Method: autoregulated double progression driven by logged RIR and e1RM. Each exercise has a user-set rep range (default compounds 6 to 10, isolation 10 to 15), a load increment (default 2.5 kg plate-loaded, editable per exercise) and a target RIR from the mesocycle week.
- Rules, applied to the most recent session containing the exercise (top-load working sets):
  1. All top-load sets reached the top of the rep range at or below the target RIR → add one increment, reset target reps to bottom of range + 1.
  2. Sets inside the range → keep load, aim +1 rep on the weakest set.
  3. Missed the bottom of the range, or sets were 2+ RIR harder than planned → hold load; if the previous session also missed, drop about 7.5% and flag.
  4. Sets felt more than one RIR easier than planned and reps were in range → add one increment (standard autoregulation rule).
- Mesocycle layer (default 5 weeks): target RIR steps from 3 down to 1 over the four build weeks; week 5 is a deload at about half the sets, load held.
- **Auto-deload suggestion:** two consecutive weekly scores at or below 75 while effort at the same load rises, or readiness below 60 on 5 or more of the last 7 days. Always a suggestion, never forced.
- Daily readiness advice (advisory): readiness under 60 suggests 5 to 10% less load or one or two fewer sets; 85 or above suggests pushing the top set.
- Every row shows the rule that produced it ("8, 8, 7 @ 80 kg, RIR 2 last time → +2.5 kg"). No prescription is a guarantee of progress; copy says "suggested".

### 5.5 Sleep score and readiness

**Sleep score (0 to 100):** show Oura's daily sleep score with its contributors. If unavailable, compute: duration vs target (default 8 h, editable) 40%, efficiency 20%, deep plus REM share 25%, bedtime consistency over 7 nights 15%, re-weighting any missing part. Always label the source.

**Readiness score (0 to 100):** deterministic composite computed locally from Oura data, shown beside Oura's own readiness number.
- Components and default weights (a design choice, not clinically validated): HRV vs personal baseline 35, resting or lowest heart rate vs baseline 20, sleep (score blended with duration vs target) 30, recent training load 15.
- Baseline: rolling 21 nights, minimum 7 observations before any score is shown. Use `ln(HRV)` for the HRV baseline with a standard-deviation floor.
- Component score: `z = (today − mean21) / sd21` (sign flipped for heart rate); `component = clamp(75 + 12.5·z, 0, 100)`, so a normal night scores about 75.
- Training load: acute (last 3 days) vs chronic (28-day) hard-set ratio; at or below 1.3 scores 85, then falls linearly to 30 at a ratio of 2.0.
- Output: score, band (85+ high, 70 to 84 good, 60 to 69 moderate, under 60 low) and a one-sentence driver such as "HRV 12% below baseline".

### 5.6 Steps and activity
Daily, weekly and monthly step views from Oura, goal streaks, and a 14-day average that feeds the TDEE activity factor. Active calories and exercise minutes feed the activity bar. Everything updates when the ring syncs, not continuously; the UI says so.

### 5.7 Notifications and alerts
Muscle-gap alerts, weekly effectiveness summary (Sunday evening), readiness-based session suggestion, protein-below-floor reminder, weigh-in reminder.
- Default delivery is in-app: dashboard cards and a badge, which work everywhere and cost nothing.
- Web push on iOS for Home-Screen web apps is **unverified for this setup**; test it in Phase 0. If it works, use the Web Push standard with free VAPID keys and a Worker cron trigger (5 are free). If it does not, ship in-app alerts only. Do not buy a push service.

## 6. Data model (IndexedDB), backup

Tables: `settings` (units, protein band, fat %, targets by day type, volume targets per muscle, scoring parameters, goals) · `foods` (source, barcode, name, brand, per-100 nutrients, servings, quality flags) · `foodLog` (nutrient snapshot on every row so editing a food never rewrites history) · `savedMeals`, `recipes` · `water` · `weights` · `exercises` (Hevy template id, primary and secondary muscles, increment, rep range) · `muscleOverrides` · `workouts` (source: native or hevy, external id, sets) · `routines` · `prescriptions` (week, load, reps, rule, rationale) · `daily` (steps, active calories, exercise minutes from Oura) · `sleepNights` (source, stages, HRV, lowest HR, score) · `readinessDays` (components, score) · `syncState` · `rawPayloads`.

**Backup (important for a web app):** Safari can evict site storage. Home-Screen web apps are exempt from Safari's 7-day inactivity cap, but treat local data as recoverable, not permanent. Request persistent storage with `navigator.storage.persist()`, offer one-tap JSON export and import, and add an optional automatic backup to Worker KV (one JSON blob, daily at most, to stay far below KV's free write limit). Restore must be tested in Phase 1.

## 7. Design direction

- Dark-first with a light theme. System font stack. Large numerals for the four dashboard figures; dense, calm, no confetti.
- PWA details: `viewport-fit=cover` with safe-area insets, `apple-touch-icon` and PNG manifest icons (192 and 512), standalone display, theme colour, tap targets of at least 44 px, no hover-only controls, bottom tab bar, `overscroll-behavior` set so pull-to-refresh does not fight the UI.
- Dashboard is one scrollable screen: four tiles on top, readiness chip pinned above them, secondary modules below.
- Score colours: 80+ green, 60 to 79 amber, under 60 red; the same thresholds mean the same thing for effectiveness and readiness. Colour is never the only signal (always a number and a label).
- Tabs: Today · Food · Train · Trends · Settings.
- Fast paths matter most: log a barcode in two taps; start a workout from the dashboard; set entry with a numeric keypad.
- Build a small token and component set first (ProgressRing, MacroBar, ScoreChip, SetRow, ServingsStepper, MuscleGapBar), then screens. A mockup pass in Claude Design before Phase 1 screens is recommended.

## 8. Testing

- `src/domain` has full unit coverage on: Mifflin, Katch-McArdle, macro solver, protein clamp, adaptive TDEE, e1RM, effectiveness mapping, muscle-set counting (primary and secondary), projection, prescription rules, readiness z-scores, sleep score, bands.
- Golden vectors: Mifflin(85 kg, 180 cm, 25 y, male) = 1,855; Katch-McArdle(72.25 kg lean) = 1,930.6; example target 2,408 kcal with P153 / F67 / C298; Epley(100 kg × 8 @ RIR 2) = 133.3 and (100 × 6 @ RIR 1) = 123.3; effectiveness table in 5.4.
- Property tests: macro calories equal the target within 1 kcal; protein always inside the band; scores always within 0 to 100.
- Adapter tests with recorded fixtures: a Hevy workout page, Hevy events, an Oura collection response, an Open Food Facts product, and a not-found product.
- Worker tests (Vitest with Miniflare or plain unit tests of handlers): bearer auth, allowlist rejection, Oura state check, token refresh storing the new refresh token, cache behaviour.
- Manual device checklist per phase on the user's iPhone: install to Home Screen, camera in standalone mode, offline logging, backup and restore, timezone check.

## 9. Privacy and security

- Health data stays in the user's browser storage and the user's own Cloudflare account. No analytics or ad scripts, no third-party fonts or CDNs at runtime.
- Secrets live only in Worker secrets and KV. Never log tokens or health values. Never commit secrets; provide `.dev.vars.example`.
- Settings screen: connection status per provider, disconnect and delete buttons, full JSON and CSV export.
- Keep the Worker closed: bearer token on all routes, allowlisted upstream paths, read-only proxying.
- Respect Oura's API terms (4.2). Respect the ODbL licence for Open Food Facts data (attribution).

## 10. Phases and acceptance

**Phase 0: verification spike (gate before any feature work).**
- Create the free Cloudflare account setup notes and confirm `wrangler deploy` works with static assets plus one `/api/status` route.
- Hevy key works through the Worker proxy and a real workout list returns; record the real response shapes.
- Oura OAuth app registered; one full authorise-and-callback round trip stores tokens; `daily_sleep`, `sleep`, `daily_readiness` and `daily_activity` return real data; record the real field names (steps, HRV, calories).
- On the user's iPhone as an installed Home-Screen app: camera scanning works, `navigator.storage.persist()` result, IndexedDB survives a force-quit, and a web push test succeeds or fails.
- 25-barcode Open Food Facts hit-rate report on Australian products.
- Output: a one-page findings note and a go / degrade / no-go per integration, plus a cost check confirming nothing new is billed.

**Phase 1: foundation, nutrition, targets, dashboard shell.** Repo, domain folder with tests, IndexedDB schema, tokens and base components, barcode scan then log, servings stepper, diary, custom foods, calculator (Steps 1 to 4), weigh-ins, backup and restore, dashboard with calories and macros tile. Accept: a barcode logs in two taps; the calculator reproduces the worked example; protein cannot leave the band; a backup restores to an empty browser.

**Phase 2: Hevy import, coverage, effectiveness.** Backfill and incremental sync; muscle mapping with overrides; weekly set counts and gap alerts; effectiveness score and trends. Accept: weekly sets match a manual count from Hevy for two sample weeks; the score table passes.

**Phase 3: Oura, steps, sleep, readiness.** Sync, steps tile, sleep tile, local readiness composite with contributors, activity bar. Accept: sleep score matches the Oura app for the last 7 days; readiness appears after 7 nights of data.

**Phase 4: native logger and weekly prescription.** Full logger, routines, PRs, prescription engine and mesocycle layer, readiness advice. Accept: a full session logged offline syncs and de-duplicates cleanly; every prescription row shows its rule.

**Phase 5: polish and parity.** Recipes, saved meals, copy day, day-type targets, reports, adaptive TDEE recalibration, CSV export, web push if Phase 0 allowed it, optional Shortcuts ingest for weight and steps.

## 11. Risks and free-tier trade-offs

1. **No Apple Health access.** Only Oura steps and sleep; iPhone or Apple Watch step counts are not read. Mitigation: A7 and the optional Shortcuts ingest.
2. **Browser storage can be cleared.** Mitigation: Home-Screen install, persistent storage request, export, KV backup.
3. **Camera scanning in an iOS Home-Screen app** needs real-device testing. Fallbacks: photo decode and manual entry.
4. **Notifications may be in-app only** if iOS web push is unreliable.
5. **Open Food Facts coverage for Australian products is unverified**, and a second free source may not exist. Fallback: the "Scan label" one-time entry.
6. **Workers free plan CPU is 10 ms per request.** Keep the Worker a thin streaming proxy.
7. **Oura:** refresh tokens are single-use; field names need verification; the API agreement restricts AI use and may add fees later.
8. **Hevy:** rate limits and exact response field names are unconfirmed.
9. **Protein cap:** 2.0 g/kg sits below what the literature suggests for a lean lifter in an aggressive deficit; the app shows a note but honours the cap.
10. Readiness weights, volume defaults and the activity-factor table are heuristics, not validated; the info sheets say so.

## 12. Rules for Claude Code

- Plan first, then build per phase. Stop at each gate.
- **Never add a paid service, paid tier, trial or card-requiring signup.** If something needs one, stop and ask.
- Fetch and read vendor docs before writing any client. Never invent endpoint fields. Treat "verify" items as unconfirmed.
- Keep formulas in `src/domain` with tests; keep UI free of maths.
- Every user-facing number gets an info sheet with inputs, source and last-updated time.
- No LLM calls on Oura or any health data. No analytics scripts. No runtime third-party CDNs.
- Never commit secrets. Use `.dev.vars.example` and Worker secrets.
- Small commits with passing tests; keep `docs/DECISIONS.md` updated when a brief assumption changes.
- TypeScript strict; metric units internally, convert at the edge.

## 13. Sources

- Cost and platform: Cloudflare Workers free-plan limits, https://developers.cloudflare.com/workers/platform/limits · free Apple account limits (apps expire after 7 days), https://mybyways.com/blog/new-limitations-imposed-on-free-apple-developer-account · Hevy Pro pricing (user already subscribed), https://www.sensai.fit/pt/blog/hevy-review-2026 · Oura membership (user already subscribed), https://support.ouraring.com/hc/en-us/articles/4409086524819
- Protein: Morton et al. 2018, Br J Sports Med 52(6):376-384, https://pubmed.ncbi.nlm.nih.gov/28698222/ · Helms et al. 2014, https://pubmed.ncbi.nlm.nih.gov/24092765/ · Helms, Aragon, Fitschen 2014, https://jissn.biomedcentral.com/track/pdf/10.1186/1550-2783-11-20 · Stronger By Science on the Morton breakpoint, https://www.strongerbyscience.com/?p=61316
- Energy equations: https://fitnessvolt.com/tdee-calculator/formulas/ · https://getfitcraft.com/tools/bmr-calculator
- Volume: Schoenfeld, Ogborn, Krieger 2017 dose-response meta-analysis (PMID 27433992) · https://www.sensai.fit/blog/training-volume-hypertrophy-sets-per-muscle-per-week · https://skills.sh/disco-trooper/skills/hypertrophy-training
- Progression and autoregulation: https://rippedbody.com/progression/ · https://www.strongerbyscience.com/?p=45392 · https://www.lyfta.app/articles/rpe-strength-training
- Readiness models: https://docs.junction.com/sense/query-dsl/readiness-scores · https://support.google.com/googlehealth/answer/14236710 · https://www.david-smith.org/blog/2022/01/24/readiness-score/
- Hevy API: https://api.hevyapp.com/docs/ · client reference with endpoint and field list, https://mintlify.wiki/imalfect/hevy-http-mcp/architecture/hevy-client
- Oura API: authentication, https://cloud.ouraring.com/docs/authentication · API v2 docs, https://cloud.ouraring.com/v2/docs · agreement summary, https://tryterra.co/blog/oura-api-ai-apps-access-permissions-commercial-restrictions
- Open Food Facts: API introduction (User-Agent rule, 15 requests per minute for product reads), https://openfoodfacts.github.io/openfoodfacts-server/api/ · fields, https://wiki.openfoodfacts.org/Fields_used
