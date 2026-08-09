# Goal Loop: Autonomous Work Until Completion

The goal loop allows OpenCode agents to work autonomously toward a goal until verification passes or a turn limit is reached. Instead of stopping after each attempt, the agent continues iterating until the goal is met.

## Quick Start

```typescript
goal("make all tests pass", {
  gate: "npm test",
  maxTurns: 15
})
```

The agent will:
1. Analyze failing tests and fix them
2. [Automatic verification runs: `npm test`]
3. If tests still fail: continue fixing automatically
4. If tests pass: stop and report success
5. Repeat until tests pass or 15 turns reached

**You do NOT need to manually run `npm test` or re-prompt the agent. The loop handles this automatically.**

## Why Use Goal Loops?

### Before Goal Loops

```
User: "Fix all the failing tests"
Agent: [fixes 3 tests, sees 2 more failing]
Agent: "I've made progress. There are 2 more tests failing."
[STOPS - user must prompt again]

User: "Keep going"
Agent: [fixes 1 more test, sees 1 still failing]  
Agent: "Made more progress. 1 test still failing."
[STOPS - user must prompt again]
```

### With Goal Loops

```
User: goal("make all tests pass", { gate: "npm test" })
Agent: [fixes 3 tests]
[Auto-verification: npm test still fails]
[Agent continues automatically]
Agent: [fixes 2 more tests]
[Auto-verification: npm test passes]
✓ Goal met! Completed in 2 turns.
```

## How It Works

1. **Set Goal**: You provide criteria and verification method
2. **Agent Works**: Agent takes actions toward the goal
3. **Auto-Verify**: After each turn, verification runs automatically
4. **Loop or Stop**: 
   - Goal not met → Agent continues automatically (no user input needed)
   - Goal met → Loop stops, success reported
   - Turn limit reached → Loop stops, final state reported

## Verification Methods

### Gate (Shell Command)

Goal is met when the shell command exits with code 0.

```typescript
// Tests must pass
goal("make tests pass", { 
  gate: "npm test" 
})

// API must be healthy
goal("deployment is healthy", { 
  gate: "curl -f https://staging.app.com/health" 
})

// Bundle must be under 500KB
goal("bundle size < 500KB", { 
  gate: "[ $(stat -f%z dist/bundle.js) -lt 512000 ]" 
})

// No errors in logs
goal("clean logs", { 
  gate: "! grep -q 'ERROR' logs/app.log" 
})
```

**Best for:** Objective verification that can be checked programmatically.

### Self-Report

Goal is met when the agent explicitly outputs `GOAL_STATUS: MET`.

```typescript
goal("refactor auth to use new API", {
  evaluator: "self-report",
  maxTurns: 20
})
```

The agent must write:
```
I have completed the refactoring:
- Updated all auth calls to use newAuth()
- Removed deprecated oldAuth() calls
- Tests still pass

GOAL_STATUS: MET
```

**Best for:** Subjective goals that require judgment or qualitative assessment.

### Hybrid (Both)

Goal is met when BOTH the gate passes AND the agent confirms.

```typescript
goal("migrate to new database schema", {
  gate: "npm test",
  evaluator: "hybrid",
  maxTurns: 30
})
```

The agent must:
1. Make tests pass (`npm test` exits 0)
2. Explicitly confirm with `GOAL_STATUS: MET`

**Best for:** Complex goals where you want both objective verification and agent validation.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `criteria` | string | Yes | - | Human-readable goal description |
| `gate` | string | Conditional* | - | Shell command for verification (exit 0 = success) |
| `maxTurns` | number | No | 10 | Maximum turns before timeout |
| `evaluator` | "gate" \| "self-report" \| "hybrid" | No | "gate" if gate provided, else "self-report" | Verification method |

\* Required when `evaluator` is "gate" or "hybrid"

## Commands

### goal()

Set a new goal. Only one goal can be active at a time.

```typescript
goal("criteria", {
  gate: "command",
  maxTurns: 10,
  evaluator: "gate"
})
```

### goal_status()

Check the current goal's progress and last verification result.

```typescript
goal_status()
```

Returns:
```
⏳ Goal Status: ACTIVE

Criteria: make all tests pass
Progress: Turn 3/15
Gate: npm test

Last verification (10:23:45 AM):
✗ Goal not yet met
Output: 2 tests failing: auth.test.ts, user.test.ts
Exit code: 1

Goal loop is active. Continuing toward goal...
```

### goal_stop()

Stop the active goal loop. Provides final state.

```typescript
goal_stop({ reason: "Changing approach" })
```

## Use Cases

### 1. Test-Driven Development

```typescript
goal("make all tests pass", { 
  gate: "npm test",
  maxTurns: 20 
})
```

Agent fixes tests iteratively until all pass.

### 2. Deployment Verification

```typescript
goal("staging is deployed and healthy", {
  gate: "curl -f https://staging.app.com/health && curl -f https://staging.app.com/api/v1/status",
  maxTurns: 30
})
```

Agent deploys, waits for services to start, verifies health endpoints.

### 3. Performance Optimization

```typescript
goal("reduce API latency below 100ms", {
  gate: "[ $(curl -w '%{time_total}' -o /dev/null -s http://localhost:3000/api/users) < 0.1 ]",
  maxTurns: 25
})
```

