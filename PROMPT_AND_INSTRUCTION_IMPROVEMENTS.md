# OpenCode Prompt & Instruction Improvements

Based on comparison with Claude Code's behavior and analysis of work-agent field notes failures, OpenCode's system prompts, tool descriptions, and instruction handling have critical gaps.

## Problems Identified

### 1. **No Field Notes Protocol in System Prompt** (CRITICAL)

**Claude Code has:**
```
After every meaningful step, persist to disk before moving on, proactively, unasked, never batched to end-of-session.
A "step" = built/changed artifact, launched/checked/deployed job, ran something, made decision, learned from meeting/message/source, got user correction, or hit gotcha.
```

**OpenCode has:**
- No mention of field notes in system prompt
- No accountability requirement
- No "persist before moving on" discipline
- Field notes plugin exists but agents ignore it under load

**Evidence:** Aug 9 field notes lines 7-15 show FOUR consecutive gaps with 23-37 tool calls but ZERO notes.

**Fix Needed:** Add to system prompt (anthropic.txt, default.txt, etc.):
```markdown
# Accountability and Memory

You have access to the field_note tool for durable memory. Use it after EVERY meaningful step:
- Built or changed an artifact
- Launched, checked, or deployed a job
- Ran or root-caused something
- Made a decision
- Learned from meeting/message/source
- Got a user correction
- Hit a repository/tool/workflow gotcha

Types of notes:
- observation: raw measurement with units and source
- result: what you concluded from observations
- decision: choice made and why
- blocker: what's blocking progress
- next_step: what to do next
- goal: current objective

**CRITICAL:** Persist BEFORE moving on, not batched to end of session. A turn with significant work (files changed, tool errors, user corrections) but zero notes is a gap. Gaps mean lost reasoning.

You will be reminded if you create gaps. Do not ignore the reminder.
```

### 2. **Task Tool Description Misses Notification Protocol**

**Current task.txt line 14:**
```
2. Once you have delegated work to an agent, do not duplicate that work yourself. 
   Continue with non-overlapping tasks, or wait for the result. For background tasks, 
   you will be notified automatically when the result is ready.
```

**Problem:** Says "wait for result" but doesn't explain HOW notification works.

**Claude Code's equivalent is explicit:**
```
You will be notified automatically when it finishes.
DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work.
```

**Fix:** Update task.txt line 14-15:
```
2. Once you have delegated work to an agent, do not duplicate that work yourself.
   For background tasks (background=true):
   - You will be notified automatically when it completes via <task-notification> in a future turn
   - DO NOT sleep, poll, ask for status, or check on progress
   - DO NOT duplicate its work - continue with non-overlapping tasks or end your response
   - Use task_status(task_id) ONCE if you genuinely need current state before deciding next action
   
   For foreground tasks (background=false or omitted):
   - The result is returned immediately in this turn
   - You have the full output to work with right away
```

### 3. **Compaction Prompt Has No Context Continuity Guidance**

**Current compaction.txt:**
```
You are an anchored context summarization assistant for coding sessions.
Summarize only the conversation history you are given...
```

**Problem:** No guidance on WHAT to preserve for code debugging/continuation.

**Claude Code equivalent includes:**
- Preserve file paths and line numbers exactly
- Keep error messages verbatim
- Maintain decision rationale
- Link related file changes

**Fix:** Update compaction.txt:
```
You are an anchored context summarization assistant for coding sessions.

When summarizing, preserve these EXACTLY:
- File paths and line numbers (e.g., "src/agent/agent.ts:142")
- Error messages verbatim (don't paraphrase stack traces)
- Decision rationale ("chose X because Y constraint")
- Measurements with units (e.g., "p50 latency 3.2s", not "slow")
- Test/build commands that were run
- Git commit SHAs and branch names
- API endpoints and their observed behavior

Compress verbose output but never lose:
- Which approach was tried and why it failed
- What verification was done
- What dependencies exist between files/changes

If the previous summary has details that are STILL RELEVANT (an unresolved bug, 
a planned next step, a discovered constraint), merge them forward.

Remove only:
- Obsolete exploration that led nowhere
- Superseded approaches
- Resolved issues

The compressed context must let the session CONTINUE work, not just understand 
what happened.
```

