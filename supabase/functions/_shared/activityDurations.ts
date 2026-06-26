/**
 * Real-world activity-duration reference for AI time estimation.
 *
 * Two sources, deliberately merged for accuracy:
 *  1. Per-session task times by profession — derived from O*NET / ATUS 2024
 *     occupational task analysis (docs/time_data_compact.json). These are the
 *     realistic length of ONE working session of that task.
 *  2. Curated everyday-life durations (BLS ATUS, OECD, productivity research).
 *
 * IMPORTANT — what is intentionally NOT here: the raw dataset's
 * general-population rows are reported as *daily averages across the whole
 * population* (e.g. grocery 7.4m, childcare 8.8m, "research/homework" 5m,
 * sleep 541m). Those are NOT how long a single task takes, so feeding them to
 * the model as block lengths makes estimates worse. They are filtered out;
 * everyday tasks use the curated per-session numbers below instead.
 *
 * Shared by generate-plan (Pro planner) and parse-tasks (the composer that
 * runs for every user on every task add), so both estimate from the same data.
 */

export const ACTIVITY_DURATIONS = `
REAL-WORLD ACTIVITY DURATION REFERENCE — typical length of ONE session of a task.
HOW TO USE (this is the difference between a guess and a good estimate):
1. First read what KIND of task it is — which role/domain it belongs to — then anchor to the CLOSEST matching row below. Match on meaning, not exact words ("write the deck" ≈ "Writing specs/PRDs"; "patient notes" ≈ "Documentation & charting").
2. PROFESSION LENS: if the user's context/about-them indicates a profession listed below, PREFER that profession's rows for their work tasks — a developer's "review" is "Code review 45m", a lawyer's "review" is "Legal research 120m". Same word, different real duration.
3. These are typical averages — SCALE them by explicit signals in the task text: "quick/brief/just" → shorter; "deep work/full session/marathon/properly" → longer. Any explicit number the user wrote (e.g. "for 2h", "30 min") ALWAYS wins and is never overridden.
4. When nothing matches and the length is genuinely unknowable (e.g. "work on the report"), leave it null rather than inventing a token 30m block.

PROFESSIONAL & WORK TASKS (per session, by role):
[Software Dev] Code:180,Debug:60,Plan:60,Review:45,Meet:45,Docs:30,Learn:30,Email:30
[App Dev] Code:180,Test:60,Review:45,Meet:45,Learn:45,Docs:30,Analytics:30,AppStore:20
[Data Analyst] Clean:120,Analyze:120,Dashboard:60,Report:60,Meet:60,SQL:60
[UI/UX] Wireframe:120,Visual:120,Research:60,Meet:60,Review:45,Docs:30,Learn:30
[Graphic Design] Create:180,Client:60,Brief:60,Asset:45,Research:30,Email:30
[Product Mgr] Meet:150,Roadmap:90,Research:60,Specs:60,Email:60,Data:45,Competitor:30
[Project Mgr] Meet:120,Plan:90,Email:90,Docs:60,Risk:45,Stakeholder:45
[Marketing] Content:120,Campaign:60,Analytics:60,Social:60,Meet:60,Email:45,Research:45
[Sales] Calls:120,Prospect:90,Email:90,CRM:45,Proposal:45,Meet:45,Network:30
[Support] Tickets:180,Live/Phone:120,Investigate:60,Docs:45,Meet:45,Report:30
[Accountant] Bookkeep:120,Report:90,Tax:90,Client:60,Audit:60,Meet:30
[HR] Recruit:120,Email:90,Onboard:60,System:60,Benefits:60,Meet:60,Conflict:30
[Lawyer] Research:120,Draft:120,Client:90,Court:60,Email:60,Admin:30
[Teacher] Teach:200,Plan:90,Grade:60,StudentSupport:45,Admin:30,Dev:20
[Nurse] Patient:240,Chart:90,Meds:60,Education:45,Coord:30,Procedure:30
[Physician] Consult:210,EHR:120,Labs:60,Prescribe:45,Coord:30,Admin:30
[Writer] Write:180,Research:90,Edit:60,Client:45,SEO:45,Email:30
[Creator] Edit:180,Film:120,Script:60,Design:30,Community:30,Strategy:30,Admin:30
[Fitness] Train:240,Program:60,Client:60,OwnTrain:60,Admin:30,Social:30
[Chef] Cook:300,Clean:60,Menu:45,Manage:45,Staff:30
[Freelance] Billable:240,Prospect:60,Marketing:45,Email:45,Invoice:30,Learn:30

GENERIC WORK (fallback):
Deep work/code/write:60-90,Email:20-30,Standup:15,Meet:30,LongMeet:60,Project:60,Admin:30,Brainstorm:45

SPORTS/EXERCISE:
Gym/Weights/Yoga/Dance/Bike/Swim/MartialArts:60,Cardio/Run/Walk/Pilates/Aerobics:45,Hike/Cricket:120,Golf:240,Fish/Climb:180,Tennis/Soccer/Baseball/Rugby/Bowling:90,HomeWorkout:30,Meditation:15

HEALTH/APPOINTMENTS:
Doctor:45,Dentist/Therapy/Vet/Medical:60

FOOD/MEALS:
Breakfast:30,Lunch:60,Dinner:90,QuickMeal:20,Grocery:60

FAMILY/CHILDCARE:
Play:60,Dropoff:30,Homework:45,Bedtime:40,DogWalk:30

HOUSEHOLD:
Laundry/Iron/CleanRoom/CarWash:30,FullClean:120,Tidy:20,Trash:10

ERRANDS/SERVICES:
Errand/Bank/PostOffice:30,Haircut:45,Shopping:90,Legal:90,Tax/RealEstate/Repair:60

LEISURE:
Movie:150,TVEpisode/Read/Walk:60,Gaming/Museum:120,Phone/Nap/Shower:30,Party:180

CIVIC/RELIGIOUS:
Vote:20,Civic:30,Religious:90

ROUTINES & PREP (accompanying tasks):
MorningRoutine/GetReady:30-45,EveningRoutine/WindDown:30,PackBag/Prep:10-15,Shower+Change(after gym):15-20,KitchenCleanup(after cooking):15-20,SetupWorkspace:10

TRAVEL (add SEPARATE, don't fold into activity):
Walk:15,Drive/Transit/Commute:20-40 (Use user's exact number if stated)
`;

