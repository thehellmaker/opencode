# OpenCode Missing Features - What Else Needs Implementation

Based on work-agent field notes and Claude Code comparison, here are the remaining critical gaps not yet addressed.

## 1. **Goal Tracking and Loop Engineering** (HIGH PRIORITY)

### What Claude Code Has

**From work-agent AGENTS.md:**
```markdown
After every task, add one improvement idea to scratch/state/improvements.md. 
Turn recurring patterns into a skill or subagent.
```

**From your pi extension (Aug 8 field notes line 11-12):**
```
Implemented /goal loop for pi: hooks agent_end and re-injects followUp user message 
until goal is verified met or turn cap hits. Two evaluators: deterministic --gate 
"shell cmd" (exit 0 = done) and self-report (agent must end with GOAL_STATUS: MET/NOT_MET).
```

### What OpenCode Has

- TodoWrite tool (task tracking)
- No goal loop mechanism
- No `/goal` command
- No automatic re-injection until goal met
- No gate evaluation

### Gap

**TodoWrite is task management. Goal tracking is loop engineering.**

| Feature | TodoWrite | Goal Loop | Claude Code |
|---------|-----------|-----------|-------------|
| Track steps | ✅ | - | ✅ |
| Mark progress | ✅ | - | ✅ |
| Auto-verify goal | ❌ | ✅ | ✅ |
| Re-inject until done | ❌ | ✅ | ✅ |
| Shell gate evaluation | ❌ | ✅ | ✅ |
| Self-report eval | ❌ | ✅ | ✅ |

### Evidence of Need

**From Aug 8 field notes:**
- You built this for pi because you needed it
- Line 30: "Shipped passive-overlay pattern confirmed"
- You needed automated goal verification, not just manual task tracking

### Implementation Needed

**Files to Create:**
```
packages/opencode/src/tool/goal.ts
packages/opencode/src/tool/goal.txt
packages/opencode/src/session/goal-evaluator.ts
```

**Goal Tool API:**
```typescript
goal({
  criteria: string,         // "tests pass" or "p50 latency < 100ms"
  gate?: string,           // shell command, exit 0 = met
  maxTurns?: number,       // default 10
  evaluator?: "gate" | "self-report"
})

goal_status()              // check current goal
goal_stop()                // cancel goal loop
```

**How It Works:**
1. User or agent calls `goal("make tests pass")`
2. Agent works toward goal
3. After each turn, evaluator checks:
   - Gate mode: run shell command, exit 0 = done
   - Self-report: agent must say `GOAL_STATUS: MET`
4. If not met and turns < maxTurns, re-inject as user message
5. Agent continues until goal met or cap hit

**Why This Matters:**
- Enables autonomous goal pursuit (not just task tracking)
- Prevents agents from giving up prematurely
- Measurable verification (not just "looks done")
- Claude Code equivalent: agent continues until verification passes

---

## 2. **Read-Before-Edit Enforcement** (MEDIUM-HIGH PRIORITY)

### What Claude Code Has

**From Aug 9 field notes analysis:**
```
Read-before-edit enforcement: filesystem timestamp + content hash prevents blind edits
```

**From Claude Code unminified source (line 67):**
```
Pi deleted read-before-edit invariant in commit 76a141090. The deleted FileTime.assert 
compared mtime and size but structurally could not implement Claude Code's false-positive 
escape hatch (isFullRead && fileContent === readTimestamp.content).
```

### What OpenCode Has

Checking edit.ts (lines 1-100): **No read-before-edit check visible.**

### Gap

**OpenCode allows blind edits. Claude Code enforces Read first.**

**Evidence:**
- Claude Code: Edit tool requires prior Read for existing files
- Pi had it, then deleted it (commit 76a141090)
- OpenCode: No enforcement seen in edit.ts

**Risk:**
- Agents edit files they haven't read
- Stale assumptions cause incorrect edits
- No verification of current state before modification

### Implementation Needed

**Add to edit.ts:**
```typescript
// Track reads per message
const readsPerMessage = new Map<MessageID, Set<string>>()

// In EditTool execute:
const wasRead = readsPerMessage.get(ctx.messageID)?.has(filePath)
if (!wasRead && (yield* afs.existsSafe(filePath))) {
  throw new Error(
    `Cannot edit ${filePath} - you must Read it first in this message. ` +
    `This ensures you have current file content before modifying it.`
  )
}
```

