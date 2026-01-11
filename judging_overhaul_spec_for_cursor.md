# Judging Overhaul Spec (WinBallot) — Reference Doc for Cursor

**Assumption:** You have made **no changes** yet to your previous judging system. This doc describes the **complete replacement** you want.

**Goal:** Replace the current “per-metric generic feedback” with **championship-grade, evidence-heavy, actionable judging** that top NSDA competitors trust.

---

## 1) What’s wrong with the current system (and what we are fixing)

### Current behavior (symptoms)
- Feedback feels templated and repetitive across categories.
- Scores cluster together (everything looks like ~same band) even when speech quality varies.
- Nonsense/off-topic sometimes still receives high-looking feedback or fails to show in UI.
- “Tone” and “body language” are either guessed or not reliably measurable → credibility risk.
- UI/PDF format is optimized for small per-metric blurbs, not judge-style reasoning.

### Fix in this overhaul
- Make the ballot **RFD-first** (judge narrative), then provide **receipts**, then **ranked levers**, then **micro-rewrites**, then **metrics-only coaching**, then **next-round checklist**.
- Remove anything you can’t support with evidence (no subjective tone/body claims unless supported by real metrics).
- Introduce **classification + caps** so nonsense/off-topic cannot receive normal scores.
- Ensure the system **never stalls** at edge cases: if LLM is skipped or capped, the UI must still display a completed ballot.

---

## 2) New product behavior (what the user sees)

### Output order (UI and PDF)
1) **Transcript (Full)** — collapsible by default
2) **Score Summary** — overall + subscores + tier
3) **RFD (Reason for Decision)** — detailed judge narrative
4) **Evidence Receipts** — Strength vs Gap, each with quote + warrant
5) **Ranked Levers** — 3–5 (normal) or 1–2 (capped)
6) **Micro-Rewrites** — 2–4 direct before → after upgrades
7) **Delivery Metrics Coaching** — metrics-only (WPM, fillers/min, pauses if available)
8) **Next-round Checklist** — 3 measurable tasks + warmup/cues/review

### What is NOT shown as scored categories (for now)
- **Body language**: not scored.
- **Tone**: not scored.
- **Subjective delivery**: not scored.

Instead: show **metrics-only** delivery snapshot.

---

## 3) Scoring model (credible today)

### Scored categories (ONLY these affect overallScore)
- **Argument & Structure** (weight 0.45)
- **Depth & Weighing** (weight 0.35)
- **Rhetoric & Language** (weight 0.20)

### Delivery (not scored)
Reported separately using trusted metrics:
- durationSec, durationText
- wordCount
- wpm
- fillerWordCount, fillerPerMin
- optional pausesPerMin

### Score tiers
- **9.0–10.0** Finals-caliber
- **8.0–8.9** Breaking rounds
- **7.0–7.9** Competitive
- **5.0–6.9** Developing
- **3.0–4.9** Major issues
- **0.0–2.9** Off-topic/nonsense/too short

---

## 4) Classification + hard caps (mandatory)

### Labels
- `normal`
- `too_short` (durationSec < 60 OR wordCount < 100)
- `nonsense` (incoherent word salad)
- `off_topic` (coherent but unrelated to quote/theme)
- `mostly_off_topic` (minimal connection; majority unrelated)

### Caps
- too_short / nonsense / off_topic → **maxOverallScore = 2.5**
- mostly_off_topic → **maxOverallScore = 6.0**

### Required output behavior when capped
- Still produce a complete ballot (no blank UI)
- Shorter output:
  - Evidence: 5–10
  - Levers: 1–2
  - Micro-rewrites: 0–1
  - RFD: 6–10 sentences
- Must explain:
  - Why the cap triggered
  - Exactly how to exit the cap next time

#### Example (capped RFD snippet)
- “This round is capped because the speech is off-topic relative to the theme. Most content discusses unrelated subjects and does not link back to the quote. This did not reach the normal scoring band because there is no thesis that answers the prompt.”

---

## 5) Evidence system (receipts-first)

### Rule
Every major claim must cite `evidenceIds`.

### Evidence object types
**QUOTE evidence**
- 5–20 words
- verbatim substring from transcript
- include timeRange if available; otherwise `[no timecode available]`
- include a **warrant** (why it matters competitively)

**METRIC evidence**
- uses trusted metrics only (WPM, fillerPerMin, etc.)
- include a warrant describing judge impact

### Normal vs capped counts
- normal: 12–20 evidence items
- capped: 5–10

#### Example QUOTE evidence item
- Quote: “tiny drop of water in a big ocean”
- timeRange: “[no timecode available]”
- Warrant: “This creates scale and stakes quickly, which judges reward because it anchors the round and makes later examples coherent.”

#### Example METRIC evidence item
- Metric: fillerPerMin = 9.2
- Warrant: “At outround pace, this reduces clarity and can make transitions feel uncertain; judges typically penalize perceived control.”

---

## 6) RFD (Reason for Decision) — detailed and judge-like

### Requirements
- normal: 10–16 sentences
- capped: 6–10 sentences

Must include:
- What earned the score
- What capped the score
- What moves it to the next band
- End with: “This did not reach [next band] because [missing move].”

Also include structured fields:
- `whyThisScore`: exactly 2 claims, each cites 3–5 evidenceIds
- `whyNotHigher`: nextBand + exactly 2 blockers, each cites 2–5 evidenceIds

