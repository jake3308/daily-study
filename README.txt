Study Site v8.2 — fast/stable generation patch

What changed
- Keeps GPT-5.6 Sol.
- TOEIC generation: Sol + Medium reasoning.
- Civil law / Physics / Chemistry / Biology: Sol + High reasoning.
- TOEIC and exam-core are generated in parallel to reduce waiting time.
- TOEIC answers are now generated as A/B/C/D labels, then safely converted to numeric indices.
  This removes the 'TOEIC Part 6 정답 인덱스가 잘못되었습니다' failure mode.
- TOEIC passages are output once per part instead of copied into every question, reducing tokens.
- Civil-law notes are NOT sent to the TOEIC request, reducing latency and token usage.
- No automatic retries. A retry only happens when you press the retry button.

Install
1. Replace only: api/generate-day.js
2. Commit to GitHub.
3. Wait for Vercel deployment to be Ready.
4. Hard-refresh the study site (Ctrl+F5).

No Supabase SQL changes.
No Vercel environment-variable changes.
No frontend changes.
