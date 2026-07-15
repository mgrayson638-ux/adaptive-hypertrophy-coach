/* Validates exercise-database.v2.js against the schema contract.
 * Usage: node validate-exercise-db.js
 * Exit code 0 = all checks pass, 1 = problems found. */

const { ExerciseDatabase } = require('./exercise-database.v2.js');

const EQUIPMENT = new Set(['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight']);
const PATTERNS = new Set([
  'horizontalPush', 'inclinePush', 'declinePush', 'verticalPush',
  'horizontalPull', 'verticalPull', 'squat', 'hipHinge', 'lunge',
  'chestFly', 'lateralRaise', 'frontRaise', 'rearDelt', 'shrug',
  'latIsolation', 'bicepCurl', 'tricepExtension', 'quadIsolation',
  'hamstringCurl', 'calfRaise',
  'coreFlexion', 'coreRotation', 'coreAntiExtension', 'coreStability'
]);
const MUSCLES = new Set([
  'chest', 'lats', 'upper-back', 'rear-delts', 'front-delts', 'side-delts',
  'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'calves',
  'abs', 'obliques'
]);

// The original 55 names that MUST still be present (back-compat).
const LEGACY = [
  'Flat Barbell Bench Press', 'Incline Barbell Press', 'Flat Dumbbell Press', 'Incline Dumbbell Press', 'Decline Push-ups', 'Machine Chest Press',
  'Incline Dumbbell Flyes', 'Cable Flyes (High to Low)', 'Cable Flyes (Low to High)', 'Pec Deck Machine',
  'Barbell Rows', 'T-Bar Rows', 'Pull-ups', 'Wide-Grip Lat Pulldowns', 'Close-Grip Lat Pulldowns', 'Neutral-Grip Lat Pulldowns', 'Seated Cable Rows', 'Single-Arm Dumbbell Rows',
  'Reverse Flyes', 'Face Pulls', 'Straight-Arm Pulldowns',
  'Overhead Press (Barbell)', 'Seated Dumbbell Shoulder Press', 'Arnold Press',
  'Seated Dumbbell Lateral Raises', 'Cable Lateral Raises', 'Front Raises',
  'Barbell Curls', 'Dumbbell Bicep Curls', 'Hammer Curls', 'Incline Dumbbell Curls', 'Preacher Curls', 'Cable Curls',
  'Close-Grip Bench Press', 'Tricep Pushdowns', 'Overhead Dumbbell Extension', 'Dumbbell Skullcrushers', 'Rope Pushdowns', 'Tricep Dips',
  'Barbell Back Squats', 'Front Squats', 'Goblet Squats', 'Leg Press', 'Hack Squats', 'Walking Lunges', 'Bulgarian Split Squats',
  'Leg Extensions',
  'Romanian Deadlifts (RDLs)', 'Good Mornings', 'Dumbbell RDLs',
  'Lying Leg Curls', 'Seated Leg Curls',
  'Standing Calf Raises', 'Seated Calf Raises', 'Leg Press Calf Raises'
];

const problems = [];
const all = [];

function eachExercise(cb) {
  for (const [group, sub] of Object.entries(ExerciseDatabase)) {
    for (const [cat, arr] of Object.entries(sub)) {
      arr.forEach((ex, i) => cb(ex, `${group}.${cat}[${i}]`));
    }
  }
}

// Collect + per-field checks
eachExercise((ex, loc) => {
  all.push(ex.name);
  const req = ['name', 'equipment', 'movementPattern', 'primaryMuscle', 'secondaryMuscles', 'unilateral', 'focus', 'alternative'];
  for (const f of req) if (!(f in ex)) problems.push(`${loc} (${ex.name||'?'}) missing field "${f}"`);
  if (!EQUIPMENT.has(ex.equipment)) problems.push(`${loc} (${ex.name}) bad equipment "${ex.equipment}"`);
  if (!PATTERNS.has(ex.movementPattern)) problems.push(`${loc} (${ex.name}) bad movementPattern "${ex.movementPattern}"`);
  if (!MUSCLES.has(ex.primaryMuscle)) problems.push(`${loc} (${ex.name}) bad primaryMuscle "${ex.primaryMuscle}"`);
  if (!Array.isArray(ex.secondaryMuscles)) problems.push(`${loc} (${ex.name}) secondaryMuscles not an array`);
  else ex.secondaryMuscles.forEach(m => { if (!MUSCLES.has(m)) problems.push(`${loc} (${ex.name}) bad secondaryMuscle "${m}"`); });
  if (typeof ex.unilateral !== 'boolean') problems.push(`${loc} (${ex.name}) unilateral not boolean`);
  if (typeof ex.focus !== 'string' || ex.focus.length < 15) problems.push(`${loc} (${ex.name}) focus too short/missing`);
});

const nameSet = new Set(all);

// Uniqueness
const seen = new Set(), dupes = new Set();
for (const n of all) { if (seen.has(n)) dupes.add(n); seen.add(n); }
dupes.forEach(d => problems.push(`Duplicate name: "${d}"`));

// Alternatives resolve
eachExercise((ex) => {
  if (ex.alternative && !nameSet.has(ex.alternative)) {
    problems.push(`"${ex.name}" alternative "${ex.alternative}" does not exist in the database`);
  }
  if (ex.alternative === ex.name) problems.push(`"${ex.name}" lists itself as its alternative`);
});

// Legacy coverage
const missingLegacy = LEGACY.filter(n => !nameSet.has(n));
missingLegacy.forEach(n => problems.push(`MISSING legacy exercise: "${n}"`));

// Report
console.log(`Total exercises: ${all.length}`);
console.log(`Unique names:    ${nameSet.size}`);
console.log(`Legacy present:  ${LEGACY.length - missingLegacy.length}/${LEGACY.length}`);
const byGroup = {};
eachExercise((ex, loc) => { const k = loc.split('[')[0]; byGroup[k] = (byGroup[k]||0)+1; });
console.log('Per-slot counts:'); Object.entries(byGroup).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

if (problems.length) {
  console.log(`\n❌ ${problems.length} problem(s):`);
  problems.forEach(p => console.log('  - ' + p));
  process.exit(1);
} else {
  console.log('\n✅ All checks passed.');
  process.exit(0);
}
