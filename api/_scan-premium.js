import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

export const config = { maxDuration: 60 }

const APIFY_TOKEN = process.env.APIFY_TOKEN

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
)

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' })
  : null

async function verifyGuestSession(sessionId) {
  if (!stripe || !sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) return false
  try {
    const s = await stripe.checkout.sessions.retrieve(sessionId)
    return s.payment_status === 'paid' && s.metadata?.type === 'full_scan'
  } catch (e) {
    console.error('verifyGuestSession failed:', e.message)
    return false
  }
}

async function checkPremiumAccess(req, res) {
  // Path A — guest with a paid Stripe session
  const sessionId = req.headers['x-session-id']
  if (sessionId) {
    if (await verifyGuestSession(sessionId)) return { id: `guest:${sessionId}`, guest: true }
  }

  // Path B — logged-in user with full_scan_purchased or active subscription
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (!token) { res.status(401).json({ error: 'login required' }); return null }

  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) { res.status(401).json({ error: 'login required' }); return null }

  const { data: row } = await supabase
    .from('agent_subscriptions')
    .select('full_scan_purchased, subscription_status')
    .eq('user_id', user.id)
    .single()

  const allowed = row?.full_scan_purchased === true || row?.subscription_status === 'active'
  if (!allowed) { res.status(402).json({ error: 'payment required' }); return null }
  return user
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function withTimeout(promise, ms, fallback = null) {
  return Promise.race([promise, new Promise(r => setTimeout(() => r(fallback), ms))])
}

function cleanHandle(handle) {
  if (!handle) return null
  return handle.trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?(tiktok|instagram|twitter|x|youtube|facebook)\.com\/?(@)?/, '')
    .split('/')[0].split('?')[0].trim() || null
}

