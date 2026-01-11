# WinBallot Championship Schema (v1)

## Scoring policy (credible today)
Overall score is based ONLY on:
- Argument & Structure (0.45)
- Depth & Weighing (0.35)
- Rhetoric & Language (0.20)

Not scored:
- Body language (excluded)
- Tone (excluded)
- Delivery subjective judging (excluded)

Delivery is metrics-only:
- wpm, fillerPerMin, duration, wordCount (and pausesPerMin if available)

## Classification + caps
label ∈ normal | too_short | nonsense | off_topic | mostly_off_topic
Caps:
- too_short/nonsense/off_topic => maxOverallScore = 2.5
- mostly_off_topic => maxOverallScore = 6.0

## Required output structure (UI/PDF order)
1) Transcript (full)
2) Score Summary (overall + 3 subscores)
3) RFD (10–16 sentences normal; 6–10 capped)
4) Evidence receipts (Strength vs Gap)
5) Ranked Levers (3–5 normal; 1–2 capped)
6) Micro-rewrites (2–4 normal; 0–1 capped)
7) Metrics-only delivery coaching (not scored)
8) Next-round checklist (3 items)

## Required JSON (championship-v1)
PASTE THE JSON SHAPE HERE (the full object skeleton with keys)
