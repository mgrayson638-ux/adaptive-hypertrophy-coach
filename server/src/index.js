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
2. Stimulus variety to prevent staleness — THIS IS A HARD REQUIREMENT, not a preference.
   The \`previousWorkouts\` array is the authoritative record of what you PRESCRIBED in
   recent weeks (ordered oldest -> newest by \`weekNumber\`; each day lists its exercises
   in slot order). Use it as your PRIMARY look-back signal: it is reliable even when the
   lifter logged little or no volume, because it reflects the prescription itself, not
   their logging. Apply these rules:
   - For every slot, the exercise you choose MUST differ from the exercise in the same
     slot of the most recent previous week (the last entry in \`previousWorkouts\`).
   - Do not reuse the same exercise in the same movement-pattern slot more than once
     across the weeks present in \`previousWorkouts\`, UNLESS the \`exerciseDatabase\` offers
     no other valid option for that slot under the current \`equipmentPref\` (some slots,
     e.g. quad isolation, may have only one entry — in that case repetition is allowed).
   - Rotate within the same movement pattern (e.g. flat barbell bench -> incline dumbbell
     press; barbell row -> chest-supported dumbbell row).
   - \`recentLogs\` and \`exerciseProgress\` remain SECONDARY signals for HOW the lifter
     performed; \`previousWorkouts\` is the source of truth for WHAT was prescribed.
   If \`previousWorkouts\` is empty (first week), select freely.
   Each exercise in \`exerciseDatabase\` carries \`movementPattern\` (e.g. horizontalPush,
   verticalPull, hipHinge, lateralRaise), \`primaryMuscle\`, \`secondaryMuscles\`,
   \`unilateral\`, and \`equipment\`. Use \`movementPattern\` to identify valid same-pattern
   rotations within a slot, and \`primaryMuscle\` to track weekly volume per muscle. The
   \`exerciseDatabase\` you receive is ALREADY filtered to the lifter's equipment preference,
   so every exercise in it is fair game. Stay within it — do not invent exercises.
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
7. Core & abs — REQUIRED. \`exerciseDatabase\` includes a \`core\` category (\`core.exercises\`)
   of direct abdominal and oblique work, each tagged with a \`movementPattern\` of coreFlexion,
   coreRotation, coreAntiExtension, or coreStability. End EVERY one of the 4 days with exactly
   one core exercise as a short finisher, appended as the LAST entry in that day's \`exercises\`
   array (a normal exercise object, not a superset). Prescribe holds and loaded carries
   (coreAntiExtension, coreStability) for time — 3 sets, \`reps\` of "30-45 sec"; prescribe
   everything else for reps — 3 sets, \`reps\` of "12-20". Rotate the core pick using the same
   variety rules as principle 2: it MUST differ from that day's core finisher in the most
   recent previous week, and vary the \`movementPattern\` across the four days and across the
   look-back window. Keep it brief so the session still respects \`settings.maxDuration\`.

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
    "progressionNotes": string — a 2-4 sentence coach's note that explicitly references the
      prior week and why this week's prescription follows from it. If the lifter logged
      volume, reference what they did; if they logged little or nothing, reference the prior
      week's PRESCRIBED selection from \`previousWorkouts\` instead (e.g. "Last week prescribed
      flat barbell bench in the Push primary slot, so this week rotates to incline dumbbell
      press to vary the stimulus"). Call out any plateau-busting or rotation changes by name.
  }
- Days must be Monday/Tuesday/Thursday/Friday in that order. Titles: Upper Body, Lower Body,
  Push Day, Pull Day. Use the same titles for consistency with the renderer.
- Generate the \`id\` as a short random string (timestamp+random is fine). \`createdAt\` is now.
- Reflect \`weekNumber\` from the request unchanged.`;

// ─── Variety enforcement ───────────────────────────────────────────────────────
// The system prompt asks the model to rotate exercises, but prompts drift.
// This programmatically verifies the generated week against `previousWorkouts`
// from the request body, so variety is guaranteed rather than requested.

/** Flattens a generated day's exercises (regular + superset) to names in slot order. */
export function flattenGeneratedDay(day) {
  const names = [];
  for (const item of day?.exercises ?? []) {
    if (item && item.type === 'superset') {
      for (const sub of item.exercises ?? []) {
        if (sub && typeof sub.name === 'string') names.push(sub.name);
      }
    } else if (item && typeof item.name === 'string') {
      names.push(item.name);
    }
  }
  return names;
}

/**
 * Checks the candidate workout against the prescription history in the request.
 * Rules mirror system-prompt principle #2:
 *  - an exercise must not occupy the same day+slot it had last week, and
 *  - an exercise should not reappear anywhere within the look-back window,
 * in both cases ONLY when the (already equipment-filtered) exerciseDatabase
 * offers enough same-movement-pattern alternatives to avoid the repeat.
 * Returns null when there is nothing to check.
 */