// ─── Apify runner ─────────────────────────────────────────────────────────────
async function runApify(actorId, input, errors = null) {
  const slug = actorId.replace('/', '~')
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${slug}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=50&memory=256`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(52000) }
    )
    if (!res.ok) {
      console.error(`Apify ${actorId} HTTP ${res.status}`)
      if (errors) errors.push({ actorId, kind: 'http', status: res.status })
      return null
    }
    const data = await res.json()
    if (!Array.isArray(data)) {
      console.error(`Apify ${actorId} non-array response`)
      if (errors) errors.push({ actorId, kind: 'non_array' })
      return null
    }
    return data
  } catch (e) {
    console.error(`Apify ${actorId} failed:`, e.message, e.stack)
    if (errors) errors.push({ actorId, kind: 'error', message: e.message })
    return null
  }
}

// ─── Hook type classifier ─────────────────────────────────────────────────────
function classifyHook(caption) {
  if (!caption) return 'other'
  const c = caption.slice(0, 120).toLowerCase()
  if (/\?/.test(c))                                                  return 'question'
  if (/pov:|imagine |what if |nobody talks about/i.test(c))         return 'pov'
  if (/stop |never |mistake|wrong|don't |avoid/i.test(c))           return 'warning'
  if (/i (tried|spent|did|made|built|went|quit)|my story/i.test(c)) return 'story'
  if (/\d+ (ways|tips|things|steps|reasons|hacks)/i.test(c))        return 'list'
  if (/how to |tutorial|guide|step by step/i.test(c))               return 'howto'
  if (/secret|they don't want|hidden|no one|untold/i.test(c))       return 'secret'
  return 'other'
}

const HOOK_LABELS = {
  question: 'Question hook',
  pov:      'POV / Scenario',
  warning:  'Warning / Mistake',
  story:    'Personal story',
  list:     'List / Tips',
  howto:    'How-to / Tutorial',
  secret:   'Secret / Reveal',
  other:    'Other',
}

// ─── Content category classifier ─────────────────────────────────────────────
function classifyContent(caption) {
  if (!caption) return 'other'
  const c = caption.toLowerCase()
  if (/buy|shop|sale|discount|link in bio|promo|offer|coupon|limited/i.test(c)) return 'promo'
  if (/tip|trick|hack|learn|teach|guide|tutorial|how to|step|lesson|fact/i.test(c)) return 'education'
  if (/review|honest|unboxing|try|haul|react/i.test(c))                          return 'review'
  if (/day in|routine|life|vlog|behind|story|journey/i.test(c))                  return 'lifestyle'
  if (/motivat|inspire|mindset|success|goal|dream|grind/i.test(c))               return 'motivation'
  if (/funny|lol|comedy|joke|haha|trend|challenge/i.test(c))                     return 'entertainment'
  return 'other'
}

const CONTENT_LABELS = {
  promo:         'Promotional',
  education:     'Educational',
  review:        'Review / Reaction',
  lifestyle:     'Lifestyle / Vlog',
  motivation:    'Motivational',
  entertainment: 'Entertainment',
  other:         'Other',
}

// ─── Posting time analyzer ────────────────────────────────────────────────────
function analyzePostingTimes(items, timeField = 'createTime') {
  const hourBuckets = Array(24).fill(null).map((_, h) => ({ hour: h, count: 0, totalEngagement: 0 }))
  const dayBuckets  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => ({ day: d, index: i, count: 0, totalEngagement: 0 }))
  let parsed = 0

  for (const item of items) {
    const raw = item[timeField] || item.timestamp || item.publishedAt || item.postedAt
    if (!raw) continue
    const ts = typeof raw === 'number' ? raw * 1000 : Date.parse(raw)
    if (isNaN(ts)) continue
    const d  = new Date(ts)
    const h  = d.getUTCHours()
    const wd = d.getUTCDay()
    const eng = (item.diggCount || item.likesCount || item.likeCount || 0) +
                (item.commentCount || item.commentsCount || 0)
    hourBuckets[h].count++
    hourBuckets[h].totalEngagement += eng
    dayBuckets[wd].count++
    dayBuckets[wd].totalEngagement += eng
    parsed++
  }

  if (parsed < 3) return null

  const fmtHour = h => `${h === 0 ? 12 : h > 12 ? h - 12 : h}${h < 12 ? 'am' : 'pm'}`

  const avgEngByHour = hourBuckets
    .filter(b => b.count > 0)
    .map(b => ({ hour: b.hour, label: fmtHour(b.hour), avgEng: Math.round(b.totalEngagement / b.count), count: b.count }))
    .sort((a, b) => b.avgEng - a.avgEng)

  const avgEngByDay = dayBuckets
    .filter(b => b.count > 0)
    .map(b => ({ day: b.day, avgEng: Math.round(b.totalEngagement / b.count), count: b.count }))
    .sort((a, b) => b.avgEng - a.avgEng)

  return {
    bestHours:      avgEngByHour.slice(0, 3).map(b => ({ label: b.label, avgEng: b.avgEng, posts: b.count })),
    worstHours:     avgEngByHour.slice(-2).map(b => ({ label: b.label, avgEng: b.avgEng, posts: b.count })),
    bestDays:       avgEngByDay.slice(0, 3).map(b => ({ label: b.day, avgEng: b.avgEng, posts: b.count })),
    totalAnalyzed:  parsed,
  }
}

// ─── Hashtag analyzer ─────────────────────────────────────────────────────────
function analyzeHashtags(items) {
  const freq = {}
  let totalPosts = 0

  for (const item of items) {
    let tags = []
    if (Array.isArray(item.hashtags)) {
      tags = item.hashtags.map(h => (typeof h === 'string' ? h : h.name || h.title || '')).filter(Boolean)
    }
    const caption = item.text || item.caption || ''
    const fromCaption = (caption.match(/#(\w+)/g) || []).map(t => t.slice(1))
    tags = [...new Set([...tags, ...fromCaption])]
    if (!tags.length) continue
    totalPosts++
    for (const t of tags) {
      const key = t.toLowerCase()
      if (!freq[key]) freq[key] = { tag: t, count: 0, totalEng: 0 }
      freq[key].count++
      freq[key].totalEng += (item.diggCount || item.likesCount || 0)
    }
  }

  if (!totalPosts) return null

  const sorted = Object.values(freq).sort((a, b) => b.count - a.count)
  const byEng  = Object.values(freq)
    .filter(h => h.count >= 2)
    .sort((a, b) => (b.totalEng / b.count) - (a.totalEng / a.count))

  return {
    topByFrequency:  sorted.slice(0, 10).map(h => ({ tag: `#${h.tag}`, uses: h.count })),
    topByEngagement: byEng.slice(0, 5).map(h => ({ tag: `#${h.tag}`, avgEng: Math.round(h.totalEng / h.count), uses: h.count })),
    totalTaggedPosts: totalPosts,
  }
}

// ─── Content mix ──────────────────────────────────────────────────────────────
function analyzeContentMix(items, captionField = 'text') {
  const counts = {}, engByType = {}
  for (const item of items) {
    const cap  = item[captionField] || item.caption || item.text || ''
    const type = classifyContent(cap)
    counts[type]    = (counts[type]    || 0) + 1
    const eng = (item.diggCount || item.likesCount || 0) + (item.commentCount || item.commentsCount || 0)
    engByType[type] = (engByType[type] || 0) + eng
  }
  const total = items.length || 1
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({
      type, label: CONTENT_LABELS[type] || type,
      count, pct: Math.round(count / total * 100),
      avgEng: Math.round((engByType[type] || 0) / count),
    }))
}

// ─── Hook mix ─────────────────────────────────────────────────────────────────
function analyzeHookMix(items, captionField = 'text') {
  const counts = {}, engByHook = {}
  for (const item of items) {
    const cap  = item[captionField] || item.caption || item.text || ''
    const type = classifyHook(cap)
    counts[type]    = (counts[type]    || 0) + 1
    const eng = (item.diggCount || item.likesCount || 0) + (item.commentCount || item.commentsCount || 0)
    engByHook[type] = (engByHook[type] || 0) + eng
  }
  const total = items.length || 1
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({
      type, label: HOOK_LABELS[type] || type,
      count, pct: Math.round(count / total * 100),
      avgEng: Math.round((engByHook[type] || 0) / count),
    }))
}

