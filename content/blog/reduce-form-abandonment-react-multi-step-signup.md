---
title: "How to Reduce Form Abandonment in a React Multi-Step Signup"
slug: "reduce-form-abandonment-react-multi-step-signup"
description: "Cut abandonment in a React multi-step signup: keep all answers in one state object, show a progress indicator, and never lose data when the user steps back — with a runnable wizard."
tldr: "A multi-step React signup leaks users when each step throws away the previous answers or hides how much is left. Hold every step's data in one state object that persists across navigation, show a step counter so progress feels finite, and let users go back without losing input. The whole wizard is one useState object."
cluster: "framework-fixes"
tags: ["react", "form-abandonment", "multi-step-form", "conversion-rate", "wizard"]
publishedAt: "2026-06-04"
updatedAt: "2026-06-04"
author: "Velyr Team"
related:
  - "fix-low-converting-react-hero-section"
  - "reduce-signup-form-abandonment-nextjs-app-router"
  - "build-signup-funnel-posthog"
faqs:
  - q: "Why do multi-step forms have high abandonment?"
    a: "Usually because progress feels open-ended (no indication of how many steps remain) and because stepping back loses what was already entered. Both make the form feel risky and long, so people quit. Fixing perceived length and preserving data are the two biggest levers."
  - q: "Should a signup be one step or multiple?"
    a: "Fewer steps is generally better, but a long single form can feel overwhelming too. If you split it, keep each step short, show a progress indicator, and ask for the lowest-commitment information first so the user is invested before the harder asks."
  - q: "How do I keep data when a user goes back a step in React?"
    a: "Hold all steps' values in a single state object at the wizard level, not in per-step component state that unmounts. Then moving between steps just changes which fields you render; the data persists because it lives above the steps."
---

A multi-step React signup leaks users for two avoidable reasons: each step discards the previous answers, and the user can't tell how much is left. **Hold every step's data in one state object that survives navigation, show a step counter so the end feels reachable, and let users move back without losing input.** It's one `useState` object, not a state library.

## Why multi-step forms bleed users

Two perceptions drive the drop-off:

1. **"How long is this?"** An open-ended form feels infinite. A visible "Step 2 of 3" makes the commitment finite and small.
2. **"Did I just lose that?"** If going back to fix the email wipes the page-two answers, trust evaporates and people leave. Data must persist across steps.

Both are state-management decisions, not design flourishes.

## Hold all steps in one state object

The key move is to keep the data **above** the individual steps, so changing step is just changing what you render — the values never unmount:

```tsx
import { useState } from 'react'

type SignupData = { email: string; company: string; role: string }

export function SignupWizard() {
  const [step, setStep] = useState(1)
  const [data, setData] = useState<SignupData>({ email: '', company: '', role: '' })

  const update = (patch: Partial<SignupData>) => setData((d) => ({ ...d, ...patch }))
  const TOTAL = 3

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <p className="progress">Step {step} of {TOTAL}</p>

      {step === 1 && (
        <input
          name="email" type="email" placeholder="Work email"
          value={data.email} onChange={(e) => update({ email: e.target.value })}
        />
      )}
      {step === 2 && (
        <input
          name="company" placeholder="Company"
          value={data.company} onChange={(e) => update({ company: e.target.value })}
        />
      )}
      {step === 3 && (
        <input
          name="role" placeholder="Your role"
          value={data.role} onChange={(e) => update({ role: e.target.value })}
        />
      )}

      <div className="nav">
        {step > 1 && <button type="button" onClick={() => setStep((s) => s - 1)}>Back</button>}
        {step < TOTAL
          ? <button type="button" onClick={() => setStep((s) => s + 1)}>Next</button>
          : <button type="submit">Create account</button>}
      </div>
    </form>
  )
}
```

Because `data` lives at the wizard level, pressing **Back** re-renders step one with `value={data.email}` already filled. Nothing is lost, ever. The inputs are controlled, so the state is the single source of truth.

## Three rules that lower the drop-off

1. **Ask for the easy thing first.** Email before company before role. Once someone has invested two answers, they're far more likely to finish the third.
2. **Show progress honestly.** "Step 2 of 3" only helps if 3 is really the end. Don't surprise people with a hidden step four.
3. **Persist beyond the session if it's long.** For a genuinely long form, mirror `data` into `localStorage` on change so a refresh or accidental close doesn't wipe everything.

## Find which step loses people

Fire a `signup_step` event with the step number, then this HogQL shows how far people get:

```sql
SELECT
  properties.step AS step,
  countDistinct(person_id) AS reached
FROM events
WHERE event = 'signup_step'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY step
ORDER BY step
```

Illustrative sample output:

| step | reached |
|------|--------:|
| 1    | 1,400   |
| 2    | 980     |
| 3    | 760     |

If the biggest fall is step 1 → 2, that step is asking for too much too soon — move a field or cut it. The steepest drop is always where to work first.

## The takeaway

A multi-step signup converts when progress feels finite and no answer is ever lost. Both come from holding the data in one object above the steps. If you'd like the weakest step found and the fix shipped as a Pull Request, that's what [Velyr](/agent/register) does.
