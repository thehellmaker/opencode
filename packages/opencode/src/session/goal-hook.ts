import { Effect } from "effect"
import type { Goal, EvalResult } from "./goal-eval"
import { evaluateGoal } from "./goal-eval"

/**
 * Hook that runs after agent turn to check goal status and re-inject work if needed.
 * This is what makes the goal loop "autonomous" - agent continues until goal met.
 */
export interface GoalHookContext {
  activeGoal?: Goal
  setGoal: (goal: Goal) => void
  injectFollowUp: (message: { role: "user"; content: string }) => void
  agentOutput?: string
}

export function createGoalHook(ctx: GoalHookContext) {
  return Effect.gen(function* () {
    const { activeGoal, setGoal, injectFollowUp, agentOutput } = ctx

    // No active goal - nothing to do
    if (!activeGoal || activeGoal.status !== "active") {
      return
    }

    // Increment turn counter
    const updatedGoal: Goal = {
      ...activeGoal,
      currentTurn: activeGoal.currentTurn + 1,
    }

    // Check if we've hit turn limit
    if (updatedGoal.currentTurn >= updatedGoal.maxTurns) {
      // Run verification one last time for final state
      const finalCheck = yield* evaluateGoal(updatedGoal, agentOutput).pipe(
        Effect.catchAll(() =>
          Effect.succeed({
            met: false,
            output: "Final verification failed to run",
            timestamp: Date.now(),
          } as EvalResult)
        )
      )

      const timeoutGoal: Goal = {
        ...updatedGoal,
        status: "timeout",
        lastCheck: finalCheck,
      }

      setGoal(timeoutGoal)

      // Inject timeout message
      injectFollowUp({
        role: "user",
        content: [
          `⏱️ Goal timed out after ${timeoutGoal.maxTurns} turns.`,
          "",
          `Goal: ${timeoutGoal.criteria}`,
          "",
          "Final verification:",
          finalCheck.met ? "✓ Goal was met" : "✗ Goal was not met",
          finalCheck.output ? `\nOutput:\n${finalCheck.output}` : null,
          "",
          timeoutGoal.gate
            ? `You can continue manually or adjust the approach. Use goal_stop() to clear this goal.`
            : null,
        ]
          .filter((line) => line !== null)
          .join("\n"),
      })

      return
    }

    // Evaluate goal
    const evalResult = yield* evaluateGoal(updatedGoal, agentOutput).pipe(
      Effect.catchAll((error) =>
        Effect.succeed({
          met: false,
          output: `Verification error: ${error}`,
          timestamp: Date.now(),
        } as EvalResult)
      )
    )

    // Update goal with latest check
    const goalWithCheck: Goal = {
      ...updatedGoal,
      lastCheck: evalResult,
    }

    if (evalResult.met) {
      // Goal is met! Mark as completed and notify
      const completedGoal: Goal = {
        ...goalWithCheck,
        status: "completed",
      }

      setGoal(completedGoal)

      injectFollowUp({
        role: "user",
        content: [
          `🎯 Goal completed!`,
          "",
          `Goal: ${completedGoal.criteria}`,
          `Turns: ${completedGoal.currentTurn}/${completedGoal.maxTurns}`,
          "",
          "Verification result:",
          evalResult.output || "(no output)",
          evalResult.exitCode !== undefined ? `\nExit code: ${evalResult.exitCode}` : null,
          evalResult.duration !== undefined
            ? `Duration: ${Math.round(evalResult.duration)}ms`
            : null,
          "",
          "✓ The goal has been met. No further action needed unless you want to refine or extend the work.",
        ]
          .filter((line) => line !== null)
          .join("\n"),
      })
    } else {
      // Goal not met - continue working
      setGoal(goalWithCheck)

      injectFollowUp({
        role: "user",
        content: [
          `Goal not yet met: ${goalWithCheck.criteria}`,
          "",
          `Turn ${goalWithCheck.currentTurn}/${goalWithCheck.maxTurns}`,
          "",
          "Verification result:",
          evalResult.output || "(no output)",
          evalResult.exitCode !== undefined ? `Exit code: ${evalResult.exitCode}` : null,
          "",
          "Continue working toward the goal. The verification will run automatically after your next turn.",
          "",
          goalWithCheck.gate ? `Verification command: ${goalWithCheck.gate}` : null,
          "",
          "DO NOT manually run the verification command - it runs automatically.",
        ]
          .filter((line) => line !== null)
          .join("\n"),
      })
    }
  })
}

/**
 * Register goal hook to run after agent turns.
 * This should be called during session initialization.
 */
export function registerGoalHook(
  sessionContext: any,
  goalState: {
    activeGoal?: Goal
    setGoal: (goal: Goal) => void
  }
) {
  // Hook into agent_end event
  // Implementation depends on session/agent architecture
  // This is a placeholder showing the integration point

  sessionContext.on("agent_end", (event: { agentOutput: string }) => {
    const hookCtx: GoalHookContext = {
      activeGoal: goalState.activeGoal,
      setGoal: goalState.setGoal,
      injectFollowUp: (message) => {
        // Queue message for next turn
        sessionContext.injectMessage(message)
      },
      agentOutput: event.agentOutput,
    }

    // Run hook (fire and forget or await depending on requirements)
    Effect.runPromise(createGoalHook(hookCtx)).catch((error) => {
      console.error("Goal hook failed:", error)
    })
  })
}
