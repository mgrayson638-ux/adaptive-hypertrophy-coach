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
    "progressionNotes": string — a 2-4 sentence coach's note that explicitly references what
      the lifter did the prior week and why this week's prescription follows from it. Call
      out any plateau-busting changes by name (e.g. "Swapped flat bench for incline DB press
      because flat bench reps stalled at 185x8 for two weeks").
  }
- Days must be Monday/Tuesday/Thursday/Friday in that order. Titles: Upper Body, Lower Body,
  Push Day, Pull Day. Use the same titles for consistency with the renderer.
- The \`id\` must be ONE literal JSON string of 8-12 random lowercase letters and digits
  (example: "k7m2x9q4a3"). Do NOT use the + operator, string concatenation, variables, or
  any expression anywhere in the JSON — every value must be a plain literal. \`createdAt\`
  must be a single literal ISO-8601 timestamp string (example: "2026-05-20T12:00:00.000Z").
- Reflect \`weekNumber\` from the request unchanged.`;

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
  const userMessage = `Design a training week for this lifter. Return ONLY a valid JSON object — no prose, no code fences.\n\n${JSON.stringify(payload)}`;

  const messages: Array<{ role: string; content: string }> = [
    { role: 'user', content: userMessage },
  ];

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
      return jsonResponse(first.json, 200, cors);
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

    return jsonResponse(retry.json, 200, cors);
    // (retry.parseError is null here, so retry.json is valid parsed JSON)
  },
};
