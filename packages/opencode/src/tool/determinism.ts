/**
 * Determinism verification for tool outputs.
 * Detects when the same tool call with same params returns different results.
 */

interface ExecutionRecord {
  result: any
  timestamp: number
  hash: string
}

const executionHistory = new Map<string, ExecutionRecord>()

// Tools that should be deterministic
const DETERMINISTIC_TOOLS = new Set(['read', 'glob', 'grep'])

function hashResult(result: any): string {
  return JSON.stringify(result)
}

function getCacheKey(toolName: string, params: any): string {
  return `${toolName}:${JSON.stringify(params)}`
}

export function isDeterministicTool(toolName: string): boolean {
  return DETERMINISTIC_TOOLS.has(toolName)
}

export async function verifyDeterminism(toolName: string, params: any, result: any): Promise<void> {
  if (!isDeterministicTool(toolName)) {
    return
  }

  const key = getCacheKey(toolName, params)
  const resultHash = hashResult(result)
  const previous = executionHistory.get(key)

  if (previous && previous.hash !== resultHash) {
    console.warn(
      `⚠️  Determinism violation detected in tool '${toolName}':\n` +
        `   Same inputs produced different outputs.\n` +
        `   Previous execution: ${new Date(previous.timestamp).toISOString()}\n` +
        `   Current execution: ${new Date().toISOString()}\n` +
        `   This may indicate:\n` +
        `   - File changes between calls\n` +
        `   - Flaky tool behavior\n` +
        `   - Non-deterministic output formatting\n`
    )
  }

  executionHistory.set(key, {
    result,
    timestamp: Date.now(),
    hash: resultHash,
  })
}

export function clearDeterminismHistory(toolName?: string): void {
  if (toolName) {
    for (const key of executionHistory.keys()) {
      if (key.startsWith(`${toolName}:`)) {
        executionHistory.delete(key)
      }
    }
  } else {
    executionHistory.clear()
  }
}

export function getDeterminismStats(): {
  trackedCalls: number
  tools: Record<string, number>
} {
  const tools: Record<string, number> = {}

  for (const key of executionHistory.keys()) {
    const toolName = key.split(':')[0]
    tools[toolName] = (tools[toolName] || 0) + 1
  }

  return {
    trackedCalls: executionHistory.size,
    tools,
  }
}

/**
 * Enable or disable determinism checking.
 */
let enabled = true

export function enableDeterminismChecking(): void {
  enabled = true
}

export function disableDeterminismChecking(): void {
  enabled = false
}

export function isDeterminismCheckingEnabled(): boolean {
  return enabled
}
