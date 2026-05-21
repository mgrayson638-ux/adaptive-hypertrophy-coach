import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';

config();

const PORT = process.env.PORT ?? 3001;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';
const MODEL = process.env.MODEL ?? 'claude-sonnet-4-6';
const API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

if (!API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

// ─── System prompt (verbatim from spec) ───────────────────────────────────────

const SYSTEM_PROMPT = `You are an elite evidence-based hypertrophy coach. Your single job is to design ONE upcoming
training week for a lifter who already has weeks of logged history, and to do so in a way
that maximizes muscle growth and explicitly avoids plateaus.

Use these principles, in order of priority:
1. Progressive overload, autoregulated. Read the lifter's \`exerciseProgress\` and \`recentLogs\`.
   For exercises where weight or reps have moved up over the last 2-3 sessions, prescribe a
   small load or rep increase (roughly +2.5-5% load OR +1 rep). For exercises that have
   stalled across 2+ sessions at the same load and rep count, treat that as a plateau signal
   and respond with one of: (a) swap the exercise for a biomechanically similar variation
   from \`exerciseDatabase\`, (b) change the rep range bracket (e.g. 8-12 -> 5-8 or 12-15),
   (c) introduce an intensity technique (drop set, rest-pause, tempo) on the final set.
   Pick the response that best fits where the lifter is in the mesocycle (see #3).
2. Stimulus variety to prevent staleness. Across a 4-week mesocycle the lifter should not
   see the exact same exercise selection twice in the same slot. Use \`recentLogs\` to see
   what has been used recently and rotate within the same movement pattern (e.g. flat
   barbell bench -> incline dumbbell press; barbell row -> chest-supported dumbbell row).
   Stay within the provided \`exerciseDatabase\` — do not invent exercises.
3. Periodization. Treat \`weekNumber % 4\` as the position in a 4-week mesocycle:
   - Week 1: moderate volume, RIR 2-3, introduce the block's exercises.
   - Week 2: add a set to two priority muscle groups, RIR 1-2.
   - Week 3: peak volume / intensity, RIR 0-1, intensity technique on final compound set.
   - Week 4 (deload): cut working sets ~40-50%, RIR 3-4, keep movement patterns.
   If the user just hit a deload, the next week resets to Week 1 of the new block with
   slightly different exercise selection than the prior block.
4. Volume & fatigue management. Respect \`settings.maxDuration\` (in minutes) — estimate
   ~3 minutes per straight set including rest, ~2 minutes per superset round. Aim for
   10-20 working sets per major muscle per week (across the days that train it). Place
   compounds before isolations within a day.
5. Specificity to \`settings.focusArea\` and \`settings.equipmentPref\`. If \`equipmentPref\` is
   \`barbell\`, only pick exercises with \`equipment\` in {barbell, bodyweight}; \`dumbbell\` ->
   {dumbbell, bodyweight}; \`cables\` -> {cable, machine}; \`full\` -> any. The \`focusArea\`
   gets +1 set on its priority lifts.
6. Form cues. Each exercise's \`focus\` field should be a 1-2 sentence cue that is specific
   to that lift, not generic. Reuse the cue from \`exerciseDatabase\` if it is good; refine
   it if the lifter's recent logs suggest a specific issue (e.g. reps dropping sharply set
   to set -> add a pacing cue).

Output rules:
- Return ONLY a JSON object. No prose, no code fences, no commentary.
- The JSON must match this schema exactly:
  {
    "id": string,
    "name": string,
    "createdAt": ISO-8601 string,
    "weekNumber": integer,
    "settings": { same object you received },
    "workout": [
      { "dayName": "Monday"|"Tuesday"|"Thursday"|"Friday",
        "title": string,
        "emphasis": string,
        "exercises": [
          { "name": string from exerciseDatabase, "equipment": same as in db, "focus": string, "alternative": string from db, "sets": integer, "reps": string like "8-12", "rest": integer seconds }
          OR
          { "type": "superset", "supersetLabel": string, "rest": integer, "estimatedDuration": string, "exercises": [ {name, equipment, focus, alternative, sets, reps}, {name, equipment, focus, alternative, sets, reps} ] }
        ],
        "estimatedDuration": string like "~40-45 minutes"
      },
      ... exactly 4 days ...
    ],
    "progressionNotes": string — a 2-4 sentence coach's note that explicitly references what
      the lifter did the prior week and why this week's prescription follows from it. Call
      out any plateau-busting changes by name (e.g. "Swapped flat bench for incline DB press
      because flat bench reps stalled at 185x8 for two weeks").
  }
- Days must be Monday/Tuesday/Thursday/Friday in that order. Titles: Upper Body, Lower Body,
  Push Day, Pull Day. Use the same titles for consistency with the renderer.
- Generate the \`id\` as a short random string (timestamp+random is fine). \`createdAt\` is now.
- Reflect \`weekNumber\` from the request unchanged.`;

// ─── Validation ───────────────────────────────────────────────────────────────

/** Returns null if valid, or a human-readable error string. */
function validateWorkout(obj) {
  if (!obj || typeof obj !== 'object') return 'Response is not a JSON object';
  if (typeof obj.id !== 'string') return 'Missing or non-string "id"';
  if (typeof obj.name !== 'string') return 'Missing or non-string "name"';
  if (typeof obj.createdAt !== 'string') return 'Missing or non-string "createdAt"';
  if (typeof obj.weekNumber !== 'number') return 'Missing or non-number "weekNumber"';
  if (!obj.settings || typeof obj.settings !== 'object') return 'Missing or invalid "settings"';
  if (typeof obj.progressionNotes !== 'string') return 'Missing or non-string "progressionNotes"';

  if (!Array.isArray(obj.workout)) return '"workout" must be an array';
  if (obj.workout.length !== 4) return `"workout" must have exactly 4 days (got ${obj.workout.length})`;

  const validDayNames = ['Monday', 'Tuesday', 'Thursday', 'Friday'];
  for (let i = 0; i < 4; i++) {
    const day = obj.workout[i];
    if (!day || typeof day !== 'object') return `Day ${i} is not an object`;
    if (!validDayNames.includes(day.dayName))
      return `Day ${i} has invalid dayName "${day.dayName}" (expected ${validDayNames[i]})`;
    if (typeof day.title !== 'string') return `Day ${i} missing "title"`;
    if (typeof day.emphasis !== 'string') return `Day ${i} missing "emphasis"`;
    if (typeof day.estimatedDuration !== 'string') return `Day ${i} missing "estimatedDuration"`;
    if (!Array.isArray(day.exercises)) return `Day ${i} "exercises" must be an array`;

    for (let j = 0; j < day.exercises.length; j++) {
      const ex = day.exercises[j];
      if (!ex || typeof ex !== 'object') return `Day ${i}, exercise ${j} is not an object`;

      if (ex.type === 'superset') {
        if (typeof ex.supersetLabel !== 'string') return `Day ${i}, superset ${j} missing "supersetLabel"`;
        if (typeof ex.rest !== 'number') return `Day ${i}, superset ${j} missing "rest"`;
        if (typeof ex.estimatedDuration !== 'string') return `Day ${i}, superset ${j} missing "estimatedDuration"`;
        if (!Array.isArray(ex.exercises)) return `Day ${i}, superset ${j} "exercises" must be array`;
        if (ex.exercises.length < 2) return `Day ${i}, superset ${j} needs at least 2 exercises`;
        for (let k = 0; k < ex.exercises.length; k++) {
          const sub = ex.exercises[k];
          if (typeof sub.name !== 'string') return `Day ${i}, superset ${j}, sub-ex ${k} missing "name"`;
          if (typeof sub.sets !== 'number') return `Day ${i}, superset ${j}, sub-ex ${k} missing "sets"`;
          if (typeof sub.reps !== 'string') return `Day ${i}, superset ${j}, sub-ex ${k} missing "reps"`;
        }
      } else {
        if (typeof ex.name !== 'string') return `Day ${i}, exercise ${j} missing "name"`;
        if (typeof ex.sets !== 'number') return `Day ${i}, exercise ${j} missing "sets"`;
        if (typeof ex.reps !== 'string') return `Day ${i}, exercise ${j} missing "reps"`;
        if (typeof ex.rest !== 'number') return `Day ${i}, exercise ${j} missing "rest"`;
      }
    }
  }
  return null;
}

// ─── Claude call ─────────────────────────────────────────────────────────────

async function callClaude(payload, retry) {
  const userMessage =
    `Design a training week for this lifter. Return ONLY a valid JSON object — no prose, no code fences.\n\n` +
    JSON.stringify(payload);

  const messages = [{ role: 'user', content: userMessage }];

  if (retry) {
    messages.push({ role: 'assistant', content: retry.priorText });
    messages.push({
      role: 'user',
      content:
        `Your previous response failed schema validation with this error: ${retry.validationError}\n\n` +
        `Please return ONLY a valid JSON object that exactly matches the schema in the system prompt. ` +
        `No code fences, no prose, no commentary.`,
    });
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 4096, system: SYSTEM_PROMPT, messages }),
  });

  if (!resp.ok) {
    throw new Error(`Anthropic returned HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const rawText = (data.content[0]?.text ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  const json = JSON.parse(rawText);
  return { json, rawText };
}

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN, methods: ['POST'] }));

app.post('/generate-workout', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Request body must be valid JSON.' });
  }

  let first;
  try {
    first = await callClaude(body);
  } catch {
    return res.status(502).json({ error: 'Coach is temporarily unavailable. Please try again.' });
  }

  const firstError = validateWorkout(first.json);
  if (!firstError) return res.json(first.json);

  let retry;
  try {
    retry = await callClaude(body, { priorText: first.rawText, validationError: firstError });
  } catch {
    return res.status(502).json({ error: 'Coach is temporarily unavailable. Please try again.' });
  }

  const retryError = validateWorkout(retry.json);
  if (retryError) {
    return res.status(502).json({ error: 'Coach returned an invalid workout plan. Please try again.' });
  }

  res.json(retry.json);
});

app.listen(PORT, () => {
  console.log(`Hypertrophy coach proxy running → http://localhost:${PORT}`);
  console.log(`POST http://localhost:${PORT}/generate-workout`);
});
