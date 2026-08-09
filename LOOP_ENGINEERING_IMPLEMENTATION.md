# Loop Engineering Implementation for OpenCode

Complete implementation guide for autonomous loop patterns that let OpenCode work until goals are met, not just until the agent stops.

## Core Problem

**Current OpenCode behavior:**
```
User: "Fix all the failing tests"
Agent: [fixes 3 tests, sees 2 more failing]
Agent: "I've made progress. There are 2 more tests failing."
[STOPS - user must prompt again]
```

**With loop engineering:**
```
User: "Fix all the failing tests"
[Goal: npm test exits 0]
Agent: [fixes 3 tests]
[Auto-check: npm test still fails]
[Agent automatically continues]
Agent: [fixes 2 more tests]
[Auto-check: npm test passes]
[Goal met - stops]
```

---

## 1. Goal Loop (Primary Pattern)

### Design

**User sets a goal. Agent works until goal verification passes or turn cap.**

```typescript
// packages/opencode/src/tool/goal.ts
export const Parameters = Schema.Struct({
  criteria: Schema.String.annotations({
    description: "Goal description (e.g., 'all tests pass', 'API returns 200')"
  }),
  gate: Schema.optional(Schema.String).annotations({
    description: "Shell command for verification. Exit 0 = goal met. " +
                 "Example: 'npm test' or 'curl -f http://localhost:3000/health'"
  }),
  maxTurns: Schema.optional(Schema.Number).annotations({
    description: "Maximum turns before giving up (default: 10)"
  }),
  evaluator: Schema.optional(Schema.Literal("gate", "self-report")).annotations({
    description: "gate: shell command exit code, self-report: agent must say GOAL_STATUS: MET"
  })
})
```

### Implementation Flow

```typescript
1. goal({ criteria: "tests pass", gate: "npm test", maxTurns: 10 })
   -> Creates Goal { id, criteria, gate, maxTurns, currentTurn: 0, status: "active" }
   -> Returns: "Goal set. Work toward: tests pass. Will verify with: npm test"

2. After agent's turn ends (hook: agent_end):
   if (activeGoal exists):
     currentTurn++
     
     if (currentTurn >= maxTurns):
       return "Goal timed out after 10 turns. Final state: [run gate once more]"
       
     result = evaluateGoal(activeGoal)
     
     if (result.met):
       return "Goal met! [show verification output]"
       status = "completed"
       
     else:
       // Re-inject as user message to continue loop
       injectFollowUp({
         role: "user",
         content: `Goal not yet met: ${criteria}\n` +
                  `Verification: ${result.output}\n` +
                  `Turn ${currentTurn}/${maxTurns}. Continue working toward the goal.`
       })
```

### Goal Evaluators

**1. Gate Evaluator (Shell Command):**
```typescript
async function evaluateGate(gate: string): Promise<EvalResult> {
  const result = await exec(gate, { timeout: 30000 })
  
  return {
    met: result.exitCode === 0,
    output: result.stdout + result.stderr,
    details: {
      exitCode: result.exitCode,
      duration: result.duration
    }
  }
}

// Examples:
// gate: "npm test"            -> exit 0 when all pass
// gate: "grep -q 'error' log" -> exit 0 if errors found (invert with !)
// gate: "[ $(wc -l < out) -gt 100 ]" -> exit 0 if output > 100 lines
```

**2. Self-Report Evaluator:**
```typescript
function evaluateSelfReport(agentOutput: string): EvalResult {
  // Agent must explicitly say goal is met
  const metPattern = /GOAL_STATUS:\s*MET/i
  const notMetPattern = /GOAL_STATUS:\s*NOT[_\s]?MET/i
  
  if (metPattern.test(agentOutput)) {
    return { met: true, output: "Agent reported: GOAL_STATUS: MET" }
  }
  
  if (notMetPattern.test(agentOutput)) {
    return { met: false, output: "Agent reported: GOAL_STATUS: NOT_MET" }
  }
  
  // No explicit status = assume not met, continue
  return {
    met: false,
    output: "No explicit GOAL_STATUS in agent output. Assuming not met."
  }
}
```

**3. Hybrid Evaluator (Both):**
```typescript
function evaluateHybrid(gate: string, agentOutput: string): EvalResult {
  const gateResult = evaluateGate(gate)
  const selfReport = evaluateSelfReport(agentOutput)
  
  // Require BOTH to agree
  if (gateResult.met && selfReport.met) {
    return { met: true, output: "Gate passed AND agent confirmed" }
  }
  
  // If they disagree, not met
  return {
    met: false,
    output: `Gate: ${gateResult.met ? "pass" : "fail"}, ` +
            `Agent: ${selfReport.met ? "confirmed" : "not confirmed"}`
  }
}
```

### Goal Commands

