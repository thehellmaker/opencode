# Integration Guide for Utility Modules

This guide shows how to integrate the utility modules (cache, retry, suggestions, determinism) into OpenCode tools.

---

## Module 1: cache.ts - Tool Output Caching

### Purpose
Cache read-only tool outputs to avoid redundant executions.

### Integration Points

#### Option A: Tool-Level (Recommended for simple tools)

**File:** `packages/opencode/src/tool/read.ts`

Add at top:
```typescript
import { executeWithCache } from './cache'
```

Wrap the main execution logic:
```typescript
// Before:
const result = await fs.readFile(filePath)

// After:
const result = await executeWithCache(
  'read',
  { filePath, offset, limit },
  async () => await fs.readFile(filePath),
  30000 // 30 second TTL for files
)
```

**Apply to:**
- `read.ts` - Cache file reads (30s TTL)
- `grep.ts` - Cache search results (60s TTL)
- `glob.ts` - Cache file listings (60s TTL)

#### Option B: Registry-Level (Alternative approach)

**File:** `packages/opencode/src/tool/registry.ts`

Wrap tool execution in the registry:
```typescript
import { executeWithCache, getCacheKey } from './cache'

// In tool execute wrapper:
const isCacheable = ['read', 'grep', 'glob'].includes(toolName)

if (isCacheable) {
  return await executeWithCache(toolName, params, 
    () => originalExecute(params, ctx),
    60000
  )
} else {
  return await originalExecute(params, ctx)
}
```

This approach caches at the registry level without modifying individual tools.

---

## Module 2: retry.ts - Automatic Retry

### Purpose
Automatically retry transient failures (network timeouts, rate limits, etc.)

### Integration Points

#### Shell Tool

**File:** `packages/opencode/src/tool/shell.ts`

Add at top:
```typescript
import { executeWithRetryAndLog } from './retry'
```

Wrap shell execution:
```typescript
// In execute function, wrap the spawn/exec call:
const result = await executeWithRetryAndLog(
  async () => {
    // existing shell execution logic
    return await Shell.exec(command, options)
  },
  `shell: ${command}`,
  {
    maxAttempts: 3,
    backoff: 'exponential',
    initialDelay: 1000
  }
)
```

#### WebFetch Tool

**File:** `packages/opencode/src/tool/webfetch.ts`

Add at top:
```typescript
import { executeWithRetryAndLog } from './retry'
```

Wrap fetch call:
```typescript
const response = await executeWithRetryAndLog(
  async () => await fetch(url, options),
  `fetch: ${url}`,
  {
    maxAttempts: 3,
    backoff: 'exponential',
    isRetryable: (error) => {
      // Retry on network errors and 5xx, but not 4xx
      if (error.code === 'ETIMEDOUT') return true
      if (error.statusCode >= 500) return true
      if (error.statusCode === 429) return true // Rate limit
      return false
    }
  }
)
```

---

## Module 3: suggestions.ts - "Did You Mean?"

### Purpose
Show helpful suggestions when tools/files are not found.

### Integration Point

**File:** `packages/opencode/src/tool/registry.ts`

Add at top:
```typescript
import { suggestTools, formatSuggestions } from './suggestions'
```

Find where tool-not-found errors are thrown (in `tools()` function):

```typescript
// Current code throws generic error:
throw new Error(`Tool '${toolName}' not found`)

// Enhanced with suggestions:
const allToolNames = (await all()).map(tool => tool.id)
const suggestions = suggestTools(toolName, allToolNames)

if (suggestions.length > 0) {
  throw new Error(formatSuggestions(toolName, suggestions))
} else {
  throw new Error(`Tool '${toolName}' not found. Available tools: ${allToolNames.slice(0, 5).join(', ')}...`)
}
```

### File-Not-Found Enhancement

**File:** `packages/opencode/src/tool/read.ts`

The read tool already has suggestion logic in the `miss` function (line 76-99). It can be enhanced:

```typescript
import { suggestFiles, formatSuggestions } from './suggestions'

// In miss function, replace the existing fuzzy match with:
const items = yield* fs.readDirectory(dir).pipe(
  Effect.map((items) => {
    const fullPaths = items.map((item) => path.join(dir, item))
    const suggestions = suggestFiles(filepath, fullPaths)
    return suggestions
  }),
  Effect.catch(() => Effect.succeed([] as string[])),
)

if (items.length > 0) {
  return yield* Effect.fail(
    new Error(formatSuggestions(filepath, items))
  )
}
```

