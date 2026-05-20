import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { installationId, repoOwner, repoName } = req.body

  if (!installationId || !repoOwner || !repoName) {
    return res.status(400).json({ valid: false, message: 'Missing installationId, repoOwner, or repoName.' })
  }

  try {
    const auth = createAppAuth({
      appId:         process.env.GITHUB_APP_ID,
      privateKey:    Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY_BASE64, 'base64').toString('utf8'),
      installationId: parseInt(installationId),
    })

    // The installation auth response carries the granted permission scopes.
    // We check them up front (Stage 5.2) so a read-only or mis-scoped install
    // fails HERE — at onboarding, before any AI spend — instead of dying at
    // PR-creation time on a weekly run.
    const authResult = await auth({ type: 'installation' })
    const { token, permissions } = authResult
    const octokit = new Octokit({ auth: token })

    // Stage 5.2: require Contents R/W and Pull requests R/W. GitHub reports
    // 'write' (or 'admin') when granted; 'read' or absent means we can't open
    // a PR with a commit.
    const contentsOk = permissions?.contents === 'write' || permissions?.contents === 'admin'
    const prOk       = permissions?.pull_requests === 'write' || permissions?.pull_requests === 'admin'
    if (!contentsOk || !prOk) {
      const missing = [
        !contentsOk ? 'Contents (Read & write)' : null,
        !prOk ? 'Pull requests (Read & write)' : null,
      ].filter(Boolean).join(' and ')
      return res.status(200).json({
        valid: false,
        message: `The Velyr GitHub App is missing required permissions: ${missing}. Re-install the app and grant write access to Contents and Pull requests.`,
      })
    }

    // Stage 5.3 / 5.9: confirm the repo exists, is reachable by this
    // installation, and isn't archived (archived repos reject all writes).
    const { data: repo } = await octokit.repos.get({ owner: repoOwner, repo: repoName })
    if (repo.archived) {
      return res.status(200).json({
        valid: false,
        message: 'This repository is archived. Un-archive it on GitHub before connecting — the agent cannot push to an archived repo.',
      })
    }

    return res.status(200).json({ valid: true, defaultBranch: repo.default_branch })
  } catch (err) {
    console.error('validate-repo error:', err.message)

    let message = 'Could not access this repository. Check your details and try again.'
    if (err.status === 404) message = 'Repository not found, or this installation has no access to it. Check the owner name, repo name, and installation ID.'
    if (err.status === 401) message = 'GitHub App authentication failed. Contact support.'
    if (err.status === 403) message = 'GitHub denied access (insufficient permissions or rate limited). Re-check the app installation.'

    return res.status(200).json({ valid: false, message })
  }
}