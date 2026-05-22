import { PostHog } from 'posthog-node'

export const posthogClient = new PostHog(process.env.POSTHOG_API_KEY, {
  host: process.env.POSTHOG_HOST,
})

// Erstellt automatisch ein PostHog-Projekt für einen neuen User
export async function createPostHogProject(projectName) {
  const host = process.env.POSTHOG_HOST || 'https://us.i.posthog.com'
  const orgId = process.env.POSTHOG_ORG_ID // neu in .env — deine Org-ID

  const res = await fetch(`${host}/api/organizations/${orgId}/projects/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.POSTHOG_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: projectName }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`PostHog project creation failed: ${err}`)
  }

  const project = await res.json()

  // project.id = Project ID (z.B. 171704)
  // project.api_token = der API-Key für den Snippet (ph_...)
  return {
    projectId: String(project.id),
    apiToken: project.api_token, // das geht in den Snippet des Users
  }
}

export default posthogClient