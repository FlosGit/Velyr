// Shared transform: a raw graph row (agent_site_network OR site_structure_preview)
// → the SiteNetworkData shape the SiteNetwork component consumes. Both the
// dashboard Network tab and the onboarding first-connect finale use this.
//
// Row node shape: { id, componentName, depth, size, rank, rankReason }.
// Row edge shape: { source, target, kind? }. (agent_site_network edges have no
// kind → default 'import'; site_structure_preview edges carry kind:'structural'.)

// Assets (stylesheets, images, fonts) are real files but not "surfaces" a
// customer reasons about — dropped from the graph.
const NETWORK_ASSET_RE = /\.(css|scss|sass|less|styl|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|eot)$/i

// Map a file path to a SiteNetwork cluster, or null to drop the node.
// Priority: assets dropped → directory segments → filename keywords →
// parent-dir fallback (an app's unrecognised components are product).
export function clusterFromPath(rawPath) {
  if (NETWORK_ASSET_RE.test(rawPath)) return null  // not a surface — drop

  const p   = rawPath.toLowerCase().replace(/\\/g, '/')
  const seg = p.split('/')
  const f   = (seg[seg.length - 1] || '').replace(/\.[^.]+$/, '')  // filename w/o ext

  if (seg.some(s => s === 'hooks'))                                           return 'utility'
  if (seg.some(s => ['utils','util','lib','helpers','services'].includes(s))) return 'utility'
  if (seg.some(s => ['store','context','state','redux','zustand'].includes(s)))return 'utility'
  if (seg.some(s => ['blog','posts','articles','docs','documentation'].includes(s))) return 'content'
  if (seg.some(s => ['auth','authentication'].includes(s)))                   return 'auth'

  if (/privacy|terms|impress|impressum|agb|legal|gdpr|cookie/.test(f))       return 'legal'
  if (/^(login|signin|sign-in|signup|sign-up|register|password|reset|magic-link|verify)$/.test(f)) return 'auth'
  if (/^use[a-z]/.test(f))                                                    return 'utility'
  if (/^(app|layout|root|shell|main)$/.test(f))                              return 'core'
  if (/^(nav|navbar|navigation|header|footer|sidebar|topbar)$/.test(f))      return 'core'
  if (/^(home|index|hero|landing|cta|pricing|plans|features|testimonial|about|contact|faq|waitlist)$/.test(f)) return 'marketing'
  if (/^(checkout|upgrade|subscribe|trial)$/.test(f))                        return 'marketing'
  if (/^(dashboard|analytics|overview|workspace)$/.test(f))                  return 'product'
  if (/^(settings|profile|account|billing|subscription|preferences)$/.test(f)) return 'product'
  if (/^(onboarding|welcome|setup|wizard)$/.test(f))                         return 'product'
  if (/^(blog|post|article|doc|guide|tutorial|changelog)/.test(f))           return 'content'

  if (seg.some(s => ['data','config','types','styles'].includes(s)))         return 'utility'
  if (/^(constants|config|types|theme)$/.test(f))                            return 'utility'

  if (seg.some(s => ['pages','screens','views','routes'].includes(s))) return 'product'
  if (seg.some(s => ['components','ui','shared','common'].includes(s))) {
    if (/hero|cta|banner|pricing|feature|comparison|testimonial|benefit|waitlist|upgrade|premium/.test(f)) return 'marketing'
    if (/nav|menu|header|footer|sidebar|logo/.test(f))                         return 'core'
    return 'product'
  }

  return 'other'
}

export function labelFromNode(n) {
  // componentName is the default-export name (when present); else filename.
  return n.componentName || n.id.split('/').pop().replace(/\.[^.]+$/, '')
}

// Hub label from website_url. Deploy subdomains (Vercel/Netlify *.app, Cloudflare
// Pages *.pages.dev, Render *.onrender.com, Railway *.up.railway.app) show the
// project slug, not the full deploy host.
export function hubDomainFromUrl(websiteUrl) {
  let host
  try { host = new URL(websiteUrl || '').hostname.replace(/^www\./, '') } catch { return null }
  const m = host.match(/^(.+?)\.(?:vercel\.app|netlify\.app|pages\.dev|onrender\.com|up\.railway\.app)$/i)
  return m ? m[1] : host
}

// Build SiteNetworkData from a raw row.
//   row:  { subscription_id, run_id?, captured_at?/updated_at?, framework, nodes[], edges[] }
//   opts: { domain, inflightRun }  (inflightRun → fix-in-flight enrichment; absent at first connect)
// Returns null when the row has no nodes.
export function buildNetworkData(row, { domain, inflightRun } = {}) {
  if (!row?.nodes?.length) return null

  const fileInFlight = inflightRun?.analysis_result?.file_to_edit || null

  const hubNode = {
    id: '__hub__', label: domain || 'your site', route: '/', cluster: 'core',
    status: 'neutral', statusSource: null,
    isEntry: true, isHub: true, isGrouped: false, groupCount: 0,
    rank: null, rankReason: null, dropOffScore: null,
  }

  const enrichedNodes = row.nodes
    .map(n => {
      const cluster = clusterFromPath(n.id)
      if (cluster === null) return null   // asset — not a surface
      let status      = (cluster === 'legal' || cluster === 'utility') ? 'tracked' : 'neutral'
      let statusSource = null
      if (fileInFlight && n.id === fileInFlight) {
        status       = 'fix-in-flight'
        statusSource = `agent_runs.status=${inflightRun.status}`
      }
      return {
        ...n,
        label:        labelFromNode(n),
        route:        null,
        cluster,
        status,
        statusSource,
        isEntry:      n.depth === 0,
        isHub:        false,
        isGrouped:    false,
        groupCount:   0,
        dropOffScore: null,
      }
    })
    .filter(Boolean)

  // Edges kept only when BOTH endpoints survived the asset drop. Preserve the
  // edge's own kind (structural for the first-connect preview); default import.
  const survivingIds = new Set(enrichedNodes.map(n => n.id))
  const realEdges = (row.edges || [])
    .filter(e => survivingIds.has(e.source) && survivingIds.has(e.target))
    .map(e => ({ ...e, kind: e.kind || 'import' }))

  // Structural spokes from hub → every entry-point node.
  const hubEdges = enrichedNodes
    .filter(n => n.isEntry)
    .map(n => ({ source: '__hub__', target: n.id, kind: 'structural', weight: 1 }))

  return {
    meta: {
      subscriptionId: row.subscription_id,
      runId:          row.run_id ?? null,
      snapshotAt:     row.captured_at ?? row.updated_at ?? null,
      framework:      row.framework || 'unknown',
      domain:         domain || 'your site',
      totalNodes:     enrichedNodes.length + 1,
      totalEdges:     realEdges.length + hubEdges.length,
    },
    nodes: [hubNode, ...enrichedNodes],
    edges: [...realEdges, ...hubEdges],
  }
}