export function checkVariety(candidate, requestBody) {
  const prevRaw = requestBody?.previousWorkouts;
  if (!Array.isArray(prevRaw) || prevRaw.length === 0) return null;
  if (!Array.isArray(candidate?.workout)) return null;

  // name -> movementPattern, and pattern -> option count, from the filtered DB.
  const patternOf = new Map();
  const patternCount = new Map();
  for (const group of Object.values(requestBody?.exerciseDatabase ?? {})) {
    for (const arr of Object.values(group ?? {})) {
      if (!Array.isArray(arr)) continue;
      for (const ex of arr) {
        if (typeof ex?.name !== 'string' || typeof ex?.movementPattern !== 'string') continue;
        patternOf.set(ex.name, ex.movementPattern);
        patternCount.set(ex.movementPattern, (patternCount.get(ex.movementPattern) ?? 0) + 1);
      }
    }
  }
  const alternativesFor = (name) => {
    const p = patternOf.get(name);
    return p ? (patternCount.get(p) ?? 1) : 1;
  };

  const prev = [...prevRaw].sort((a, b) => (a.weekNumber ?? 0) - (b.weekNumber ?? 0));
  const lastWeek = prev[prev.length - 1];
  const lastWeekDays = lastWeek.days ?? [];
  const lastWeekNames = new Set(lastWeekDays.flatMap((d) => d.exercises ?? []));
  // Which previous weeks used a given exercise (for window-reuse reporting).
  const weeksUsing = (name) =>
    prev
      .filter((pw) => (pw.days ?? []).some((d) => (d.exercises ?? []).includes(name)))
      .map((pw) => pw.weekNumber ?? 0);

  const violations = [];
  const flagged = new Set();
  let slotRepeats = 0;
  let lastWeekOverlap = 0;
  let totalSlots = 0;

  const days = candidate.workout;
  for (let i = 0; i < days.length; i++) {
    const names = flattenGeneratedDay(days[i]);
    const prevDay = lastWeekDays.find((d) => d.dayName === days[i].dayName) ?? lastWeekDays[i];
    const prevNames = prevDay?.exercises ?? [];

    for (let j = 0; j < names.length; j++) {
      totalSlots++;
      const name = names[j];
      if (lastWeekNames.has(name)) lastWeekOverlap++;

      const alts = alternativesFor(name);
      const pattern = patternOf.get(name) ?? 'unknown pattern';

      // Rule A: same exercise in the same day+slot as the most recent week.
      if (prevNames[j] === name && alts >= 2 && !flagged.has(name)) {
        slotRepeats++;
        flagged.add(name);
        violations.push(
          `"${name}" (${days[i].dayName}, slot ${j + 1}) repeats last week's prescription in the same slot — ` +
          `replace it with a different ${pattern} exercise from exerciseDatabase.`,
        );
        continue;
      }

      // Rule B: reused anywhere within the look-back window while the pattern
      // pool is large enough that no repeat was necessary.
      const used = weeksUsing(name);
      if (used.length > 0 && alts > prev.length && !flagged.has(name)) {
        flagged.add(name);
        violations.push(
          `"${name}" (${days[i].dayName}) was already prescribed in week${used.length > 1 ? 's' : ''} ` +
          `${used.join(', ')} of the look-back window — rotate to another ${pattern} option.`,
        );
      }
    }
  }

  return { violations: violations.slice(0, 10), slotRepeats, lastWeekOverlap, totalSlots };
}

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
        `Your previous response failed validation:\n${retry.validationError}\n\n` +
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

  if (!firstError) {
    // Schema is fine — now enforce exercise variety programmatically.
    const variety = checkVariety(first.json, body);
    if (variety) {
      console.log(
        `[variety] first attempt: ${variety.lastWeekOverlap}/${variety.totalSlots} exercises ` +
        `overlap last week, ${variety.slotRepeats} exact slot repeats, ` +
        `${variety.violations.length} violations`,
      );
    }
    if (!variety || variety.violations.length === 0) return res.json(first.json);

    // ── Variety retry: regenerate with the specific repeats called out ────────
    const feedback =
      `The workout violates the stimulus-variety rules (principle #2, a HARD requirement):\n` +
      variety.violations.map((v) => `- ${v}`).join('\n') +
      `\nRegenerate the week keeping the schema, periodization, and volume intact, ` +
      `replacing ONLY the flagged exercises with different same-movement-pattern ` +
      `options from exerciseDatabase that do not appear in previousWorkouts.`;

    let varietyRetry;
    try {
      varietyRetry = await callClaude(body, { priorText: first.rawText, validationError: feedback });
    } catch (e) {
      // The first result was schema-valid; better stale variety than an error.
      console.error('[server] Variety retry call failed, returning first attempt:', e?.message ?? e);
      return res.json(first.json);
    }

    const retrySchemaError = validateWorkout(varietyRetry.json);
    if (retrySchemaError) {
      console.error('[server] Variety retry failed schema, returning first attempt:', retrySchemaError);
      return res.json(first.json);
    }

    const retryVariety = checkVariety(varietyRetry.json, body);
    console.log(
      `[variety] retry: ${retryVariety?.lastWeekOverlap ?? 0}/${retryVariety?.totalSlots ?? 0} overlap last week, ` +
      `${retryVariety?.violations.length ?? 0} violations remain` +
      (retryVariety && retryVariety.violations.length > 0
        ? ` — accepting anyway: ${retryVariety.violations.join(' | ')}`
        : ''),
    );
    return res.json(varietyRetry.json);
  }

  console.error('[server] First attempt problem:', firstError);

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

  const retryVariety = checkVariety(retry.json, body);
  if (retryVariety) {
    console.log(
      `[variety] schema-retry result: ${retryVariety.lastWeekOverlap}/${retryVariety.totalSlots} overlap last week, ` +
      `${retryVariety.violations.length} violations` +
      (retryVariety.violations.length > 0 ? ' — accepting (retry budget spent)' : ''),
    );
  }
  res.json(retry.json);
});

app.listen(PORT, () => {
  console.log(`Hypertrophy coach proxy running → http://localhost:${PORT}`);
  console.log(`POST http://localhost:${PORT}/generate-workout`);
});
