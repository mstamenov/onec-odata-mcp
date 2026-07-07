/** Fields whose names suggest secrets — excluded from fuzzy suggestions. */
const SECRET_FIELD_PATTERN =
  /password|passwd|secret|token|apikey|api_key|credentials|privatekey|private_key/i

export function isSecretFieldName(name: string): boolean {
  return SECRET_FIELD_PATTERN.test(name)
}

export function isSecretEntityName(name: string): boolean {
  return SECRET_FIELD_PATTERN.test(name)
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

export function fuzzySuggestions(
  query: string,
  candidates: string[],
  options: { limit?: number; excludeSecrets?: boolean } = {},
): string[] {
  const { limit = 3, excludeSecrets = true } = options
  const q = query.trim()
  if (!q) return []

  const filtered = candidates.filter((c) => {
    if (excludeSecrets && (isSecretFieldName(c) || isSecretEntityName(c))) return false
    return true
  })

  const scored = filtered
    .map((candidate) => {
      const lowerQ = q.toLowerCase()
      const lowerC = candidate.toLowerCase()
      let score = levenshtein(lowerQ, lowerC)
      if (lowerC.includes(lowerQ)) score -= 5
      if (lowerC.startsWith(lowerQ)) score -= 3
      return { candidate, score }
    })
    .filter(({ score }) => score <= Math.max(8, Math.floor(q.length * 0.6)))
    .sort((a, b) => a.score - b.score)

  return scored.slice(0, limit).map((s) => s.candidate)
}

export function maybeYouMeant(query: string, candidates: string[]): string | undefined {
  const suggestions = fuzzySuggestions(query, candidates)
  if (suggestions.length === 0) return undefined
  return `Возможно, вы имели в виду: ${suggestions.join(', ')}`
}
