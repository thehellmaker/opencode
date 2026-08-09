/**
 * Automatic retry logic for transient failures.
 */

export interface RetryOptions {
  maxAttempts?: number
  initialDelay?: number
  backoff?: 'exponential' | 'linear' | 'constant'
  isRetryable?: (error: any) => boolean
  onRetry?: (attempt: number, error: any) => void
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTransientError(error: any): boolean {
  if (!error) return false

  // Network errors
  if (error.code === 'ETIMEDOUT') return true
  if (error.code === 'ECONNRESET') return true
  if (error.code === 'ECONNREFUSED') return true
  if (error.code === 'ENETUNREACH') return true

  // HTTP errors
  if (error.statusCode === 429) return true // Rate limit
  if (error.statusCode === 502) return true // Bad gateway
  if (error.statusCode === 503) return true // Service unavailable
  if (error.statusCode === 504) return true // Gateway timeout

  // Message-based detection
  const message = error.message?.toLowerCase() || ''
  if (message.includes('rate limit')) return true
  if (message.includes('temporarily unavailable')) return true
  if (message.includes('timeout')) return true
  if (message.includes('connection reset')) return true

  return false
}

export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    backoff = 'exponential',
    isRetryable = isTransientError,
    onRetry,
  } = options

  let lastError: any
  let delay = initialDelay

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Don't retry if this is the last attempt or error is not retryable
      if (attempt === maxAttempts || !isRetryable(error)) {
        throw error
      }

      // Notify about retry
      if (onRetry) {
        onRetry(attempt, error)
      }

      // Wait before retry
      await sleep(delay)

      // Adjust delay for next attempt
      if (backoff === 'exponential') {
        delay *= 2
      } else if (backoff === 'linear') {
        delay += initialDelay
      }
      // 'constant' keeps same delay
    }
  }

  throw lastError
}

/**
 * Retry with progress logging
 */
export async function executeWithRetryAndLog<T>(
  fn: () => Promise<T>,
  operationName: string,
  options: RetryOptions = {}
): Promise<T> {
  return executeWithRetry(fn, {
    ...options,
    onRetry: (attempt, error) => {
      console.log(
        `Retry ${attempt}/${options.maxAttempts || 3} for ${operationName}: ${error.message || error}`
      )
      if (options.onRetry) {
        options.onRetry(attempt, error)
      }
    },
  })
}
