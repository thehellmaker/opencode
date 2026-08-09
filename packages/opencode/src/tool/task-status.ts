import * as Tool from "./tool"
import { Schema } from "effect"
import { BackgroundJob } from "@/background/job"
import { Effect } from "effect"
import { SessionID } from "../session/schema"

const id = "task_status"

const DESCRIPTION = `Inspect the current status of a background task. Returns:
- Current state (running/completed/error/cancelled)
- Activity summary (what it's currently doing)
- Timestamps (started_at, completed_at if finished)
- Recent output (last 500 chars if available)
- Progress indicators

Use this to check on long-running tasks before deciding whether to cancel or wait.
DO NOT poll repeatedly - check once, make a decision, and act.`

export const Parameters = Schema.Struct({
  task_id: Schema.String.annotations({
    description: "The task ID to inspect (from a previous task() call)",
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

function truncateOutput(text: string | undefined, maxChars: number = 500): string {
  if (!text) return "(no output yet)"
  if (text.length <= maxChars) return text
  return text.slice(-maxChars) + "\n... (truncated, showing last 500 chars)"
}

export const TaskStatusTool = Tool.define(
  id,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service

    const run = Effect.fn("TaskStatusTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const taskID = params.task_id
      const sessionID = SessionID.make(taskID)

      // Get job info from background service
      const job = yield* background.get(taskID)

      if (!job) {
        return yield* Effect.succeed(
          `Task ${taskID} not found. It may have been:\n` +
          `- Completed and cleaned up\n` +
          `- Never started\n` +
          `- Created in a different session\n\n` +
          `Use list() to see all active background tasks.`
        )
      }

      const now = Date.now()
      const elapsed = now - job.started_at
      const output = truncateOutput(job.output)

      let statusLine = ""
      switch (job.status) {
        case "running":
          statusLine = `⏳ RUNNING (${formatDuration(elapsed)} elapsed)`
          break
        case "completed":
          statusLine = `✅ COMPLETED (took ${formatDuration(elapsed)})`
          break
        case "error":
          statusLine = `❌ ERROR (failed after ${formatDuration(elapsed)})`
          break
        case "cancelled":
          statusLine = `🛑 CANCELLED (stopped after ${formatDuration(elapsed)})`
          break
      }

      const parts = [
        `Task Status: ${job.id}`,
        `Type: ${job.type}`,
        job.title ? `Title: ${job.title}` : null,
        `Status: ${statusLine}`,
        `Started: ${new Date(job.started_at).toISOString()}`,
        job.completed_at ? `Completed: ${new Date(job.completed_at).toISOString()}` : null,
        "",
        job.status === "error" && job.error
          ? `Error:\n${job.error}`
          : `Recent Output:\n${output}`,
        "",
        job.status === "running"
          ? `💡 Task is still working. You will be notified when it finishes.\n` +
            `   DO NOT poll repeatedly - wait for the automatic notification.`
          : null,
        job.metadata ? `\nMetadata: ${JSON.stringify(job.metadata, null, 2)}` : null,
      ]

      return parts.filter((p) => p !== null).join("\n")
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: run,
    }
  }),
)
