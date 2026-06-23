---
title: "How to Reduce Signup Form Abandonment in Next.js App Router"
slug: "reduce-signup-form-abandonment-nextjs-app-router"
description: "Cut Next.js signup abandonment with a Server Action: the form posts and validates server-side, works without client JS, and returns typed errors with useActionState — no value loss."
tldr: "Use a Next.js Server Action for your signup form. The form posts directly to a server function that validates and returns field-level errors, so the form works even before JavaScript loads, and useActionState repopulates the inputs instead of clearing them on error. That removes the two biggest abandonment causes: lost input and JS-dependent forms."
cluster: "framework-fixes"
tags: ["nextjs", "server-actions", "form-abandonment", "app-router", "conversion-rate"]
publishedAt: "2026-06-04"
updatedAt: "2026-06-04"
author: "Velyr Team"
related:
  - "reduce-form-abandonment-react-multi-step-signup"
  - "build-signup-funnel-posthog"
  - "improve-conversion-nextjs-landing-page"
  - "cut-signup-abandonment-remix-action-and-usefetcher"
  - "reduce-form-abandonment-plain-html-signup-form"
  - "use-sveltekit-form-action-cut-checkout-drop-off"
faqs:
  - q: "What is a Server Action in the Next.js App Router?"
    a: "A Server Action is an async function marked with 'use server' that runs on the server and can be passed straight to a form's action prop. The form posts to it directly, so the submission works as a native HTML form even before the client JavaScript has loaded."
  - q: "How do I keep signup inputs after a validation error in Next.js?"
    a: "Return the submitted values and errors from the Server Action and read them with the useActionState hook. The returned state is available on the next render, so you bind each input's defaultValue back to it and the user never loses what they typed."
  - q: "Does a Server Action form work without JavaScript?"
    a: "Yes. Because the form posts to the action as a real HTML form, it submits and validates server-side even if the client bundle hasn't loaded. Adding the useActionState hook progressively enhances it with no-reload error display."
---

The biggest causes of signup abandonment are mechanical: a form that clears everything on a validation error, and a form that does nothing until JavaScript loads. **In the Next.js App Router, a Server Action fixes both — the form posts directly to a server function that validates and returns field-level errors, it works without client JS, and `useActionState` repopulates the inputs instead of wiping them.**

## Why Server Actions are the right tool here

A Server Action is the genuinely App-Router-specific construct for this: an async function that runs on the server and can be handed straight to a `<form action={...}>`. The form submits to it as a native HTML POST, so it works before — or entirely without — client hydration. Layer on the `useActionState` hook and you get inline, no-reload error handling on top of that resilient baseline. That's progressive enhancement done by the framework.

## The Server Action

Mark the function `'use server'`, validate, and return a typed result that carries the values back on failure:

```tsx
// app/signup/actions.ts
'use server'
import { redirect } from 'next/navigation'

type SignupState = { error?: string; email?: string }

export async function signup(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  if (!email.includes('@')) return { error: 'Enter a valid email.', email }
  if (password.length < 8) return { error: 'Password must be at least 8 characters.', email }

  // create the account here…
  redirect('/welcome')
}
```

Returning `{ error, email }` on the failure paths is what lets the page refill the form. On success, `redirect` sends the user on.

## The form with `useActionState`

`useActionState` wires the action to the form and exposes its returned state for the next render:

```tsx
// app/signup/page.tsx
'use client'
import { useActionState } from 'react'
import { signup } from './actions'

export default function SignupPage() {
  const [state, formAction] = useActionState(signup, {})

  return (
    <form action={formAction}>
      {/* defaultValue repopulates the email on a validation error */}
      <input name="email" type="email" defaultValue={state.email ?? ''} required />
      <input name="password" type="password" required />
      {state.error && <p className="error">{state.error}</p>}
      <button>Create account</button>
    </form>
  )
}
```

`defaultValue={state.email}` is the anti-abandonment line: a failed submit comes back with the email intact. And because the `<form>` posts to a Server Action, it still submits server-side if the client JS hasn't loaded — the `useActionState` enhancement just adds the no-reload error display.

## Steps to apply it

1. Move signup validation into a `'use server'` action that returns `{ error, ...values }` on every failure branch.
2. Wire the form with `useActionState(action, {})` and pass `formAction` to the `<form action>`.
3. Bind each input's `defaultValue` to the returned state so a failed submit repopulates.
4. Keep the fields minimal — every extra field is another reason to quit.
5. Capture `signup_started` on first input and `signup_completed` on the action's success path.

## Measure the abandonment you're fixing

With those two events, this HogQL gives the abandonment rate over 30 days:

```sql
SELECT
  countDistinctIf(person_id, event = 'signup_started') AS started,
  countDistinctIf(person_id, event = 'signup_completed') AS completed,
  round(
    (countDistinctIf(person_id, event = 'signup_started')
      - countDistinctIf(person_id, event = 'signup_completed'))
    / countDistinctIf(person_id, event = 'signup_started') * 100,
  1) AS abandonment_rate_pct
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
```

Illustrative sample output:

| started | completed | abandonment_rate_pct |
|--------:|----------:|---------------------:|
| 1,720   | 1,150     | 33.1                 |

Ship the Server Action, then re-run this in two weeks against the same window. If abandonment falls, the mechanics were the problem — as they usually are.

If you'd rather have that fix found and opened as a Pull Request for you, that's what [Velyr](/agent/register) does.