// ─── Platform processors ──────────────────────────────────────────────────────
function processTikTok(items, isDeep = false) {
  if (!items?.length) return null
  try {
    const first = items[0]
    const a = first.authorMeta || {}
    const followers = a.fans || a.followers || 0
    const videos = items.filter(i => i.diggCount !== undefined || i.playCount !== undefined)
    const totalViews = videos.reduce((s, v) => s + (v.playCount  || 0), 0)
    const totalLikes = videos.reduce((s, v) => s + (v.diggCount  || 0), 0)
    const avgViews   = videos.length ? Math.round(totalViews / videos.length) : 0
    const avgLikes   = videos.length ? Math.round(totalLikes / videos.length) : 0
    const engagementRate = followers > 0 && avgLikes > 0 ? (avgLikes / followers * 100).toFixed(2) : '0'

    const result = {
      followers, following: a.following || 0, heartCount: a.heart || 0,
      videoCount: a.video || videos.length, bio: a.signature || '',
      hasLink: !!(a.bioLink?.link || a.bioLink),
      avgViews, avgLikes, engagementRate,
      topVideos: videos.slice(0, isDeep ? 15 : 5).map(v => ({
        caption: (v.text || '').slice(0, 300),
        views: v.playCount || 0, likes: v.diggCount || 0,
        comments: v.commentCount || 0, shares: v.shareCount || 0,
        hookType: classifyHook(v.text || ''),
        contentType: classifyContent(v.text || ''),
        hashtags: (v.hashtags || []).map(h => h.name || h).filter(Boolean).slice(0, 8),
        createTime: v.createTime || null,
      }))
    }

    if (isDeep) {
      result.deepAnalysis = {
        postingTimes:  analyzePostingTimes(videos, 'createTime'),
        hashtagAnalysis: analyzeHashtags(videos),
        contentMix:    analyzeContentMix(videos, 'text'),
        hookMix:       analyzeHookMix(videos, 'text'),
        totalPostsAnalyzed: videos.length,
      }
    }
    return result
  } catch (e) { console.error('TikTok parse error:', e.message); return null }
}

function processInstagram(items, isDeep = false) {
  if (!items?.length) return null
  try {
    const profileCandidates = items.filter(i => i.followersCount !== undefined)
    const profile = profileCandidates.find(i => i.likesCount === undefined)
      || profileCandidates.sort((a, b) => (b.followersCount || 0) - (a.followersCount || 0))[0]
      || items[0]
    const posts     = items.filter(i => i.likesCount !== undefined)
    const followers = profile?.followersCount
      || posts.find(p => p.followersCount !== undefined)?.followersCount || 0
    const totalLikes    = posts.reduce((s, p) => s + (p.likesCount    || 0), 0)
    const totalComments = posts.reduce((s, p) => s + (p.commentsCount || 0), 0)
    const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : 0
    const engagementRate = followers > 0 && posts.length > 0
      ? (((totalLikes + totalComments) / posts.length) / followers * 100).toFixed(2) : '0'

    const result = {
      followers, following: profile?.followsCount || 0,
      postsCount: profile?.postsCount || posts.length,
      bio: profile?.biography || '', hasLink: !!(profile?.externalUrl),
      avgLikes, engagementRate,
      topPosts: posts.slice(0, isDeep ? 15 : 5).map(p => ({
        caption: (p.caption || '').slice(0, 300),
        likes: p.likesCount || 0, comments: p.commentsCount || 0, type: p.type || 'image',
        hookType: classifyHook(p.caption || ''),
        contentType: classifyContent(p.caption || ''),
        timestamp: p.timestamp || p.takenAt || null,
      }))
    }

    if (isDeep) {
      result.deepAnalysis = {
        postingTimes:    analyzePostingTimes(posts, 'timestamp'),
        hashtagAnalysis: analyzeHashtags(posts),
        contentMix:      analyzeContentMix(posts, 'caption'),
        hookMix:         analyzeHookMix(posts, 'caption'),
        totalPostsAnalyzed: posts.length,
      }
    }
    return result
  } catch (e) { console.error('Instagram parse error:', e.message); return null }
}

