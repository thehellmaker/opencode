/**
 * "Did you mean?" suggestions for tools and files.
 */

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

export function suggestSimilar(
  attempted: string,
  available: string[],
  maxDistance: number = 3,
  maxSuggestions: number = 3
): string[] {
  return available
    .map((name) => ({
      name,
      distance: levenshteinDistance(attempted.toLowerCase(), name.toLowerCase()),
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => {
      // Sort by distance first, then alphabetically
      if (a.distance !== b.distance) {
        return a.distance - b.distance
      }
      return a.name.localeCompare(b.name)
    })
    .slice(0, maxSuggestions)
    .map(({ name }) => name)
}

export function formatSuggestions(attempted: string, suggestions: string[]): string {
  if (suggestions.length === 0) {
    return `'${attempted}' not found.`
  }

  if (suggestions.length === 1) {
    return `'${attempted}' not found. Did you mean '${suggestions[0]}'?`
  }

  return `'${attempted}' not found. Did you mean: ${suggestions.map((s) => `'${s}'`).join(', ')}?`
}

/**
 * Find similar tool names.
 */
export function suggestTools(attempted: string, availableTools: string[]): string[] {
  return suggestSimilar(attempted, availableTools)
}

/**
 * Find similar file paths.
 */
export function suggestFiles(attempted: string, availableFiles: string[]): string[] {
  // For file paths, be more lenient with distance
  return suggestSimilar(attempted, availableFiles, 5, 5)
}

/**
 * Check if a string is a partial match (prefix).
 */
export function findPrefixMatches(prefix: string, available: string[], maxResults: number = 10): string[] {
  const lowerPrefix = prefix.toLowerCase()

  return available
    .filter((item) => item.toLowerCase().startsWith(lowerPrefix))
    .sort((a, b) => {
      // Prefer shorter matches
      if (a.length !== b.length) {
        return a.length - b.length
      }
      return a.localeCompare(b)
    })
    .slice(0, maxResults)
}