Agent profiles, optimizes, and verifies until latency target is met.

### 4. Code Quality

```typescript
goal("no linting errors", {
  gate: "npm run lint",
  maxTurns: 10
})
```

Agent fixes linting issues until the linter is happy.

### 5. Refactoring with Validation

```typescript
goal("refactor to use new API while keeping tests green", {
  gate: "npm test",
  evaluator: "hybrid",
  maxTurns: 40
})
```

Agent refactors incrementally, confirming tests pass after each change.

## Important Notes

### DO NOT manually verify

The goal loop runs verification automatically after each turn. **Do not** manually run the gate command or check status repeatedly.

❌ **Wrong:**
```typescript
goal("tests pass", { gate: "npm test" })
// Agent manually runs: npm test
// Agent checks: goal_status()
// Agent runs again: npm test
```

✅ **Right:**
```typescript
goal("tests pass", { gate: "npm test" })
// Agent fixes tests
// [Automatic verification runs]
// Agent continues or stops based on result
```

### Only one active goal

You can only have one active goal at a time. To set a new goal, stop the current one first:

```typescript
goal_stop()
goal("new criteria", { gate: "new command" })
```

### Turn counting

Each turn includes:
- Agent's work (analysis, edits, etc.)
- Automatic verification

If `maxTurns: 10`, the agent has 10 opportunities to work toward the goal.

### Goal state persistence

Goal state persists across session interrupts. If the session crashes or is restarted, the goal loop can resume.

## Troubleshooting

### Goal times out

If the goal consistently times out before completion:

1. **Increase `maxTurns`**: Complex goals may need more iterations
   ```typescript
   goal("criteria", { gate: "command", maxTurns: 30 })
   ```

2. **Break into sub-goals**: Tackle one piece at a time
   ```typescript
   goal("fix auth tests", { gate: "npm test -- auth.test.ts" })
   // Once complete:
   goal("fix user tests", { gate: "npm test -- user.test.ts" })
   ```

3. **Check gate command**: Verify it's correct
   ```bash
   # Run manually first
   npm test
   echo $?  # Should be 0 when goal is met
   ```

### Gate never passes

If verification always fails even though the goal seems met:

1. **Verify exit codes**: Ensure the gate exits 0 on success
   ```bash
   curl -f https://staging.app.com/health
   echo $?  # Must be 0, not any other value
   ```

2. **Check for side effects**: Some commands may have unintended effects
   ```bash
   # Bad: modifies state
   gate: "migrate-db && npm test"
   
   # Good: read-only verification
   gate: "npm test"
   ```

3. **Use hybrid evaluation**: Add agent confirmation as a safety check
   ```typescript
   goal("criteria", { gate: "command", evaluator: "hybrid" })
   ```

### Agent gives up too early

If the agent stops trying before the turn limit:

1. **Use gate verification**: Don't rely solely on self-report
   ```typescript
   goal("criteria", { gate: "command" })  // Not just evaluator: "self-report"
   ```

2. **Make criteria specific**: Vague goals lead to premature declaration
   ```typescript
   // Vague
   goal("improve performance")
   
   // Specific
   goal("reduce bundle size below 500KB", { gate: "..." })
   ```

## Comparison to Manual Loops

| Approach | Agent Re-prompts Needed | Verification | Turn Limit | Use Case |
|----------|-------------------------|--------------|------------|----------|
| **No loop** | User must re-prompt every time | Manual | None | Simple one-shot tasks |
| **Goal loop** | Automatic until goal met | Automatic | Configurable | Iterative work with clear success criteria |
| **Manual verification** | User checks and re-prompts | Manual | None | Exploratory work with subjective goals |

## Advanced Patterns

### Sequential Goals

Chain goals for multi-step workflows:

```typescript
// Step 1: Setup
goal("database seeded", { gate: "psql -c 'SELECT COUNT(*) FROM users' | grep -q '100'" })
// [Completes]

// Step 2: Tests
goal("integration tests pass", { gate: "npm run test:integration" })
// [Completes]

// Step 3: Deploy
goal("production deployed", { gate: "curl -f https://api.production.com/health" })
```

### Conditional Goals

Set goals based on current state:

```typescript
// Check if feature flag is enabled
const flagEnabled = await shell("grep -q 'NEW_AUTH=true' .env")

if (flagEnabled.exitCode === 0) {
  goal("migrate to new auth", { gate: "npm test", maxTurns: 30 })
} else {
  goal("maintain old auth", { gate: "npm test -- auth.test.ts" })
}
```

### Goal with Fallback

Try to achieve a goal, fall back if it times out:

```typescript
goal("optimize to < 100ms", { 
  gate: "[ $(curl -w '%{time_total}' -o /dev/null -s localhost:3000) < 0.1 ]",
  maxTurns: 15 
})

// Agent works...
// If timeout:
goal_stop({ reason: "Relaxing constraint" })
goal("optimize to < 200ms", { 
  gate: "[ $(curl -w '%{time_total}' -o /dev/null -s localhost:3000) < 0.2 ]",
  maxTurns: 10
})
```

## See Also

- `/loop` command - Periodic execution
- `retry()` - Retry-until-success pattern
- `wait_until()` - Wait for conditions
- `watch()` - React to file changes
