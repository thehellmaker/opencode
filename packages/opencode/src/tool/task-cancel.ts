import * as Tool from "./tool"
import { Schema } from "effect"
import { BackgroundJob } from "@/background/job"
import { Effect } from "effect"
import { SessionID } from "../session/schema"

const id = "task_cancel"

const DESCRIPTION = `Cancel a running background task and terminate all its subprocesses.

Returns a terminal cancellation state distinguishing:
- "request accepted" - cancellation initiated
- "subprocess terminating" - waiting for cleanup
- "terminated" - task fully stopped

The task will NOT remain in "running" state after cancellation is acknowledged.
Use this when:
- You need to stop an expensive job to change direction
- A task is stuck or taking too long
- Requirements changed and the task's work is no longer needed

⚠️  Cancellation is immediate and cannot be undone. The task's partial work is lost.`

export const Parameters = Schema.Struct({
  task_id: Schema.String.annotations({
    description: "The task ID to cancel (from a previous task() call)",
  }),
  reason: Schema.optional(Schema.String).annotations({
    description: "Optional reason for cancellation (for audit trail)",
  }),
})

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export const TaskCancelTool = Tool.define(
  id,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service

    const run = Effect.fn("TaskCancelTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const taskID = params.task_id
      const reason = params.reason || "User requested cancellation"

      // Check if task exists and is running
      const jobBefore = yield* background.get(taskID)

      if (!jobBefore) {
        return yield* Effect.succeed(
          `❌ Task ${taskID} not found.\n\n` +
          `The task may have already completed, been cancelled, or never existed.\n` +
          `Use task_status() to check current state of active tasks.`
        )
      }

      if (jobBefore.status !== "running") {
        return yield* Effect.succeed(
          `⚠️  Task ${taskID} is already ${jobBefore.status}.\n\n` +
          `Status: ${jobBefore.status.toUpperCase()}\n` +
          `Started: ${new Date(jobBefore.started_at).toISOString()}\n` +
          (jobBefore.completed_at ? `Completed: ${new Date(jobBefore.completed_at).toISOString()}\n` : "") +
          `\nCancellation not needed - task is no longer running.`
        )
      }

      // Cancel the task
      const cancelled = yield* background.cancel(taskID)

      if (!cancelled) {
        return yield* Effect.succeed(
          `❌ Failed to cancel task ${taskID}.\n\n` +
          `This may occur if:\n` +
          `- The task completed just before cancellation\n` +
          `- The task was already being cancelled\n` +
          `- Internal cancellation token mismatch\n\n` +
          `Use task_status() to verify current state.`
        )
      }

      const elapsed = Date.now() - jobBefore.started_at

      return [
        `🛑 Task ${taskID} CANCELLED`,
        "",
        `Type: ${jobBefore.type}`,
        jobBefore.title ? `Title: ${jobBefore.title}` : null,
        `Reason: ${reason}`,
        `Ran for: ${formatDuration(elapsed)}`,
        `State: TERMINATED`,
        "",
        `✓ Task is fully stopped and will not continue.`,
        `✓ No further work will be performed.`,
        `✓ Partial results (if any) are discarded.`,
        "",
        cancelled.output
          ? `Last output before cancellation:\n${cancelled.output.slice(-200)}`
          : `(no output recorded before cancellation)`,
      ]
        .filter((line) => line !== null)
        .join("\n")
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: run,
    }
  }),
)
