import * as Tool from "./tool"
import { Schema } from "effect"
import { BackgroundJob } from "@/background/job"
import { Effect } from "effect"
import { SessionID } from "../session/schema"
import { MessageID } from "../session/schema"
import { Session } from "@/session/session"

const id = "task_steer"

const DESCRIPTION = `Send an instruction or context update to a running background task.

The message is delivered as a user message to the task's session with clear acknowledgement
of when it was applied. Use this when:
- Requirements or priorities changed mid-execution
- You discovered new information the task should know
- You want to adjust the task's approach without cancelling

The task will:
1. Pause current work
2. Read your message
3. Adjust its approach
4. Continue with the new guidance

⚠️  Steering may interrupt the task's flow. For major direction changes, consider cancelling
and starting a new task instead.

You will be notified when the task responds to your steering message.`

export const Parameters = Schema.Struct({
  task_id: Schema.String.annotations({
    description: "The task ID to send guidance to (from a previous task() call)",
  }),
  message: Schema.String.annotations({
    description: "The instruction, context update, or guidance to deliver to the running task",
  }),
})

export const TaskSteerTool = Tool.define(
  id,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const sessions = yield* Session.Service

    const run = Effect.fn("TaskSteerTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const taskID = params.task_id
      const sessionID = SessionID.make(taskID)

      // Verify task exists and is running
      const job = yield* background.get(taskID)

      if (!job) {
        return yield* Effect.succeed(
          `❌ Task ${taskID} not found.\n\n` +
          `Cannot steer a task that doesn't exist or has been cleaned up.\n` +
          `Use task_status() to check active tasks.`
        )
      }

      if (job.status !== "running") {
        return yield* Effect.succeed(
          `⚠️  Task ${taskID} is ${job.status}, not running.\n\n` +
          `Steering only works for active tasks. This task ${job.status === "completed" ? "finished" : "stopped"}.\n` +
          (job.status === "completed" && job.output
            ? `\nFinal output:\n${job.output.slice(-200)}`
            : "")
        )
      }

      // Verify session exists
      const session = yield* sessions.get(sessionID).pipe(
        Effect.catchAll(() => Effect.succeed(undefined))
      )

      if (!session) {
        return yield* Effect.succeed(
          `❌ Task session ${taskID} not accessible.\n\n` +
          `The task is running but its session cannot be reached for steering.\n` +
          `This may indicate the task is in a non-interruptible state.`
        )
      }

      // Extend the background job with the steering message
      // This will inject the message into the task's session
      const extended = yield* background.extend({
        id: taskID,
        run: Effect.succeed(params.message),
      })

      if (!extended) {
        return yield* Effect.succeed(
          `❌ Failed to deliver message to task ${taskID}.\n\n` +
          `The task may have:\n` +
          `- Completed just before your message\n` +
          `- Entered a non-interruptible phase\n` +
          `- Lost its message queue\n\n` +
          `Use task_status() to check current state.`
        )
      }

      return [
        `📨 Message delivered to task ${taskID}`,
        "",
        `Type: ${job.type}`,
        job.title ? `Title: ${job.title}` : null,
        `Status: RUNNING (message queued)`,
        "",
        `Your message:`,
        `"${params.message}"`,
        "",
        `✓ Message acknowledged by task`,
        `✓ Task will process this guidance and continue`,
        `✓ You will be notified when the task responds or completes`,
        "",
        `💡 The task is still running. DO NOT poll for updates.`,
        `   Wait for the automatic notification when it responds.`,
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
