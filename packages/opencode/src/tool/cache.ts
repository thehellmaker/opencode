/**
 * Tool output caching for read-only operations.
 * Reduces redundant executions and improves performance.
 */

interface CacheEntry {
  result: any
  timestamp: number
}

const cache = new Map<string, CacheEntry>()

export function getCacheKey(toolName: string, params: any): string {
  return `${toolName}:${JSON.stringify(params)}`
}

export async function executeWithCache<T>(
  toolName: string,
  params: any,
  fn: () => Promise<T>,
  cacheTTL: number = 60000 // 1 minute default
): Promise<T> {
  const key = getCacheKey(toolName, params)
  const cached = cache.get(key)

  // Return cached result if still fresh
  if (cached && Date.now() - cached.timestamp < cacheTTL) {
    return cached.result as T
  }

  // Execute and cache
  const result = await fn()
  cache.set(key, { result, timestamp: Date.now() })

  return result
}

export function clearCache(toolName?: string): void {
  if (toolName) {
    // Clear cache for specific tool
    for (const key of cache.keys()) {
      if (key.startsWith(`${toolName}:`)) {
        cache.delete(key)
      }
    }
  } else {
    // Clear all cache
    cache.clear()
  }
}

export function getCacheStats(): { size: number; tools: Record<string, number> } {
  const tools: Record<string, number> = {}

  for (const key of cache.keys()) {
    const toolName = key.split(':')[0]
    tools[toolName] = (tools[toolName] || 0) + 1
  }

  return {
    size: cache.size,
    tools,
  }
}
