# DayDraft Copy Guidelines

## Goal

Keep product language clear, professional, and action-oriented across all surfaces.

## Core Principles

- Be concise: one idea per sentence.
- Be explicit: say what happened and what to do next.
- Be consistent: reuse the same terms for the same concepts.
- Be respectful: direct, never harsh or vague.
- Prefer plain language over metaphors and slang.

## Voice

- Primary voice: calm, practical, focused.
- Default reading level: simple professional English.
- Avoid irony, sarcasm, or internet slang in core product flows.
- Emojis are optional and should be rare outside explicitly playful tone.

## UI Microcopy Rules

- Buttons: start with a verb (`Generate plan`, `Open recap`, `Carry forward`).
- Empty states: describe current state + next action.
- Helper text: explain why a setting matters in one sentence.
- Section titles: 1-3 words when possible.

## Toast Rules

- Success format: `<Action> completed` or `<Action> updated`.
- Error format: `Unable to <action>.` plus recovery guidance when needed.
- Use sentence case and avoid ellipses unless indicating active progress.
- Avoid dramatic language (`crash`, `disaster`, `chaos`) in user-facing errors.

## State Labels

Use these canonical terms:

- `Carry forward` (not carry-over / move over / roll over interchangeably)
- `Plan ready` / `No plan yet`
- `No tasks scheduled`
- `Review today` / `Weekly review`

## Tone System Guardrails

All tone variants must preserve:

- clear next action
- factual scheduling constraints
- realistic expectations

Tone changes style, not product truth.

## Banned Patterns

- Vague reassurance without action (`You're good!`)
- Ambiguous failure text (`Something went wrong`)
- Slang-heavy copy in core flows (`slaps`, `crush it`, `damage report`)
- All-caps urgency unless safety-critical

## Quick Checklist Before Merging

- Is the message clear without product context?
- Does it tell the user what to do next?
- Is wording consistent with similar screens?
- Is this text short enough for mobile UI?