**Escape Hatch:**
```typescript
// Allow edit if Read happened in same message AND content matches
const readCache = getReadCache(ctx.messageID, filePath)
if (readCache && readCache.content === currentContent) {
  // Recent read, content unchanged, edit allowed
}
```

**Why This Matters:**
- Prevents stale-state edits
- Forces agents to verify current state
- Matches Claude Code behavior
- Reduces "why did you change that?" bugs

---

## 3. **Microcompaction / Tool Result Eviction** (MEDIUM PRIORITY)

### What Claude Code Has

**From Aug 9 field notes line 66:**
```
OpenCode ALREADY has microcompact equivalent but ships it disabled: 
session/compaction.ts:243-287 prune() with PRUNE_PROTECT=40_000, PRUNE_MINIMUM=20_000.

Two defects vs Claude:
1. Fires at END of turn when prompt cache is warm; Claude fires on >60min idle 
   gap when cache is cold and eviction is free
2. No system-prompt counterpart telling the model results will be cleared so 
   it should write findings into its own text
```

### What OpenCode Has

- prune() exists but disabled by default
- Fires at wrong time (end of turn, not idle)
- No prompt telling agent "results will be cleared"

### Gap

**Microcompaction exists but doesn't work like Claude Code's.**

| Feature | OpenCode | Claude Code |
|---------|----------|-------------|
| Tool result eviction | ✅ (disabled) | ✅ (enabled) |
| Fires on idle (cache cold) | ❌ | ✅ |
| Tells agent results clear | ❌ | ✅ |
| Keeps last N results | ✅ (5) | ✅ (5) |

### Implementation Needed

**Enable and fix microcompaction:**

1. **Change trigger timing:**
   - Current: end of turn (cache warm) ❌
   - Needed: after >60min idle (cache cold) ✅

2. **Add system prompt:**
   ```
   Old tool result content may be cleared to save space. When you get important 
   findings from a tool, write them into your response text so they persist.
   ```

3. **Configuration:**
   ```typescript
   PRUNE_ON_IDLE_MINUTES: 60
   PRUNE_PROTECT: 40_000 chars
   PRUNE_KEEP_LAST: 5
   ```

**Why This Matters:**
- Prevents context bloat
- Evicts when cost is zero (cold cache)
- Encourages agents to summarize findings (not rely on raw tool output)

---

## 4. **Determinism Verification** (MEDIUM PRIORITY)

### Problem

**From Aug 6 field notes line 190:**
```
"all 10 rendered text parts had SHA-256 74e994cd..., but evaluator returned 5 PASS/5 FAIL"
Identical inputs produced random outputs, accepted as normal.
```

### What's Missing

**No determinism gate for critical operations.**

**Claude Code equivalent:**
- Hash identical inputs (prompt + model + temperature=0)
- Compare outputs
- Fail if divergent when deterministic expected

### Implementation Needed

**Add determinism checker:**

```typescript
// packages/opencode/src/session/determinism.ts
export interface DeterminismCheck {
  enabled: boolean
  temperature: number
  hashSeed: string  // prompt + model + temp
  priorOutput?: string
}

function verifyDeterministic(
  check: DeterminismCheck,
  newOutput: string
): { deterministic: boolean; violation?: string } {
  if (!check.enabled || check.temperature > 0) {
    return { deterministic: true }
  }
  
  if (!check.priorOutput) {
    // First run, store output
    return { deterministic: true }
  }
  
  const hash1 = sha256(check.priorOutput)
  const hash2 = sha256(newOutput)
  
  if (hash1 !== hash2) {
    return {
      deterministic: false,
      violation: `Same input produced different output. ` +
                 `Expected hash ${hash1}, got ${hash2}`
    }
  }
  
  return { deterministic: true }
}
```

**Usage:**
```bash
opencode run --require-determinism
opencode run --temperature 0 --verify-determinism
```

**Why This Matters:**
- Catches non-deterministic evaluators
- Prevents flaky test data generation
- Essential for DPO pair mining (need stable labels)

---

## 5. **Error Classification** (MEDIUM PRIORITY)

### Problem

**From Aug 6 field notes lines 176-193:**
```
"14 SageMaker errors, 9 Redis failures, 56 tool failures" in stderr
Final score records: "0 infrastructure errors, 0 retryable errors"
```

### What's Missing

**No structured error classification in tool results.**

### Implementation Needed