### 4. **Skill Tool Description Too Vague**

**Current skill.txt:**
```
Load a specialized skill when the task at hand matches one of the skills listed 
in the system prompt.
Use this tool to inject the skill's instructions and resources into current conversation.
The skill name must match one of the skills listed in your system prompt.
```

**Problem:** 
- No guidance on WHEN to load vs when to work directly
- No mention that skills are CONDITIONAL (if this then that)
- No clarification that skills are additional instructions, not replacements

**Fix:** Update skill.txt:
```
Load a specialized skill when the task at hand matches one of the skills listed
in the system prompt.

A skill provides:
- Specialized instructions for a specific task domain
- References to domain-specific scripts/files/docs
- Conditional workflow steps ("if X then Y")
- Context that wouldn't fit in the base system prompt

When to use skill vs work directly:
- Use skill: Task matches a listed skill description (e.g., "/code-review", "/eval-studio")
- Work directly: Task is straightforward file edit/read/bash command

Skills are ADDITIVE: They add instructions to your base capabilities, not replace them.
You still have access to all tools after loading a skill.

The skill name must match one listed in your system prompt exactly.
Once loaded, follow the skill's instructions for that task domain.
```

### 5. **Agent Generate Prompt Misses Subagent Model Guidance**

**Current generate.txt has:**
- Persona design
- System prompt architecture
- Identifier creation

**Missing:**
- When to specify model vs inherit
- How to choose model for a subagent
- Rationale documentation requirement

**Problem:** From work-agent field notes analysis:
```
slack-scanner:    model: fireworks-ai/.../glm-5p2
email-scanner:    model: fireworks-ai/.../qwen3p7-plus  
pr-reviewer:      model: amazon-bedrock/.../claude-opus-5
calendar-checker: model: fireworks-ai/.../qwen3p7-plus
```
No documented rationale for these choices.

**Fix:** Add section 7 to generate.txt after "Example agent descriptions":
```
7. **Model Selection Guidance**:

When specifying a model for an agent, include a rationale. Default is to inherit 
the parent session's model unless there's a specific reason to override.

Override the model when:
- The task needs higher reasoning (use opus/sonnet for hard problems)
- The task is simple and speed matters (use haiku/small models for scanning)
- The task has specific model strengths (e.g., Claude for code review)

Document your choice:
{
  "model": "anthropic/claude-opus-5",
  "modelRationale": "Code review requires deep reasoning about correctness, 
                     edge cases, and architectural implications. Opus provides 
                     the thoroughness needed for production review quality.",
  ...
}

If you don't specify a model, the agent inherits from its parent. This is 
usually correct - only override when you have a specific reason.

Examples:
- Log scanning: smaller/faster model (routine pattern matching)
- PR review: larger/thorough model (needs deep reasoning)
- File reads: inherit (no special requirement)
- Security review: largest model (catch subtle issues)
```

### 6. **System Prompt Missing "Capability Honesty" Section**

**From AGENTS.md lines 146-151:**
```
Never declare a tool, MCP server, or capability "unavailable", "not connected", 
or "can't do X" without first attempting the documented path and showing the 
command output.
```

**OpenCode system prompts have NO equivalent guidance.**

**Result:** Agents claim things don't work without trying them first.

**Fix:** Add to all system prompts (anthropic.txt, default.txt, etc.) after "Tool usage policy":
```markdown
# Capability Honesty

NEVER declare a tool, MCP server, or capability "unavailable", "not connected", 
or "can't do X" without:
1. First attempting the documented usage path
2. Showing the actual command output or error
3. Verifying the error is real, not a usage mistake

Distinguish what you HAVE from what you ASSUME:
- ✓ "I ran X and got error Y (output shown)"
- ✗ "X is not available" (without trying)
- ✓ "I verified X, here is the output"
- ✗ "I have not checked X yet" (presented as if it's unavailable)

Before saying "I can't":
- Check if there's a skill for this task
- Try the documented path first
- Show the actual failure, don't assume

When a task needs data (logs, traces, database), fetch it and answer from results.
Do not substitute a plausible guess for a lookup you can run.
```

