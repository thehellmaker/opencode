import * as Tool from "./tool"
import DESCRIPTION from "./goal.txt"
import { Effect, Schema } from "effect"
import { ulid } from "ulid"
import type { Goal, GoalStatus, EvaluatorType } from "../session/goal-eval"

const id = "goal"

export const Parameters = Schema.Struct({
  criteria: Schema.String.annotations({
    description: "Goal description (e.g., 'all tests pass', 'API returns 200', 'bundle size < 500KB')",
  }),
  gate: Schema.optional(Schema.String).annotations({
    description:
      "Shell command for verification. Exit 0 = goal met. " +
      "Example: 'npm test', 'curl -f http://localhost:3000/health', '[ $(stat -f%z dist/bundle.js) -lt 512000 ]'",
  }),
  maxTurns: Schema.optional(Schema.Number).annotations({
    description: "Maximum turns before timeout (default: 10)",
  }),
  evaluator: Schema.optional(Schema.Literal("gate", "self-report", "hybrid")).annotations({
    description:
      "Verification method: 'gate' (shell exit code), 'self-report' (agent must say GOAL_STATUS: MET), " +
      "'hybrid' (both). Default: 'gate' if gate provided, otherwise 'self-report'",
  }),
})

export const GoalStatusParameters = Schema.Struct({})

export const GoalStopParameters = Schema.Struct({
  reason: Schema.optional(Schema.String).annotations({
    description: "Optional reason for stopping the goal",
  }),
})

function formatGoalOutput(goal: Goal, action: "set" | "status" | "stopped"): string {
  const turnInfo = `Turn ${goal.currentTurn}/${goal.maxTurns}`

  switch (action) {
    case "set":
      return [
        `🎯 Goal set: ${goal.criteria}`,
        "",
        `Verification: ${goal.evaluator}`,
        goal.gate ? `Gate command: ${goal.gate}` : null,
        `Max turns: ${goal.maxTurns}`,
        "",
        `✓ I will work toward this goal autonomously`,
        `✓ Verification runs automatically after each turn`,
        `✓ I will continue until goal is met or ${goal.maxTurns} turns reached`,
        "",
        `DO NOT manually retry or check status - the loop handles this automatically.`,
      ]
        .filter((line) => line !== null)
        .join("\n")

    case "status": {
      const statusEmoji =
        goal.status === "active"
          ? "⏳"
          : goal.status === "completed"
            ? "✅"
            : goal.status === "failed"
              ? "❌"
              : "⏱️"

      return [
        `${statusEmoji} Goal Status: ${goal.status.toUpperCase()}`,
        "",
        `Criteria: ${goal.criteria}`,
        `Progress: ${turnInfo}`,
        goal.gate ? `Gate: ${goal.gate}` : null,
        "",
        goal.lastCheck
          ? [
              `Last verification (${new Date(goal.lastCheck.timestamp).toLocaleTimeString()}):`,
              goal.lastCheck.met ? "✓ Goal met" : "✗ Goal not yet met",
              goal.lastCheck.output ? `Output: ${goal.lastCheck.output.slice(0, 200)}` : null,
              goal.lastCheck.exitCode !== undefined ? `Exit code: ${goal.lastCheck.exitCode}` : null,
            ]
              .filter((line) => line !== null)
              .join("\n")
          : "No verification checks yet",
        "",
        goal.status === "active" ? `Goal loop is active. Continuing toward goal...` : null,
      ]
        .filter((line) => line !== null)
        .join("\n")
    }

    case "stopped":
      return [
        `🛑 Goal stopped: ${goal.criteria}`,
        "",
        `Status: ${goal.status}`,
        `Completed: ${turnInfo}`,
        goal.lastCheck
          ? [`Final state:`, goal.lastCheck.met ? "✓ Goal was met" : "✗ Goal was not met"]
              .filter((line) => line !== null)
              .join("\n")
          : null,
      ]
        .filter((line) => line !== null)
        .join("\n")
  }
}

export const GoalTool = Tool.define(
  id,
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          // Get goal state from context (will be managed by goal-manager service)
          const goalState = ctx.extra?.goalState as
            | { activeGoal?: Goal; setGoal: (goal: Goal) => void }
            | undefined

          if (!goalState) {
            return yield* Effect.fail(
              new Error("Goal system not available. Goal state not found in context.")
            )
          }

          // Check if there's already an active goal
          if (goalState.activeGoal && goalState.activeGoal.status === "active") {
            return yield* Effect.fail(
              new Error(
                `A goal is already active: "${goalState.activeGoal.criteria}"\n` +
                  `Use goal_stop() to cancel it before setting a new goal.`
              )
            )
          }

          // Determine evaluator type
          const hasGate = params.gate !== undefined && params.gate.length > 0
          let evaluator: EvaluatorType

          if (params.evaluator) {
            evaluator = params.evaluator
            // Validate evaluator requirements
            if ((evaluator === "gate" || evaluator === "hybrid") && !hasGate) {
              return yield* Effect.fail(
                new Error(`Evaluator '${evaluator}' requires a gate command`)
              )
            }
          } else {
            // Default: gate if provided, otherwise self-report
            evaluator = hasGate ? "gate" : "self-report"
          }

          // Create new goal
          const goal: Goal = {
            id: ulid(),
            criteria: params.criteria,
            gate: params.gate,
            maxTurns: params.maxTurns || 10,
            evaluator,
            startedAt: Date.now(),
            currentTurn: 0,
            status: "active",
          }

          // Store goal in state
          goalState.setGoal(goal)

          return formatGoalOutput(goal, "set")
        }),
    }
  })
)

export const GoalStatusTool = Tool.define(
  "goal_status",
  Effect.gen(function* () {
    return {
      description: "Check the status of the current goal, including progress and last verification result.",
      parameters: GoalStatusParameters,
      execute: (_params: Schema.Schema.Type<typeof GoalStatusParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const goalState = ctx.extra?.goalState as { activeGoal?: Goal } | undefined

          if (!goalState || !goalState.activeGoal) {
            return "No active goal. Use goal() to set a goal."
          }

          return formatGoalOutput(goalState.activeGoal, "status")
        }),
    }
  })
)

export const GoalStopTool = Tool.define(
  "goal_stop",
  Effect.gen(function* () {
    return {
      description: "Stop the current goal loop. Provides final state and verification result.",
      parameters: GoalStopParameters,
      execute: (params: Schema.Schema.Type<typeof GoalStopParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const goalState = ctx.extra?.goalState as
            | { activeGoal?: Goal; setGoal: (goal: Goal) => void }
            | undefined

          if (!goalState || !goalState.activeGoal) {
            return "No active goal to stop."
          }

          const goal = goalState.activeGoal

          // Update goal status to stopped
          const stoppedGoal: Goal = {
            ...goal,
            status: goal.lastCheck?.met ? "completed" : "failed",
          }

          goalState.setGoal(stoppedGoal)

          let output = formatGoalOutput(stoppedGoal, "stopped")

          if (params.reason) {
            output += `\n\nReason: ${params.reason}`
          }

          return output
        }),
    }
  })
)