**Add error categories:**

```typescript
// packages/opencode/src/tool/result.ts
export enum ErrorCategory {
  INFRASTRUCTURE = "infrastructure",  // SageMaker down, Redis connection refused
  RETRYABLE = "retryable",           // Rate limit, timeout, transient failure
  MODEL = "model",                    // Invalid tool call, malformed output
  USER = "user",                      // Wrong usage, bad parameters
  UNCLASSIFIED = "unclassified"
}

export interface ToolError {
  category: ErrorCategory
  message: string
  retryable: boolean
  metadata?: Record<string, unknown>
}
```

**Classify common errors:**
```typescript
function classifyError(error: Error): ErrorCategory {
  const msg = error.message.toLowerCase()
  
  if (msg.includes("rate limit") || msg.includes("429")) {
    return ErrorCategory.RETRYABLE
  }
  
  if (msg.includes("connection refused") || 
      msg.includes("econnrefused") ||
      msg.includes("timeout")) {
    return ErrorCategory.INFRASTRUCTURE
  }
  
  if (msg.includes("invalid tool call") ||
      msg.includes("malformed")) {
    return ErrorCategory.MODEL
  }
  
  return ErrorCategory.UNCLASSIFIED
}
```

**Surface in results:**
```typescript
return {
  output: "...",
  metadata: {
    errors: [{
      category: ErrorCategory.INFRASTRUCTURE,
      message: "Redis connection refused",
      retryable: true
    }]
  }
}
```

**Why This Matters:**
- Distinguish real failures from transient issues
- Enable smart retry logic
- Surface infrastructure problems to user
- Match Claude Code's error handling

---

## 6. **Progressive Tool Disclosure** (LOW-MEDIUM PRIORITY)

### What Claude Code Has

**From Aug 9 field notes line 49:**
```
Claude Code progressive tool disclosure: isDeferredTool() - deferred tools only 
sent when discovered via tool_reference blocks in message history. 
defer_loading:true, auto threshold DEFAULT_AUTO_TOOL_SEARCH_PERCENTAGE=10 
(% of context window).
```

### What OpenCode Has

**Checking registry.ts:** All tools loaded upfront in every prompt.

### Gap

**OpenCode sends all tools every time. Claude Code defers and loads on demand.**

**Impact:**
- Larger prompts
- More tokens per turn
- Slower for simple tasks

### Implementation Needed

**Add tool deferral:**

```typescript
interface ToolDef {
  id: string
  shouldDefer?: boolean  // NEW
  searchHint?: string    // NEW - keywords for discovery
  // ... existing fields
}
```

**Defer by category:**
- Core tools (read/write/edit/bash): Always loaded
- Specialized tools (lsp/skill): Deferred
- MCP tools: Deferred by default
- Task/subagent tools: Always loaded (high value)

**Discovery:**
- Track tool_reference in messages
- Load deferred tool schemas when referenced
- ToolSearch mechanism for keyword discovery

**Why This Matters:**
- Smaller prompts for simple tasks
- Faster for common operations
- Matches Claude Code efficiency

---

## Implementation Priority

### Phase 1 (This Week - HIGH IMPACT)
1. ✅ Background task control (DONE)
2. ✅ Prompt improvements (DONE)
3. **🔴 Goal tracking and loop engineering** (NEW)
4. **🔴 Read-before-edit enforcement** (NEW)

### Phase 2 (Next Week - MEDIUM IMPACT)
5. Microcompaction fixes (enable + timing)
6. Error classification
7. Determinism verification

### Phase 3 (Polish - LOW-MEDIUM IMPACT)
8. Progressive tool disclosure
9. Audit verification (from RELIABILITY_FIXES.md)
10. Checkpoint resume (from RELIABILITY_FIXES.md)

---

## What to Build Next

**Recommendation: Goal Tracking** (highest user-facing value)

Why goal tracking first:
1. You already built it for pi (proven need)
2. Enables autonomous work loops
3. High visibility feature (agents work until goal met)
4. Solves "agent gives up too early" problem
5. Measurable impact (shell gate = objective verification)

**Second: Read-before-edit** (prevents bugs)

Why read-before-edit second:
1. Prevents entire class of stale-state bugs
2. Low implementation complexity
3. High reliability improvement
4. Matches Claude Code behavior

**Then: Error classification + microcompaction**

Cleanup and efficiency improvements after core reliability is solid.
