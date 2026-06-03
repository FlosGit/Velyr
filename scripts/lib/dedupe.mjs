// Near-duplicate detector. Scaffolded in PR 1 (Stage 1); it only earns its keep
// at bulk scale (~540 drafts), but it runs on every build so duplication is
// caught the moment it is introduced, not after publish.
//
// Method: strip each article body to plain text, build a set of k-word shingles,
// and compute pairwise Jaccard similarity. Two thresholds:
//   - WARN: print a warning (likely overlapping angle, worth a human look)
//   - FAIL: throw and break the build (effectively duplicate content)
//
// Thresholds are deliberately conservative for now; tune once real bulk content
// exists. Distinct clusters should sit well under WARN.

// Tightened for the C1 framework×surface family (~120 articles, highest near-dup
// risk): two articles at the old 0.8 Jaccard were effectively the same page. A
// real calibration pass against the first bulk batch will revisit these; for now
// they are deliberately strict so the gate can't wave a near-dupe through.
export const SHINGLE_SIZE = 8
export const WARN_THRESHOLD = 0.35
export const FAIL_THRESHOLD = 0.55

function toPlainText(html) {
  return String(html)
    .replace(/<[^>]+>/g, ' ')      // strip tags
    .replace(/&[a-z]+;/gi, ' ')    // strip entities
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function shingles(text, k = SHINGLE_SIZE) {
  const words = text.split(' ').filter(Boolean)
  const set = new Set()
  if (words.length < k) {
    // Very short body: fall back to the whole thing as one shingle.
    if (words.length) set.add(words.join(' '))
    return set
  }
  for (let i = 0; i + k <= words.length; i++) {
    set.add(words.slice(i, i + k).join(' '))
  }
  return set
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  const [small, large] = a.size < b.size ? [a, b] : [b, a]
  for (const s of small) if (large.has(s)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

// articles: [{ slug, contentHtml }]. Returns { warnings: [...] } or throws on FAIL.
export function checkDuplicates(articles) {
  const fingerprints = articles.map((a) => ({
    slug: a.slug,
    shingles: shingles(toPlainText(a.contentHtml)),
  }))

  const warnings = []
  const failures = []

  for (let i = 0; i < fingerprints.length; i++) {
    for (let j = i + 1; j < fingerprints.length; j++) {
      const sim = jaccard(fingerprints[i].shingles, fingerprints[j].shingles)
      if (sim >= FAIL_THRESHOLD) {
        failures.push(
          `${fingerprints[i].slug} ↔ ${fingerprints[j].slug}: ${(sim * 100).toFixed(0)}% similar (>= ${FAIL_THRESHOLD * 100}% fail threshold)`
        )
      } else if (sim >= WARN_THRESHOLD) {
        warnings.push(
          `${fingerprints[i].slug} ↔ ${fingerprints[j].slug}: ${(sim * 100).toFixed(0)}% similar (>= ${WARN_THRESHOLD * 100}% warn threshold)`
        )
      }
    }
  }

  if (failures.length) {
    throw new Error(
      'blog: near-duplicate content detected:\n  ' + failures.join('\n  ')
    )
  }
  return { warnings }
}