function processYouTube(items, isDeep = false) {
  if (!items?.length) return null
  try {
    const channel = items.find(i => i.subscriberCount !== undefined) || items[0]
    const videos  = items.filter(i => i.viewCount !== undefined && i.title)
    const totalViews = videos.reduce((s, v) => s + (v.viewCount || 0), 0)
    const avgViews   = videos.length ? Math.round(totalViews / videos.length) : 0

    const result = {
      subscribers: channel?.subscriberCount || 0,
      videoCount: videos.length,
      channelName: channel?.channelName || channel?.title || '',
      avgViews,
      topVideos: videos.slice(0, isDeep ? 15 : 5).map(v => ({
        title: v.title || '', views: v.viewCount || 0, likes: v.likes || 0,
        comments: v.commentsCount || 0,
        contentType: classifyContent(v.title || ''),
        hookType: classifyHook(v.title || ''),
        publishedAt: v.publishedAt || null,
      }))
    }

    if (isDeep) {
      result.deepAnalysis = {
        postingTimes: analyzePostingTimes(videos, 'publishedAt'),
        contentMix:   analyzeContentMix(videos, 'title'),
        hookMix:      analyzeHookMix(videos, 'title'),
        totalPostsAnalyzed: videos.length,
      }
    }
    return result
  } catch (e) { console.error('YouTube parse error:', e.message); return null }
}

function processTwitter(items, isDeep = false) {
  if (!items?.length) return null
  try {
    const user      = items.find(i => i.followersCount !== undefined) || items[0]
    const tweets    = items.filter(i => i.text !== undefined)
    const followers = user?.followersCount || 0
    const totalLikes = tweets.reduce((s, t) => s + (t.likeCount || t.favoriteCount || 0), 0)
    const avgLikes   = tweets.length ? Math.round(totalLikes / tweets.length) : 0

    const result = {
      followers, following: user?.followingCount || 0, bio: user?.description || '', avgLikes,
      topTweets: tweets.slice(0, isDeep ? 15 : 5).map(t => ({
        text: (t.text || '').slice(0, 280),
        likes: t.likeCount || t.favoriteCount || 0, retweets: t.retweetCount || 0,
        contentType: classifyContent(t.text || ''),
        hookType: classifyHook(t.text || ''),
        createdAt: t.createdAt || null,
      }))
    }

    if (isDeep) {
      result.deepAnalysis = {
        postingTimes: analyzePostingTimes(tweets, 'createdAt'),
        contentMix:   analyzeContentMix(tweets, 'text'),
        hookMix:      analyzeHookMix(tweets, 'text'),
        totalPostsAnalyzed: tweets.length,
      }
    }
    return result
  } catch (e) { console.error('Twitter parse error:', e.message); return null }
}

function processFacebook(pageItems, postItems, isDeep = false) {
  try {
    const page      = pageItems?.[0] || {}
    const followers = page.fans || page.followers || page.likesCount || 0
    const pageName  = page.title || page.name || ''
    const posts     = (postItems || []).filter(p => p.text !== undefined || p.likes !== undefined)
    const totalLikes    = posts.reduce((s, p) => s + (p.likes    || p.likesCount    || 0), 0)
    const totalComments = posts.reduce((s, p) => s + (p.comments || p.commentsCount || 0), 0)
    const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : 0
    const engagementRate = followers > 0 && posts.length > 0
      ? (((totalLikes + totalComments) / posts.length) / followers * 100).toFixed(2) : '0'

    const result = {
      followers, pageName, avgLikes, engagementRate,
      category: page.category || '', hasWebsite: !!(page.website),
      topPosts: posts.slice(0, isDeep ? 15 : 5).map(p => ({
        text: (p.text || '').slice(0, 300),
        likes: p.likes || p.likesCount || 0, comments: p.comments || p.commentsCount || 0,
        shares: p.shares || 0,
        contentType: classifyContent(p.text || ''),
        hookType: classifyHook(p.text || ''),
        time: p.time || p.publishedAt || null,
      }))
    }

    if (isDeep) {
      result.deepAnalysis = {
        postingTimes: analyzePostingTimes(posts, 'time'),
        contentMix:   analyzeContentMix(posts, 'text'),
        hookMix:      analyzeHookMix(posts, 'text'),
        totalPostsAnalyzed: posts.length,
      }
    }
    return result
  } catch (e) { console.error('Facebook parse error:', e.message); return null }
}

