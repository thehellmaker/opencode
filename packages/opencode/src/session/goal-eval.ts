import { Effect, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

export type GoalStatus = "active" | "completed" | "failed" | "timeout"

export type EvaluatorType = "gate" | "self-report" | "hybrid"

export interface Goal {
  readonly id: string
  readonly criteria: string
  readonly gate?: string
  readonly maxTurns: number
  readonly evaluator: EvaluatorType
  readonly startedAt: number
  readonly currentTurn: number
  readonly status: GoalStatus
  readonly lastCheck?: EvalResult
}

export interface EvalResult {
  readonly met: boolean
  readonly output: string
  readonly exitCode?: number
  readonly duration?: number
  readonly timestamp: number
}

export const GoalSchema = Schema.Struct({
  id: Schema.String,
  criteria: Schema.String,
  gate: Schema.optional(Schema.String),
  maxTurns: Schema.Number,
  evaluator: Schema.Literal("gate", "self-report", "hybrid"),
  startedAt: Schema.Number,
  currentTurn: Schema.Number,
  status: Schema.Literal("active", "completed", "failed", "timeout"),
  lastCheck: Schema.optional(
    Schema.Struct({
      met: Schema.Boolean,
      output: Schema.String,
      exitCode: Schema.optional(Schema.Number),
      duration: Schema.optional(Schema.Number),
      timestamp: Schema.Number,
    })
  ),
})

/**
 * Evaluate goal using shell command gate.
 * Exit code 0 = goal met.
 */
export function evaluateGate(gate: string, timeoutMs: number = 30000) {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.Service
    const startTime = Date.now()

    const result = yield* spawner
      .spawn({
        command: "/bin/sh",
        args: ["-c", gate],
      })
      .pipe(
        Effect.provide(CrossSpawnSpawner.layer),
        Effect.flatMap((process) =>
          Effect.gen(function* () {
            const stdout: string[] = []
            const stderr: string[] = []

            yield* process.stdout.pipe(
              Effect.flatMap((chunk) => Effect.sync(() => stdout.push(chunk.toString()))),
              Effect.runDrain,
              Effect.fork
            )

            yield* process.stderr.pipe(
              Effect.flatMap((chunk) => Effect.sync(() => stderr.push(chunk.toString()))),
              Effect.runDrain,
              Effect.fork
            )

            const exitCode = yield* process.exitCode

            return {
              exitCode,
              stdout: stdout.join(""),
              stderr: stderr.join(""),
            }
          })
        ),
        Effect.timeout(timeoutMs),
        Effect.catchAll(() =>
          Effect.succeed({
            exitCode: 124, // timeout exit code
            stdout: "",
            stderr: "Command timed out",
          })
        )
      )

    const duration = Date.now() - startTime

    return {
      met: result.exitCode === 0,
      output: (result.stdout + result.stderr).trim() || "(no output)",
      exitCode: result.exitCode,
      duration,
      timestamp: Date.now(),
    } satisfies EvalResult
  })
}

/**
 * Evaluate goal using agent's self-report.
 * Agent must explicitly say "GOAL_STATUS: MET" or "GOAL_STATUS: NOT_MET"
 */
export function evaluateSelfReport(agentOutput: string): Effect.Effect<EvalResult> {
  return Effect.sync(() => {
    const metPattern = /GOAL_STATUS:\s*MET\b/i
    const notMetPattern = /GOAL_STATUS:\s*NOT[_\s]?MET\b/i

    if (metPattern.test(agentOutput)) {
      return {
        met: true,
        output: "Agent reported: GOAL_STATUS: MET",
        timestamp: Date.now(),
      }
    }

    if (notMetPattern.test(agentOutput)) {
      return {
        met: false,
        output: "Agent reported: GOAL_STATUS: NOT_MET",
        timestamp: Date.now(),
      }
    }

    // No explicit status = assume not met, continue working
    return {
      met: false,
      output: "No explicit GOAL_STATUS found in agent output. Assuming goal not yet met.",
      timestamp: Date.now(),
    }
  })
}

/**
 * Evaluate goal using both gate and self-report.
 * Requires BOTH to agree that goal is met.
 */
export function evaluateHybrid(gate: string, agentOutput: string, timeoutMs: number = 30000) {
  return Effect.gen(function* () {
    const gateResult = yield* evaluateGate(gate, timeoutMs)
    const selfReport = yield* evaluateSelfReport(agentOutput)

    // Both must agree that goal is met
    if (gateResult.met && selfReport.met) {
      return {
        met: true,
        output: `Gate passed (exit ${gateResult.exitCode}) AND agent confirmed.\nGate output: ${gateResult.output}`,
        exitCode: gateResult.exitCode,
        duration: gateResult.duration,
        timestamp: Date.now(),
      } satisfies EvalResult
    }

    // If they disagree or both say not met, goal is not met
    return {
      met: false,
      output: `Gate: ${gateResult.met ? "PASS" : "FAIL"} (exit ${gateResult.exitCode})\nAgent: ${selfReport.met ? "confirmed" : "not confirmed"}\nGate output: ${gateResult.output}`,
      exitCode: gateResult.exitCode,
      duration: gateResult.duration,
      timestamp: Date.now(),
    } satisfies EvalResult
  })
}

/**
 * Evaluate a goal based on its configuration.
 */
export function evaluateGoal(goal: Goal, agentOutput?: string) {
  return Effect.gen(function* () {
    switch (goal.evaluator) {
      case "gate":
        if (!goal.gate) {
          return yield* Effect.fail(new Error("Goal evaluator is 'gate' but no gate command provided"))
        }
        return yield* evaluateGate(goal.gate)

      case "self-report":
        if (!agentOutput) {
          return yield* Effect.fail(new Error("Goal evaluator is 'self-report' but no agent output provided"))
        }
        return yield* evaluateSelfReport(agentOutput)

      case "hybrid":
        if (!goal.gate) {
          return yield* Effect.fail(new Error("Goal evaluator is 'hybrid' but no gate command provided"))
        }
        if (!agentOutput) {
          return yield* Effect.fail(new Error("Goal evaluator is 'hybrid' but no agent output provided"))
        }
        return yield* evaluateHybrid(goal.gate, agentOutput)

      default:
        return yield* Effect.fail(new Error(`Unknown evaluator type: ${goal.evaluator}`))
    }
  })
}

export * as GoalEval from "./goal-eval"