#### Example (whyThisScore claim)
- Claim: “The speech earns a competitive tier because it maintains a clear three-point structure and repeated link-backs to the thesis.”
- Evidence: [E1, E3, E6]

---

## 7) Ranked levers (the upgrade path)

### Counts
- normal: 3–5 levers
- capped: 1–2 levers

### Each lever MUST include
- `name`
- `estimatedScoreGain` (e.g., “+0.4 to +0.8”)
- `patternName` (Warrant Gap / Mechanism Missing / Weak Synthesis / Link-back Drift / No Tradeoff)
- `diagnosis` (6–12 sentences, specific to this speech)
- `judgeImpact` (3–6 sentences)
- `evidenceIds` (3–6)
- `fixRule` (one sentence)
- `coachQuestions` (3–5)
- `sayThisInstead` (exactly 2 copyable lines)
- `counterexampleKit` (counterexampleLine + resolutionLine)
- `drill` (name + exactly 3 steps + measurable goal)

#### Example lever (short sample)
**Lever #1: Depth — Tradeoff + Resolution per example (+0.4 to +0.8)**
- Fix rule: “After each example: benefit → tradeoff → resolution → link-back.”
- Coach Q: “When does teamwork fail, and what condition prevents that here?”
- Say-this-instead:
  1) “Teams win when specialization beats coordination cost—roles convert effort into compounding gain.”
  2) “Groupthink is the risk, so accountability and dissent are the condition for teamwork to outperform.”
- Drill goal: “Add tradeoff+resolution lines to 3/3 examples by next session.”

---

## 8) Micro-rewrites (copy/paste upgrades)

### Counts
- normal: 2–4
- capped: 0–1

### Each micro-rewrite includes
- `before` = real transcript quote + timeRange
- `after` = 1–2 improved sentences
- `whyStronger` = 1–3 sentences
- `evidenceIds` = 1–3

#### Example
- Before: “together… much greater results”
- After: “Together wins only when roles prevent chaos—otherwise teamwork becomes noise.”
- Why stronger: “Adds conditional claim + tradeoff handling; judges read this as outround-level depth.”

---

## 9) Delivery metrics coaching (NOT scored)

### What to include
- Snapshot: wpm, fillerPerMin, durationText, wordCount, pausesPerMin (optional)
- 1 drill with measurable goal

#### Example
- Drill: “Pause Mapping”
- Steps:
  1) Mark 3 planned pauses (after thesis, after example 1, before closer)
  2) Re-record once focusing on silence
  3) Compare fillerPerMin before/after
- Goal: “Reduce fillers/min by ≥20% and add ≥3 intentional pauses by next session.”

---

## 10) Next-round checklist (tight, measurable)

### Must include
- `nextRoundChecklist`: exactly 3 steps, each with measurable successCriteria
- `warmup5Min`: exactly 3 bullets
- `duringSpeechCues`: exactly 2 bullets
- `postRoundReview`: exactly 3 bullets

#### Example checklist (3)
1) “Add tradeoff+resolution to each example.” Success: “3/3 examples contain both lines.”
2) “Add mechanism word per point (specialization/error-correction/incentives).” Success: “3 mechanism lines present.”
3) “Deliver conditional verdict closer with pauses.” Success: “1 clean closer take + 2-second pause before/after.”

---

## 11) New JSON output (championship-v1)

**The model must output exactly one JSON object matching the keys defined in** `docs/judging/championship-schema.md`.

Minimum required top-level keys:
- version, meta, classification
- speechRecord (full transcript)
- speechStats (trusted metrics)
- scoring (3-category only)
- rfd
- evidence
- levers
- microRewrites
- deliveryMetricsCoaching
- actionPlan
- warnings

---

## 12) Implementation expectations (what Cursor must change)

### Backend
- Add a new output mode: `format=championship-v1`.
- Use the championship judge prompt (from `docs/judging/championship-judge-prompt.md`).
- Parse JSON strictly and validate.
- Server recomputes weighted totals and enforces caps.
- Always return a complete result object (even if capped or LLM skipped).

### Frontend/PDF
- Add a new renderer for championship-v1.
- Transcript is shown first (collapsible).
- Evidence/levers/micro-rewrites are formatted clearly.
- Delivery metrics are shown as non-scored.
- Never crash on missing/optional values.

---

## 13) Full examples (to verify formatting)

### A) Normal round (mini sample outline)
- Transcript (full)
- Overall 8.0; subscores 8.3/7.4/8.1
- RFD 10–16 sentences
- Evidence 12–20 (mix Strength/Gaps)
- Levers 3–5
- MicroRewrites 2–4
- Delivery snapshot + drill
- Checklist 3 steps

### B) Off-topic round (mini sample outline)
- classification.off_topic, maxOverallScore=2.5
- RFD focuses on why it’s off-topic, how to fix
- 1–2 levers: “Answer the quote directly”, “Build 2-point structure”

---

## 14) Definition of success
- Users say: “I understand exactly why I scored this way.”
- Users can point to: “Here are my top 3 levers and the scripts/drills to fix them.”
- Evidence is verifiable: quotes match transcript; metrics match computed stats.
- Edge cases never stall the UI: capped speeches still render a finished ballot.