### 7. **No "One Source of Truth" Principle**

**From AGENTS.md code quality rules (lines 113-124):**
```
No echo comments or one-line docstrings. No untyped bags. One source of truth. 
DRY, KISS, YAGNI.
```

**OpenCode prompts mention code quality but miss this specific principle.**

**Fix:** Add to system prompts under "Doing tasks" section:
```markdown
# Code Quality Principles

When writing or editing code:

**One Source of Truth:**
- Shared invariants live in ONE function/model, not copy-pasted checks
- Constants defined once, imported where needed
- If you find duplicated logic, extract it before adding more

**No Untyped Bags:**
- Never use bare `any`, `dict`, `object` as domain types
- No `**kwargs` for structured data
- Define TypedDict, dataclass, or typed model instead
- Parse external JSON into typed models at the boundary

**DRY, KISS, YAGNI:**
- Smallest design that fully solves the ask
- Don't build for hypothetical future requirements
- Three similar lines is better than premature abstraction
- Delete aggressively

**Comments Earn Their Place:**
- Only write comments for non-obvious WHY (constraint, quirk, workaround)
- Never restate what the code does (name + types already say that)
- Delete comments that just narrate the next line
```

### 8. **TodoWrite Instructions Are Task Management Only**

**Current anthropic.txt lines 23-49 focus on TodoWrite tool.**

**Problem:** Too specific to one tool. Should be about general task tracking.

**Fix:** Generalize to cover all task tracking approaches:
```markdown
# Task Management

Use task tracking tools to give the user visibility into your progress:
- TodoWrite: for simple linear task lists
- TaskCreate/TaskUpdate: for tracking agent spawns and long-running work

Use task tracking VERY frequently:
- Break complex work into steps
- Mark tasks in_progress when starting
- Mark tasks completed IMMEDIATELY when done (don't batch)
- Update tasks if you learn new information that changes the plan

Task tracking prevents you from forgetting important work and shows the user 
what's happening, especially for long-running tasks.
```

## Implementation Priority

**Phase 1 (Immediate - Week 1):**
1. Add field notes protocol to all system prompts ✅ HIGH IMPACT
2. Fix task.txt notification guidance ✅ BLOCKING
3. Update compaction.txt with continuity rules ✅ HIGH IMPACT

**Phase 2 (Week 2):**
4. Improve skill.txt clarity
5. Add capability honesty section
6. Add code quality principles

**Phase 3 (Documentation):**
7. Add model selection guidance to generate.txt
8. Generalize task management section

## Files to Modify

```
packages/opencode/src/session/prompt/
├── anthropic.txt          (add field_note protocol, capability honesty, code quality)
├── default.txt            (same as anthropic)
├── gpt.txt                (same)
├── gemini.txt             (same)
├── beast.txt              (same)
├── kimi.txt               (same)
├── codex.txt              (same)
├── trinity.txt            (same)
└── compaction.txt         (add continuity guidance)

packages/opencode/src/tool/
├── task.txt               (fix notification protocol)
├── skill.txt              (clarify when to use)

packages/opencode/src/agent/
└── generate.txt           (add model selection section)
```

## Success Metrics

After these fixes:
- [ ] Zero gap scores ≥2 without field notes in 100 test runs
- [ ] Agents try documented paths before claiming unavailability
- [ ] Compacted summaries preserve file paths, errors, decisions exactly
- [ ] Subagents created with model rationale documented
- [ ] Task notifications understood (no polling loops observed)

## Backward Compatibility

✅ All changes are prompt/description improvements - no code changes
✅ Existing behavior preserved, guidance added
✅ No breaking changes to tool interfaces

## References

- Work-agent field notes: `scratch/field-notes/2026-08-06.md`, `2026-08-08.md`, `2026-08-09.md`
- AGENTS.md from work-agent (canonical instruction patterns)
- Claude Code observed behavior (notification protocol, capability honesty)