---

## Module 4: determinism.ts - Detect Flaky Tools

### Purpose
Warn when deterministic tools return different results for the same inputs.

### Integration Point

**File:** `packages/opencode/src/tool/tool.ts` or `registry.ts`

Add at top:
```typescript
import { verifyDeterminism, isDeterministicTool } from './determinism'
```

Wrap tool execution (in registry or tool.ts):
```typescript
// After tool execution completes:
const result = await tool.execute(params, ctx)

// Verify determinism for applicable tools
if (isDeterministicTool(tool.id)) {
  await verifyDeterminism(tool.id, params, result)
}

return result
```

This will log warnings when the same tool with same parameters returns different results.

### Disable for Eval Runs

```typescript
import { enableDeterminismChecking, disableDeterminismChecking } from './determinism'

// At start of eval run:
disableDeterminismChecking()

// At end of eval run:
enableDeterminismChecking()
```

---

## Integration Priority

### Quick Wins (30 minutes each)

1. **Suggestions** - Add to registry.ts tool-not-found error
2. **Determinism** - Add to tool execution wrapper

### Medium Effort (1-2 hours each)

3. **Retry** - Add to shell.ts and webfetch.ts
4. **Cache** - Add to read.ts, grep.ts, glob.ts OR registry-level wrapper

---

## Testing Integration

### Test Cache

```bash
# In OpenCode session:
read("package.json")  # First call - slow
read("package.json")  # Second call - instant (cached)
# Wait 60 seconds
read("package.json")  # Third call - slow (cache expired)
```

### Test Retry

```bash
# Simulate network timeout
shell("curl --max-time 1 https://httpstat.us/200?sleep=5000")
# Should see 3 retry attempts in logs
```

### Test Suggestions

```bash
# Try misspelled tool
raed("file.txt")  # Should suggest: "Did you mean 'read'?"
grp("pattern")    # Should suggest: "Did you mean 'grep'?"
```

### Test Determinism

```bash
# Read same file twice
read("package.json")
read("package.json")
# Should see no warnings

# If file changes between calls, should warn about non-determinism
```

---

## Advanced: Streaming Progress

**Status:** Not yet implemented (requires runtime changes)

**What it needs:**
1. Progress event protocol in `stream.transport.ts`
2. Tool execution hooks to emit progress
3. UI rendering in footer

**Example design:**
```typescript
// In long-running tool:
emitProgress({ toolID, message: 'Starting...', percentage: 0 })
// do work
emitProgress({ toolID, message: 'Processing...', percentage: 50 })
// more work
emitProgress({ toolID, message: 'Complete', percentage: 100 })
```

---

## Advanced: Auto-Compaction

**Status:** Not yet implemented (requires session lifecycle changes)

**What it needs:**
1. Context size estimator
2. Idle time tracker
3. Compaction trigger in session lifecycle

**Example design:**
```typescript
// In session.ts after each turn:
const contextSize = estimateContextSize(session.messages)
const idleTime = Date.now() - session.lastActivityTime

if (contextSize > 50000 || idleTime > 3600000) {
  await session.compact()
}
```

---

## Integration Checklist

- [ ] Suggestions integrated into registry.ts
- [ ] Determinism integrated into tool execution
- [ ] Retry integrated into shell.ts
- [ ] Retry integrated into webfetch.ts
- [ ] Cache integrated (choose: per-tool OR registry-level)
- [ ] All integrations tested
- [ ] Streaming progress implemented (optional)
- [ ] Auto-compaction implemented (optional)

---

## Notes

- **Cache**: Registry-level is easier but less granular. Per-tool is more work but more control.
- **Retry**: Only retry transient errors. Don't retry user errors (missing files, wrong args).
- **Suggestions**: Already partially implemented in read.ts. Can be enhanced.
- **Determinism**: Enable by default for read/grep/glob. Disable for eval runs.
- **Streaming/Auto-compaction**: Nice-to-have, not critical for effectiveness parity.

---

## Effect Complexity Note

OpenCode tools use the Effect library extensively, which makes simple wrappers more complex. 

**Workaround:** Integrate at the registry level (fewer touch points) rather than modifying each tool individually.

The registry already wraps tool execution, making it the ideal integration point for cross-cutting concerns like caching, retry, and determinism checking.