// ─── Website scan ─────────────────────────────────────────────────────────────
async function analyzeWebsite(url) {
  try {
    const apiKey = process.env.PAGESPEED_API_KEY
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&category=seo&category=accessibility&key=${apiKey}`
    const res  = await fetch(apiUrl, { signal: AbortSignal.timeout(25000) })
    const data = await res.json()
    if (!data.lighthouseResult) return null
    const lhr  = data.lighthouseResult
    const cats = lhr.categories
    const audits = lhr.audits
    return {
      performanceScore:   Math.round((cats.performance?.score   || 0) * 100),
      accessibilityScore: Math.round((cats.accessibility?.score || 0) * 100),
      coreWebVitals: {
        fcp: audits['first-contentful-paint']?.displayValue   || 'N/A',
        lcp: audits['largest-contentful-paint']?.displayValue || 'N/A',
        tbt: audits['total-blocking-time']?.displayValue      || 'N/A',
        cls: audits['cumulative-layout-shift']?.displayValue  || 'N/A',
      },
      technical: {
        hasHttps:        url.startsWith('https'),
        mobileOptimized: audits['viewport']?.score === 1,
        noIntrusive:     audits['intrusive-interstitials']?.score === 1,
        fontSizeOk:      audits['font-size']?.score === 1,
      }
    }
  } catch (e) { console.error('PageSpeed error:', e.message); return null }
}

function decodeHTMLEntities(str) {
  if (!str) return str
  return str
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(n))
    .replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCharCode(parseInt(h,16)))
}

async function analyzeContent(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VelyrBot/1.0)' }, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const html    = await res.text()
    const rawText = html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()
    const isSPA   = rawText.split(/\s+/).filter(Boolean).length < 50
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title      = decodeHTMLEntities(titleMatch?.[1]?.trim() || '')
    const descMatch  = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
                    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i)
    const metaDesc   = decodeHTMLEntities(descMatch?.[1]?.trim() || '')
    // FIX 4: strip script/template/noscript/comment blocks before counting H1s,
    // otherwise inline templates and SEO-noscript content inflate the count.
    const htmlForH1 = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<template[\s\S]*?<\/template>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
    const h1Match    = htmlForH1.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || []
    const h1s        = h1Match.map(h => decodeHTMLEntities(h.replace(/<[^>]+>/g,'').trim())).filter(Boolean)
    const imgTags    = html.match(/<img[^>]+>/gi) || []
    const imgsWithoutAlt  = imgTags.filter(t => !t.match(/alt=["'][^"']*["']/i)).length
    const imgAltScore     = imgTags.length > 0 ? Math.round(((imgTags.length - imgsWithoutAlt) / imgTags.length) * 100) : 100
    const canonicalPresent = /<link[^>]*rel=["']canonical["']/i.test(html)
    const ogTitlePresent   = /<meta[^>]*property=["']og:title["']/i.test(html)
    const ogDescPresent    = /<meta[^>]*property=["']og:description["']/i.test(html)
    const structuredData   = html.includes('"@context"') || html.includes("'@context'")
    const hasCTA           = /buy now|get started|sign up|try free|book|schedule|contact us|shop now|order|subscribe|join|start free|get access|claim/i.test(html)
    const hasSocialProof   = /testimonial|review|rating|customer|client|trust|verified|guarantee|result|success|transform/i.test(html)
    const hasPriceVisible  = /\$[\d,.]+|€[\d,.]+|£[\d,.]+|per month|\/mo|one.time|free trial/i.test(html)
    const heroHeadline     = h1s[0] || ''
    const isOutcomeFocused = heroHeadline ? /you|your|get|achieve|become|stop|start|finally|without|results|faster|easier|transform/i.test(heroHeadline) : false
    const wordCount        = rawText.split(/\s+/).filter(Boolean).length

    let seoScore = 0
    if (title && title.length >= 30 && title.length <= 65) seoScore += 18; else if (title) seoScore += 9
    if (metaDesc && metaDesc.length >= 120 && metaDesc.length <= 160) seoScore += 18; else if (metaDesc) seoScore += 9
    if (h1s.length === 1) seoScore += 15; else if (h1s.length > 1) seoScore += 7
    if (imgAltScore >= 80) seoScore += 12; else if (imgAltScore >= 50) seoScore += 6
    if (canonicalPresent)           seoScore += 8
    if (ogTitlePresent && ogDescPresent) seoScore += 10
    if (structuredData)             seoScore += 9

    let copyScore = 0
    if (isOutcomeFocused)      copyScore += 25
    if (hasCTA)                copyScore += 25
    if (hasSocialProof)        copyScore += 20
    if (hasPriceVisible)       copyScore += 15
    if (wordCount > 300)       copyScore += 10
    if (heroHeadline.length > 10) copyScore += 5

    const ctaButtons = (html.match(/<(?:button|a)[^>]*>([^<]{3,40})<\/(?:button|a)>/gi) || [])
      .map(b => b.replace(/<[^>]+>/g,'').trim()).filter(t => t.length > 2 && t.length < 50).slice(0, 5)

    return {
      seo:  { score: Math.min(100,seoScore), title, titleLength: title.length, metaDesc, metaDescLength: metaDesc.length, h1s, imgAltScore, imgsWithoutAlt, canonicalPresent, ogTitlePresent, ogDescPresent, structuredData, issues: [] },
      copy: { score: Math.min(100,copyScore), isSPA, heroHeadline, isOutcomeFocused, hasCTA, ctaButtons, hasSocialProof, hasPriceVisible, wordCount, issues: [] },
      rawText: rawText.slice(0, 3000)
    }
  } catch (e) { console.error('Content analysis error:', e.message); return null }
}

// ─── Industry & benchmarks ────────────────────────────────────────────────────
const BENCHMARKS = {
  fitness:   { tiktokEng:4.8, igEng:3.2, ytEng:2.1, fbEng:1.2, avgViews:15000, label:'Fitness & Health' },
  coaching:  { tiktokEng:3.9, igEng:2.8, ytEng:1.8, fbEng:0.9, avgViews:8000,  label:'Coaching & Education' },
  ecommerce: { tiktokEng:2.1, igEng:1.9, ytEng:0.9, fbEng:0.7, avgViews:5000,  label:'E-Commerce' },
  saas:      { tiktokEng:1.8, igEng:1.4, ytEng:1.2, fbEng:0.5, avgViews:3000,  label:'SaaS / Tech' },
  creator:   { tiktokEng:5.2, igEng:3.8, ytEng:2.4, fbEng:1.5, avgViews:25000, label:'Content Creator' },
  food:      { tiktokEng:6.1, igEng:4.2, ytEng:2.8, fbEng:1.8, avgViews:20000, label:'Food & Lifestyle' },
  beauty:    { tiktokEng:5.5, igEng:4.0, ytEng:2.2, fbEng:1.4, avgViews:18000, label:'Beauty & Fashion' },
  default:   { tiktokEng:3.5, igEng:2.5, ytEng:1.5, fbEng:0.8, avgViews:8000,  label:'General Business' },
}

function detectIndustry(url, copy) {
  const text = (url+' '+(copy?.heroHeadline||'')+' '+(copy?.rawText||'')).toLowerCase()
  // Automotive check FIRST — must come before fitness to prevent motorsport/sportscar false positives
  if (/\bcar\b|\bcars\b|motorsport|automobile|automotive|vehicle|\bsuv\b|\bvan\b|turbo|horsepower|dealership|autohaus|fahrzeug|kfz|gebrauchtwagen|neuwagen|pkw|tuning|racing|\bdrive\b.*\bcar|forum.*auto|auto.*forum/.test(text)) return 'default'
  // Fitness — removed generic "sport" and "train" which cause false positives on automotive/sports forums
  if (/fitness|workout|\bgym\b|bodybuilding|health coach|weight loss|\bmuscle\b|personal train|nutrition plan/.test(text)) return 'fitness'
  if (/\bcoach\b|mentor|online course|learn|\bteach\b|educat|\bprogram\b.*skill|\blesson/.test(text)) return 'coaching'
  if (/\bshop\b|\bstore\b|\bproduct\b|\bbuy\b|\bcart\b|\border\b|shipping|checkout|ecommerce/.test(text)) return 'ecommerce'
  if (/saas|\bsoftware\b|\bapi\b|dashboard|platform|\btool\b|\bapp\b.*subscription/.test(text))      return 'saas'
  if (/\bcreator\b|\bcontent\b.*creat|\bpodcast\b|newsletter|\bstreamer/.test(text))                 return 'creator'
  if (/\bfood\b|\brecipe\b|restaurant|\bcafe\b|\bcook\b|\beat\b|cuisine/.test(text))                 return 'food'
  if (/beauty|makeup|\bfashion\b|skincare|\bhair salon\b|cosmetic/.test(text))                       return 'beauty'
  return 'default'
}

function approxPercentile(value, benchmark, spread = 0.6) {
  if (!value || !benchmark) return null
  const z = (Math.log(Math.max(value,0.001)) - Math.log(Math.max(benchmark,0.001))) / spread
  return Math.min(99, Math.max(1, Math.round(100 / (1 + Math.exp(-1.7 * z)))))
}

function buildBenchmarkInsights(industry, tiktok, instagram, youtube, twitter, facebook) {
  const bench = BENCHMARKS[industry] || BENCHMARKS.default
  const insights = []
  const push = (platform, metric, yours, benchVal, unit = '') => {
    const er   = parseFloat(yours)
    if (isNaN(er)) return
    const pct  = approxPercentile(er, benchVal)
    const diff = ((er - benchVal) / benchVal * 100).toFixed(0)
    insights.push({ platform, metric, yours: `${yours}${unit}`, benchmark: `${benchVal}${unit}`, diff: Math.abs(diff)+'%', direction: er >= benchVal ? 'above' : 'below', percentile: pct, percentileLabel: pct ? `Better than ${pct}% of ${bench.label} accounts` : null })
  }
  if (tiktok?.engagementRate)   push('TikTok',    'Engagement Rate', tiktok.engagementRate,    bench.tiktokEng, '%')
  if (tiktok?.avgViews)         push('TikTok',    'Avg. Views',      tiktok.avgViews,           bench.avgViews)
  if (instagram?.engagementRate) push('Instagram', 'Engagement Rate', instagram.engagementRate,  bench.igEng, '%')
  if (facebook?.engagementRate)  push('Facebook',  'Engagement Rate', facebook.engagementRate,   bench.fbEng, '%')

  return {
    benchmarks: insights, industry, industryLabel: bench.label,
    tiktokIsNewAccount:    tiktok    ? (tiktok.followers    < 500  && tiktok.videoCount    < 15) : false,
    instagramIsNewAccount: instagram ? (instagram.followers < 200  && instagram.postsCount < 10) : false,
    facebookIsNewAccount:  facebook  ? (facebook.followers  < 500  && (facebook.topPosts?.length||0) < 10) : false,
  }
}

function calcScore(perf, content, social) {
  let score = 0, factors = 0
  if (perf)         { score += Math.round((perf.performanceScore*0.6)+(perf.accessibilityScore*0.4))*0.20; factors+=0.20 }
  if (content?.seo)  { score += content.seo.score *0.20; factors+=0.20 }
  if (content?.copy) { score += content.copy.score*0.20; factors+=0.20 }
  if (social.tiktok) {
    const er=parseFloat(social.tiktok.engagementRate)||0, isNew=(social.tiktok.followers||0)<500&&(social.tiktok.videoCount||0)<15
    const ts=isNew?50:Math.min(100,Math.round((er>5?50:er>3?38:er>1?24:10)+(social.tiktok.avgViews>50000?50:social.tiktok.avgViews>10000?35:social.tiktok.avgViews>1000?20:5)))
    score+=ts*0.20; factors+=0.20
  }
  if (social.instagram) {
    const er=parseFloat(social.instagram.engagementRate)||0, isNew=(social.instagram.followers||0)<200&&(social.instagram.postsCount||0)<10
    const is_=isNew?50:Math.min(100,Math.round((er>5?50:er>3?38:er>1?24:10)+(social.instagram.followers>50000?50:social.instagram.followers>10000?35:social.instagram.followers>1000?20:5)))
    score+=is_*0.20; factors+=0.20
  }
  if (social.youtube) {
    const s=social.youtube.subscribers||0,v=social.youtube.avgViews||0
    score+=Math.min(100,Math.round((s>100000?50:s>10000?38:s>1000?24:s>100?12:5)+(v>50000?50:v>10000?35:v>1000?20:5)))*0.10; factors+=0.10
  }
  if (social.twitter) {
    score+=Math.min(100,Math.round(social.twitter.followers>100000?90:social.twitter.followers>10000?70:social.twitter.followers>1000?45:social.twitter.followers>100?20:8))*0.10; factors+=0.10
  }
  if (social.linkedin) {
    const c=social.linkedin.connections||social.linkedin.followers||0
    score+=Math.min(100,Math.round(c>5000?85:c>1000?65:c>500?45:c>100?25:10))*0.10; factors+=0.10
  }
  if (social.facebook) {
    const er=parseFloat(social.facebook.engagementRate)||0
    score+=Math.min(100,Math.round((er>3?50:er>1?35:er>0.5?20:8)+(social.facebook.followers>50000?50:social.facebook.followers>10000?35:social.facebook.followers>1000?20:5)))*0.10; factors+=0.10
  }
  return factors>0 ? Math.round(score/factors) : 0
}

// ─── LinkedIn processor (profile only, no deep) ───────────────────────────────
function processLinkedIn(items) {
  if (!items?.length) return null
  try {
    const profile = items[0]
    return {
      followers: profile.followersCount || profile.connectionsCount || 0,
      name: profile.fullName || profile.name || '',
      headline: profile.headline || '',
      connections: profile.connectionsCount || 0,
      posts: profile.posts?.length || 0,
    }
  } catch (e) { console.error('LinkedIn parse error:', e.message); return null }
}

// ─── SSRF GUARD ──────────────────────────────────────────────────────────────
function isPrivateOrLocalUrl(rawUrl) {
  let host
  try {
    host = new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return true
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') return true
  const v6 = host.replace(/^\[|\]$/g, '')
  if (v6 === '::1') return true
  if (/^fe80:/i.test(v6) || /^fc[0-9a-f]{2}:/i.test(v6) || /^fd[0-9a-f]{2}:/i.test(v6)) return true
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10)
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
  }
  return false
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await checkPremiumAccess(req, res)
  if (!user) return

  const { websiteUrl, handles = {}, focusPlatform = null } = req.body
  if (!websiteUrl) return res.status(400).json({ error: 'websiteUrl required' })

  const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`

  if (isPrivateOrLocalUrl(url)) {
    return res.status(400).json({
      error: 'invalid_url',
      message: 'This URL points to a private or local network address and cannot be scanned.',
    })
  }
  const tiktokHandle  = cleanHandle(handles.tiktok)
  const igHandle      = cleanHandle(handles.instagram)
  const ytHandle      = cleanHandle(handles.youtube)
  const twitterHandle = cleanHandle(handles.twitter)
  const fbHandle      = cleanHandle(handles.facebook)
  const linkedinHandle = cleanHandle(handles.linkedin)

  const deep  = (p) => focusPlatform === p
  const limit = (p, d = 30, s = 5) => deep(p) ? d : s

  console.log('Premium scan:', url, { focusPlatform, tiktokHandle, igHandle, ytHandle, twitterHandle, fbHandle })

  const apifyErrors = []
  const guestSessionId = req.headers['x-session-id'] || null

  const [perf, content, tiktokRaw, igRaw, ytRaw, twitterRaw, fbPageRaw, fbPostsRaw, linkedinRaw] = await Promise.all([
    withTimeout(analyzeWebsite(url), 25000, null),
    withTimeout(analyzeContent(url), 12000, null),
    tiktokHandle  ? withTimeout(runApify('clockworks/tiktok-scraper',
        { profiles:[tiktokHandle], resultsPerPage:limit('tiktok'), shouldDownloadVideos:false, shouldDownloadCovers:false }, apifyErrors), 55000, null) : Promise.resolve(null),
    igHandle      ? withTimeout(runApify('apify/instagram-scraper',
        { usernames:[igHandle], resultsLimit:limit('instagram') }, apifyErrors), 55000, null) : Promise.resolve(null),
    ytHandle      ? withTimeout(runApify('streamers/youtube-scraper',
        { startUrls:[{url:`https://www.youtube.com/@${ytHandle}`}], maxResults:limit('youtube') }, apifyErrors), 55000, null) : Promise.resolve(null),
    twitterHandle ? withTimeout(runApify('apidojo/twitter-scraper-lite',
        { twitterHandles:[twitterHandle], maxItems:limit('twitter') }, apifyErrors), 55000, null) : Promise.resolve(null),
    fbHandle      ? withTimeout(runApify('apify/facebook-pages-scraper',
        { startUrls:[{url:`https://www.facebook.com/${fbHandle}`}] }, apifyErrors), 55000, null) : Promise.resolve(null),
    fbHandle      ? withTimeout(runApify('apify/facebook-posts-scraper',
        { startUrls:[{url:`https://www.facebook.com/${fbHandle}`}], maxPosts:limit('facebook') }, apifyErrors), 55000, null) : Promise.resolve(null),
    linkedinHandle ? withTimeout(runApify('dev_fusion/Linkedin-Profile-Scraper',
        { profileUrls:[`https://www.linkedin.com/in/${linkedinHandle}`] }, apifyErrors), 55000, null) : Promise.resolve(null),
  ])

  if (apifyErrors.length > 0) {
    console.error('Apify failure(s) detected for premium scan:', JSON.stringify(apifyErrors))

    let refundIssued = false
    try {
      if (stripe && guestSessionId) {
        const session = await stripe.checkout.sessions.retrieve(guestSessionId)
        const paymentIntentId = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id
        if (paymentIntentId) {
          const refund = await stripe.refunds.create({ payment_intent: paymentIntentId })
          refundIssued = true
          console.log('Stripe refund issued for session', guestSessionId, 'refund id:', refund.id)
        } else {
          console.error('Apify refund: no payment_intent on session', guestSessionId)
        }
      } else {
        console.error('Apify refund: no stripe client or session id available (logged-in user or missing config) — manual refund required')
      }
    } catch (refundErr) {
      console.error('Apify refund failed:', refundErr.message, refundErr.stack)
    }

    return res.status(502).json({
      error: 'scan_failed',
      message: refundIssued
        ? 'Something went wrong with your scan. You will receive a full refund within 3-5 business days. Contact us at info@velyr.io if you have questions.'
        : 'Something went wrong with your scan. Please contact us at info@velyr.io for a refund.',
      refundIssued,
    })
  }

  if (!perf && !content) return res.status(422).json({ error:'unreachable', message:"Couldn't reach this website." })

  const tiktok    = processTikTok(tiktokRaw,           deep('tiktok'))
  const instagram = processInstagram(igRaw,            deep('instagram'))
  const youtube   = processYouTube(ytRaw,              deep('youtube'))
  const twitter   = processTwitter(twitterRaw,         deep('twitter'))
  const facebook  = processFacebook(fbPageRaw, fbPostsRaw, deep('facebook'))
  const linkedin  = processLinkedIn(linkedinRaw)

  const industry      = detectIndustry(url, content?.copy)
  const benchmarkData = buildBenchmarkInsights(industry, tiktok, instagram, youtube, twitter, facebook)
  if (perf) {
    const perfPct = approxPercentile(perf.performanceScore, 45, 0.7)
    benchmarkData.perfPercentile = perfPct
    benchmarkData.perfSlowerThan = perfPct ? 100 - perfPct : null
  }

  const score = calcScore(perf, content, { tiktok, instagram, youtube, twitter, facebook })
  console.log('Done. Score:', score, '| Focus:', focusPlatform)

  res.status(200).json({
    score, website: perf, content,
    tiktok, instagram, youtube, twitter, facebook, linkedin,
    focusPlatform, benchmarkData,
    scannedAt: new Date().toISOString(),
  })
}