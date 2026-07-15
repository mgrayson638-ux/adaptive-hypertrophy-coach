export interface Env {
  ANTHROPIC_API_KEY: string;
  MODEL?: string;
  ALLOWED_ORIGIN?: string;
  // TODO: add for rate limiting → RATE_LIMIT_KV: KVNamespace;
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
6. Honor \`settings.intensityTechnique\`, the lifter's chosen set style:
   - \`standard\`: straight sets only. Do NOT add drop sets, rest-pause, or tempo work,
     EXCEPT where principle 1 calls for a plateau-busting technique or principle 3
     specifies one for week 3.
   - \`dropsets\`: prescribe a drop set on the final set of each day's main compound lift.
   - \`restpause\`: prescribe rest-pause on the final set of each day's main compound lift.
   - \`tempo\`: prescribe a controlled tempo (e.g. 3-1-2-0) on the primary compound lifts.
   - \`mixed\`: vary the technique across days and exercises (some drop sets, some
     rest-pause, some tempo) so no two days feel identical.
   Whenever a technique applies to an exercise, state it explicitly in that exercise's
   \`focus\` text so the lifter knows to do it.
7. Form cues. Each exercise's \`focus\` field should be a 1-2 sentence cue that is specific
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
    "progressionNotes": string — a 2-4 sentence coach's note that explicitly references the
      prior week and why this week's prescription follows from it. If the lifter logged
      volume, reference what they did; if they logged little or nothing, reference the prior
      week's PRESCRIBED selection from \`previousWorkouts\` instead (e.g. "Last week prescribed
      flat barbell bench in the Push primary slot, so this week rotates to incline dumbbell
      press to vary the stimulus"). Call out any plateau-busting or rotation changes by name.
  }
- Days must be Monday/Tuesday/Thursday/Friday in that order. Titles: Upper Body, Lower Body,
  Push Day, Pull Day. Use the same titles for consistency with the renderer.
- The \`id\` must be ONE literal JSON string of 8-12 random lowercase letters and digits
  (example: "k7m2x9q4a3"). Do NOT use the + operator, string concatenation, variables, or
  any expression anywhere in the JSON — every value must be a plain literal. \`createdAt\`
  must be a single literal ISO-8601 timestamp string (example: "2026-05-20T12:00:00.000Z").
- Reflect \`weekNumber\` from the request unchanged.`;

// ─── Variety enforcement ───────────────────────────────────────────────────────
// The system prompt asks the model to rotate exercises, but prompts drift.
// This programmatically verifies the generated week against `previousWorkouts`
// from the request body, so variety is guaranteed rather than requested.

interface VarietyResult {
  violations: string[];
  slotRepeats: number; // exact same exercise in the same day+slot as last week
  lastWeekOverlap: number; // generated exercises that appeared anywhere last week
  totalSlots: number;
}

/** Flattens a generated day's exercises (regular + superset) to names in slot order. */
function flattenGeneratedDay(day: Record<string, unknown>): string[] {
  const names: string[] = [];
  for (const item of (day.exercises as Array<Record<string, unknown>>) ?? []) {
    if (item && item.type === 'superset') {
      for (const sub of (item.exercises as Array<Record<string, unknown>>) ?? []) {
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
function checkVariety(candidate: unknown, requestBody: unknown): VarietyResult | null {
  const body = requestBody as Record<string, unknown> | null;
  const prevRaw = body?.previousWorkouts;
  if (!Array.isArray(prevRaw) || prevRaw.length === 0) return null;
  const w = candidate as Record<string, unknown>;
  if (!Array.isArray(w?.workout)) return null;

  // name -> movementPattern, and pattern -> option count, from the filtered DB.
  const patternOf = new Map<string, string>();
  const patternCount = new Map<string, number>();
  const db = (body?.exerciseDatabase ?? {}) as Record<string, Record<string, unknown>>;
  for (const group of Object.values(db)) {
    for (const arr of Object.values(group ?? {})) {
      if (!Array.isArray(arr)) continue;
      for (const ex of arr as Array<Record<string, unknown>>) {
        if (typeof ex?.name !== 'string' || typeof ex?.movementPattern !== 'string') continue;
        patternOf.set(ex.name, ex.movementPattern);
        patternCount.set(ex.movementPattern, (patternCount.get(ex.movementPattern) ?? 0) + 1);
      }
    }
  }
  const alternativesFor = (name: string): number => {
    const p = patternOf.get(name);
    return p ? (patternCount.get(p) ?? 1) : 1;
  };

  const prev = [...prevRaw].sort(
    (a, b) => ((a as Record<string, unknown>).weekNumber as number ?? 0) - ((b as Record<string, unknown>).weekNumber as number ?? 0),
  ) as Array<Record<string, unknown>>;
  const lastWeek = prev[prev.length - 1];
  const lastWeekDays = (lastWeek.days ?? []) as Array<Record<string, unknown>>;
  const lastWeekNames = new Set<string>(
    lastWeekDays.flatMap((d) => (d.exercises as string[]) ?? []),
  );
  // Which previous weeks used a given exercise (for window-reuse reporting).
  const weeksUsing = (name: string): number[] =>
    prev
      .filter((pw) => ((pw.days ?? []) as Array<Record<string, unknown>>)
        .some((d) => ((d.exercises as string[]) ?? []).includes(name)))
      .map((pw) => (pw.weekNumber as number) ?? 0);

  const violations: string[] = [];
  const flagged = new Set<string>();
  let slotRepeats = 0;
  let lastWeekOverlap = 0;
  let totalSlots = 0;

  const days = w.workout as Array<Record<string, unknown>>;
  for (let i = 0; i < days.length; i++) {
    const names = flattenGeneratedDay(days[i]);
    const prevDay =
      lastWeekDays.find((d) => d.dayName === days[i].dayName) ?? lastWeekDays[i];
    const prevNames = ((prevDay?.exercises as string[]) ?? []);

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
function validateWorkout(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return 'Response is not a JSON object';
  const w = obj as Record<string, unknown>;

  if (typeof w.id !== 'string') return 'Missing or non-string "id"';
  if (typeof w.name !== 'string') return 'Missing or non-string "name"';
  if (typeof w.createdAt !== 'string') return 'Missing or non-string "createdAt"';
  if (typeof w.weekNumber !== 'number') return 'Missing or non-number "weekNumber"';
  if (!w.settings || typeof w.settings !== 'object') return 'Missing or invalid "settings"';
  if (typeof w.progressionNotes !== 'string') return 'Missing or non-string "progressionNotes"';

  if (!Array.isArray(w.workout)) return '"workout" must be an array';
  if (w.workout.length !== 4) return `"workout" must have exactly 4 days (got ${w.workout.length})`;

  const validDayNames = ['Monday', 'Tuesday', 'Thursday', 'Friday'];
  for (let i = 0; i < 4; i++) {
    const day = w.workout[i] as Record<string, unknown>;
    if (!day || typeof day !== 'object') return `Day ${i} is not an object`;
    if (!validDayNames.includes(day.dayName as string))
      return `Day ${i} has invalid dayName "${day.dayName}" (expected ${validDayNames[i]})`;
    if (typeof day.title !== 'string') return `Day ${i} missing "title"`;
    if (typeof day.emphasis !== 'string') return `Day ${i} missing "emphasis"`;
    if (typeof day.estimatedDuration !== 'string') return `Day ${i} missing "estimatedDuration"`;
    if (!Array.isArray(day.exercises)) return `Day ${i} "exercises" must be an array`;

    for (let j = 0; j < (day.exercises as unknown[]).length; j++) {
      const ex = (day.exercises as unknown[])[j] as Record<string, unknown>;
      if (!ex || typeof ex !== 'object') return `Day ${i}, exercise ${j} is not an object`;

      if (ex.type === 'superset') {
        if (typeof ex.supersetLabel !== 'string') return `Day ${i}, superset ${j} missing "supersetLabel"`;
        if (typeof ex.rest !== 'number') return `Day ${i}, superset ${j} missing "rest"`;
        if (typeof ex.estimatedDuration !== 'string') return `Day ${i}, superset ${j} missing "estimatedDuration"`;
        if (!Array.isArray(ex.exercises)) return `Day ${i}, superset ${j} "exercises" must be an array`;
        if ((ex.exercises as unknown[]).length < 2)
          return `Day ${i}, superset ${j} needs at least 2 exercises`;

        for (let k = 0; k < (ex.exercises as unknown[]).length; k++) {
          const sub = (ex.exercises as unknown[])[k] as Record<string, unknown>;
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

interface ClaudeResult {
  json: unknown;
  rawText: string;
  parseError: string | null;
}

async function callClaude(
  apiKey: string,
  model: string,
  payload: unknown,
  retry?: { priorText: string; validationError: string },
): Promise<ClaudeResult> {
  // Split the payload so the large, stable exerciseDatabase leads its own content
  // block and the volatile per-request lifter data follows. The cache_control
  // breakpoint caches the system prompt + DB prefix (byte-identical for a given
  // equipmentPref), so repeat generations — and the variety retries below, which
  // append turns *after* this block — reuse it instead of re-billing full input.
  const body = (payload ?? {}) as Record<string, unknown>;
  const { exerciseDatabase, ...lifter } = body;

  type Block = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };
  const firstUser: Block[] = [
    {
      type: 'text',
      text:
        `Design a training week for this lifter. Return ONLY a valid JSON object — no prose, no code fences.\n\n` +
        `exerciseDatabase (already filtered to the lifter's equipment preference):\n` +
        JSON.stringify(exerciseDatabase ?? {}),
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text:
        `Lifter request data (previousWorkouts, recentLogs, exerciseProgress, settings, weekNumber):\n` +
        JSON.stringify(lifter),
    },
  ];

  const messages: Array<{ role: string; content: string | Block[] }> = [
    { role: 'user', content: firstUser },
  ];

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
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: 16000, system: SYSTEM_PROMPT, messages }),
  });

  if (!resp.ok) {
    // Log the upstream body server-side for debugging (never returned to the client)
    const errBody = await resp.text().catch(() => '');
    console.error(`[callClaude] Anthropic HTTP ${resp.status}: ${errBody}`);
    throw new Error(`Anthropic returned HTTP ${resp.status}`);
  }

  const data = (await resp.json()) as {
    content: Array<{ type: string; text: string }>;
    stop_reason?: string;
  };
  const rawText = (data.content[0]?.text ?? '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  if (data.stop_reason === 'max_tokens') {
    console.error('[callClaude] Response hit max_tokens — output was truncated');
  }

  try {
    const json = JSON.parse(rawText);
    return { json, rawText, parseError: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[callClaude] JSON.parse failed. stop_reason=${data.stop_reason}, ` +
      `rawText length=${rawText.length}, error: ${msg}`,
    );
    // Not thrown — returned so the caller can retry with feedback.
    return { json: null, rawText, parseError: `Response was not valid JSON: ${msg}` };
  }
}

// ─── CORS helpers ─────────────────────────────────────────────────────────────

function corsHeaders(request: Request, allowedOrigin: string): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const ao = allowedOrigin === '*' ? '*' : (origin === allowedOrigin ? origin : '');
  return {
    'Access-Control-Allow-Origin': ao,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// ─── Worker entry point ───────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env.ALLOWED_ORIGIN ?? '*');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname !== '/generate-workout') {
      return new Response('Not Found', { status: 404, headers: cors });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: cors });
    }

    // TODO: per-IP rate limiting using RATE_LIMIT_KV Durable Object
    // const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Request body must be valid JSON.' }, 400, cors);
    }

    const model = env.MODEL ?? 'claude-sonnet-4-6';

    // ── First attempt ──────────────────────────────────────────────────────────
    let first: ClaudeResult;
    try {
      first = await callClaude(env.ANTHROPIC_API_KEY, model, body);
    } catch (e) {
      console.error('[worker] First Claude call failed:', e instanceof Error ? e.message : e);
      return jsonResponse({ error: 'Coach is temporarily unavailable. Please try again.' }, 502, cors);
    }

    // A "problem" is either a JSON parse failure or a schema validation failure.
    const firstProblem = first.parseError ?? validateWorkout(first.json);

    if (!firstProblem) {
      // Schema is fine — now enforce exercise variety programmatically.
      const variety = checkVariety(first.json, body);
      if (variety) {
        console.log(
          `[variety] first attempt: ${variety.lastWeekOverlap}/${variety.totalSlots} exercises ` +
          `overlap last week, ${variety.slotRepeats} exact slot repeats, ` +
          `${variety.violations.length} violations`,
        );
      }
      if (!variety || variety.violations.length === 0) {
        return jsonResponse(first.json, 200, cors);
      }

      // ── Variety retry: regenerate with the specific repeats called out ──────
      const feedback =
        `The workout violates the stimulus-variety rules (principle #2, a HARD requirement):\n` +
        variety.violations.map((v) => `- ${v}`).join('\n') +
        `\nRegenerate the week keeping the schema, periodization, and volume intact, ` +
        `replacing ONLY the flagged exercises with different same-movement-pattern ` +
        `options from exerciseDatabase that do not appear in previousWorkouts.`;

      let varietyRetry: ClaudeResult;
      try {
        varietyRetry = await callClaude(env.ANTHROPIC_API_KEY, model, body, {
          priorText: first.rawText,
          validationError: feedback,
        });
      } catch (e) {
        // The first result was schema-valid; better stale variety than an error.
        console.error('[worker] Variety retry call failed, returning first attempt:', e instanceof Error ? e.message : e);
        return jsonResponse(first.json, 200, cors);
      }

      const retrySchemaProblem = varietyRetry.parseError ?? validateWorkout(varietyRetry.json);
      if (retrySchemaProblem) {
        console.error('[worker] Variety retry failed schema, returning first attempt:', retrySchemaProblem);
        return jsonResponse(first.json, 200, cors);
      }

      const retryVariety = checkVariety(varietyRetry.json, body);
      console.log(
        `[variety] retry: ${retryVariety?.lastWeekOverlap ?? 0}/${retryVariety?.totalSlots ?? 0} overlap last week, ` +
        `${retryVariety?.violations.length ?? 0} violations remain` +
        (retryVariety && retryVariety.violations.length > 0
          ? ` — accepting anyway: ${retryVariety.violations.join(' | ')}`
          : ''),
      );
      return jsonResponse(varietyRetry.json, 200, cors);
    }

    console.error('[worker] First attempt problem:', firstProblem);

    // ── Retry with feedback (covers both parse errors and schema errors) ───────
    let retry: ClaudeResult;
    try {
      retry = await callClaude(env.ANTHROPIC_API_KEY, model, body, {
        priorText: first.rawText,
        validationError: firstProblem,
      });
    } catch (e) {
      console.error('[worker] Retry Claude call failed:', e instanceof Error ? e.message : e);
      return jsonResponse({ error: 'Coach is temporarily unavailable. Please try again.' }, 502, cors);
    }

    const retryProblem = retry.parseError ?? validateWorkout(retry.json);
    if (retryProblem) {
      console.error('[worker] Retry attempt also failed:', retryProblem);
      return jsonResponse({ error: 'Coach returned an invalid workout plan. Please try again.' }, 502, cors);
    }

    const retryVariety = checkVariety(retry.json, body);
    if (retryVariety) {
      console.log(
        `[variety] schema-retry result: ${retryVariety.lastWeekOverlap}/${retryVariety.totalSlots} overlap last week, ` +
        `${retryVariety.violations.length} violations` +
        (retryVariety.violations.length > 0 ? ' — accepting (retry budget spent)' : ''),
      );
    }
    return jsonResponse(retry.json, 200, cors);
    // (retry.parseError is null here, so retry.json is valid parsed JSON)
  },
};
