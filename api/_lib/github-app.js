import { App } from '@octokit/app'
import { Octokit } from '@octokit/rest'

// Mint an installation-scoped Octokit for the Velyr GitHub App. Shared within
// the Node (api/) runtime by both webhook handlers (telegram.js, github.js) and
// the reconcile helpers (run-reconcile.js). The underscore-prefixed _lib path
// means Vercel does NOT treat this as a route, so it doesn't count toward the
// 12-function cap. (The Deno edge function keeps its own copy — different
// crypto/resolver — see the cross-runtime twin note in CLAUDE.md.)
export async function getOctokit(installationId) {
  const app = new App({
    appId: process.env.GITHUB_APP_ID,
    privateKey: Buffer.from(
      process.env.GITHUB_APP_PRIVATE_KEY_BASE64, 'base64'
    ).toString('utf-8')
  })

  const { data: { token } } = await app.octokit.request(
    'POST /app/installations/{installation_id}/access_tokens',
    { installation_id: installationId }
  )

  return new Octokit({ auth: token })
}