```typescript
// Start a goal
goal("make all tests pass", { gate: "npm test", maxTurns: 15 })

// Check current goal status
goal_status() 
// Returns: { 
//   criteria: "make all tests pass",
//   currentTurn: 3,
//   maxTurns: 15,
//   lastCheck: { met: false, output: "2 tests still failing" }
// }

// Stop goal loop
goal_stop()
// Returns: "Goal stopped. Final state: [run gate]"
```

---

## 2. /loop Command (Periodic Re-execution)

### Design

**Run a command or prompt on recurring interval.**

```bash
/loop 5m "check if deployment is ready"
/loop 10m "/skill eval-studio"
/loop 30s "npm test" --until-success
```

### Implementation

```typescript
// packages/opencode/src/command/loop.ts
interface LoopConfig {
  interval: Duration      // "5m", "30s", "1h"
  command: string         // command or prompt to run
  maxIterations?: number  // default: infinite
  untilSuccess?: boolean  // stop when command succeeds
  untilGoal?: string      // stop when goal met
}

async function executeLoop(config: LoopConfig) {
  let iteration = 0
  
  while (true) {
    iteration++
    
    if (config.maxIterations && iteration > config.maxIterations) {
      return `Loop completed ${iteration} iterations`
    }
    
    // Execute command/prompt
    const result = await executeCommand(config.command)
    
    // Check stop conditions
    if (config.untilSuccess && result.success) {
      return `Loop completed after ${iteration} iterations (success condition met)`
    }
    
    if (config.untilGoal) {
      const goalMet = await evaluateGoal(config.untilGoal)
      if (goalMet) {
        return `Loop completed after ${iteration} iterations (goal met)`
      }
    }
    
    // Wait for next iteration
    await sleep(parseDuration(config.interval))
  }
}
```

### Use Cases

**1. Poll for deployment:**
```bash
/loop 1m "curl -f https://staging.app.com/health" --until-success --max-iterations 30
```

**2. Monitor for errors:**
```bash
/loop 5m "check error logs and alert if new errors found"
```

**3. Periodic task execution:**
```bash
/loop 1h "/skill daily-status-update"
```

**4. Test-driven development:**
```bash
/loop 30s "npm test" --until-success
[Agent continuously fixes failing tests until all pass]
```

### Loop Storage

```typescript
// Store active loops
interface ActiveLoop {
  id: string
  config: LoopConfig
  startedAt: Date
  iteration: number
  lastResult: CommandResult
  nextRunAt: Date
  status: "running" | "paused" | "stopped"
}

// Commands
/loop list              // Show all active loops
/loop pause <id>        // Pause a loop
/loop resume <id>       // Resume a loop
/loop stop <id>         // Stop a loop
/loop status <id>       // Show loop status and history
```

---

## 3. Retry-Until-Success Pattern

### Design

**Retry a failing operation until it succeeds or max attempts reached.**

```typescript
// packages/opencode/src/tool/retry.ts
export const Parameters = Schema.Struct({
  command: Schema.String.annotations({
    description: "Command to retry (shell command or tool call)"
  }),
  maxAttempts: Schema.optional(Schema.Number).annotations({
    description: "Maximum retry attempts (default: 3)"
  }),
  backoff: Schema.optional(Schema.Literal("exponential", "linear", "constant")).annotations({
    description: "Backoff strategy between retries"
  }),
  initialDelay: Schema.optional(Schema.Number).annotations({
    description: "Initial delay in ms (default: 1000)"
  })
})
```

### Implementation

```typescript
async function retryUntilSuccess(params: RetryParams): Promise<RetryResult> {
  let attempt = 0
  let delay = params.initialDelay || 1000
  const errors: Error[] = []
  
  while (attempt < params.maxAttempts) {
    attempt++
    
    try {
      const result = await executeCommand(params.command)
      
      if (result.success) {
        return {
          success: true,
          attempts: attempt,
          result: result.output,
          errors: errors
        }
      }
      
      errors.push(new Error(result.error))
      
    } catch (error) {
      errors.push(error)
    }
    
    // Backoff before next attempt
    if (attempt < params.maxAttempts) {
      await sleep(delay)
      
      switch (params.backoff) {
        case "exponential":
          delay *= 2
          break
        case "linear":
          delay += params.initialDelay
          break
        case "constant":
          // delay stays same
          break
      }
    }
  }
  
  return {
    success: false,
    attempts: attempt,
    errors: errors,
    message: `Failed after ${attempt} attempts`
  }
}
```

### Usage

```typescript
retry("npm test", { maxAttempts: 5, backoff: "exponential" })
retry("curl https://api.example.com/deploy", { maxAttempts: 10, initialDelay: 5000 })
```

---

## 4. Watch-and-React Pattern

### Design

**Watch for file/system changes and trigger actions automatically.**