/**
 * "role.label" (lowercased) → minutes, parsed straight out of the
 * PROFESSIONAL & WORK TASKS block above — single source of truth, so this can
 * never drift from what the model actually reads.
 *
 * Why: a model can silently ignore the table and free-type a different number
 * even after correctly identifying which row a task belongs to — there's no
 * way to verify that from duration_min alone. So parse-tasks additionally
 * asks Gemini to NAME the row it used (e.g. "Software Dev.Code"); naming the
 * row is language- and phrasing-agnostic (the model bridges meaning, not a
 * string-match), and once named, the exact minutes can be looked up here and
 * used to clamp/confirm duration_min instead of trusting the free-typed
 * number outright.
 */
function buildProfessionalRefMap(): Map<string, number> {
  const map = new Map<string, number>();
  const block = /PROFESSIONAL & WORK TASKS[^\n]*\n([\s\S]*?)\n\nGENERIC WORK/.exec(ACTIVITY_DURATIONS)?.[1] || "";
  for (const line of block.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const m = /^\[([^\]]+)\]\s*(.+)$/.exec(line);
    if (!m) continue;
    const role = m[1].trim();
    for (const entry of m[2].split(",")) {
      const [label, numStr] = entry.split(":");
      const mins = parseInt(numStr, 10);
      if (label && Number.isFinite(mins)) map.set(`${role}.${label}`.trim().toLowerCase(), mins);
    }
  }
  return map;
}

const PROFESSIONAL_REF_MINUTES = buildProfessionalRefMap();

/** Resolve a model-supplied "Role.Label" ref to its table minutes, or null if it doesn't match verbatim (typo'd/hallucinated ref — safe no-op, caller keeps its own estimate). */
export function resolveProfessionalRef(ref: string | null | undefined): number | null {
  if (!ref) return null;
  return PROFESSIONAL_REF_MINUTES.get(String(ref).trim().toLowerCase()) ?? null;
}