```typescript
// packages/opencode/src/tool/watch.ts
export const Parameters = Schema.Struct({
  path: Schema.String.annotations({
    description: "File or directory to watch"
  }),
  events: Schema.Array(Schema.Literal("change", "add", "delete")).annotations({
    description: "Events to watch for"
  }),
  action: Schema.String.annotations({
    description: "Command or prompt to execute when event fires"
  }),
  debounce: Schema.optional(Schema.Number).annotations({
    description: "Debounce delay in ms (default: 1000)"
  })
})
```

### Implementation

```typescript
import chokidar from "chokidar"

async function startWatch(params: WatchParams): Promise<WatchHandle> {
  const watcher = chokidar.watch(params.path, {
    ignoreInitial: true,
    persistent: true
  })
  
  let debounceTimer: NodeJS.Timeout | null = null
  
  const handleEvent = (event: string, path: string) => {
    if (!params.events.includes(event)) return
    
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    
    debounceTimer = setTimeout(async () => {
      await executeCommand(params.action, {
        env: {
          WATCH_EVENT: event,
          WATCH_PATH: path
        }
      })
    }, params.debounce || 1000)
  }
  
  watcher
    .on("change", (path) => handleEvent("change", path))
    .on("add", (path) => handleEvent("add", path))
    .on("unlink", (path) => handleEvent("delete", path))
  
  return {
    id: generateId(),
    watcher,
    stop: () => watcher.close()
  }
}
```

### Usage

```typescript
watch("src/**/*.ts", {
  events: ["change"],
  action: "npm test",
  debounce: 2000
})
// Auto-runs tests when any TypeScript file changes

watch("logs/error.log", {
  events: ["change"],
  action: "analyze new errors in logs/error.log"
})
// Agent analyzes new errors automatically
```

---

## 5. Conditional Loop (If-Then-Retry)

### Design

**Check a condition repeatedly until it becomes true or false.**

```typescript
// packages/opencode/src/tool/wait-until.ts
export const Parameters = Schema.Struct({
  condition: Schema.String.annotations({
    description: "Shell command that returns exit 0 when condition is met"
  }),
  timeout: Schema.optional(Schema.Number).annotations({
    description: "Timeout in milliseconds (default: 300000 = 5 min)"
  }),
  checkInterval: Schema.optional(Schema.Number).annotations({
    description: "How often to check in ms (default: 5000 = 5 sec)"
  }),
  onSuccess: Schema.optional(Schema.String).annotations({
    description: "Command to run when condition is met"
  }),
  onTimeout: Schema.optional(Schema.String).annotations({
    description: "Command to run on timeout"
  })
})
```

### Implementation

```typescript
async function waitUntil(params: WaitUntilParams): Promise<WaitResult> {
  const startTime = Date.now()
  const timeout = params.timeout || 300000
  const interval = params.checkInterval || 5000
  
  while (Date.now() - startTime < timeout) {
    const result = await exec(params.condition)
    
    if (result.exitCode === 0) {
      // Condition met
      if (params.onSuccess) {
        await executeCommand(params.onSuccess)
      }
      
      return {
        success: true,
        elapsed: Date.now() - startTime,
        message: "Condition met"
      }
    }
    
    await sleep(interval)
  }
  
  // Timeout
  if (params.onTimeout) {
    await executeCommand(params.onTimeout)
  }
  
  return {
    success: false,
    elapsed: Date.now() - startTime,
    message: "Timeout reached before condition met"
  }
}
```

### Usage

```typescript
waitUntil({
  condition: "curl -f http://localhost:3000/health",
  timeout: 60000,  // 1 minute
  checkInterval: 2000,  // check every 2 seconds
  onSuccess: "run integration tests",
  onTimeout: "check server logs for startup errors"
})
```

---

## Implementation Plan

### Phase 1: Goal Loop (Week 1)
```
packages/opencode/src/tool/goal.ts           - Goal tool implementation
packages/opencode/src/tool/goal.txt          - Tool description
packages/opencode/src/session/goal-eval.ts   - Evaluator logic
packages/opencode/src/session/goal-hook.ts   - agent_end hook for re-injection
```

### Phase 2: Retry & Loop (Week 2)
```
packages/opencode/src/tool/retry.ts          - Retry-until-success
packages/opencode/src/command/loop.ts        - /loop command
packages/opencode/src/tool/wait-until.ts     - Conditional waiting
```

### Phase 3: Watch & Advanced (Week 3)
```
packages/opencode/src/tool/watch.ts          - File watching
packages/opencode/src/session/loop-state.ts  - Persistent loop storage
```

## Success Metrics

After implementation:
- [ ] Agent continues fixing tests until all pass (goal loop)
- [ ] /loop command runs periodic tasks without manual prompting
- [ ] Retry-until-success handles flaky operations automatically
- [ ] wait-until waits for deployments/servers without polling
- [ ] Watch-and-react triggers actions on file changes

## References

- Your pi-loop-hud implementation (Aug 8 field notes)
- work-agent /goal extension (~/.pi/agent/extensions/goal.ts)
- Claude Code equivalent: agents work until verification passes
- Field notes evidence: agents giving up prematurely is a pattern
