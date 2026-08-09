# OpenCode Reliability Fixes - Making It Claude Code Quality

Based on analysis of production failures in work-agent field notes (2026-08-06 to 2026-08-09), this branch implements structural fixes to match Claude Code's reliability.

## Critical Issues Fixed

### 1. Background Task Control (BLOCKING)
**Problem:** `opencode-background-task-control-issue.md`
- Cancellation returns "Additional context sent" but task stays `running`
- No ability to inspect current status or recent output
- Cannot reliably stop expensive jobs

**Fix:** Add `task_status`, `task_cancel`, and `task_steer` tools
- `task_status(task_id)`: running state, current activity, timestamps, bounded recent output
- `task_cancel(task_id)`: terminate subagent + all child processes, report terminal cancellation state
- `task_steer(task_id, message)`: deliver operator instruction with clear acknowledgement

**Files:**
- `packages/opencode/src/tool/task-status.ts` (NEW)
- `packages/opencode/src/tool/task-cancel.ts` (NEW)
- `packages/opencode/src/tool/task-steer.ts` (NEW)
- `packages/core/src/background-job.ts` (MODIFY - add status inspection, child process tracking)

### 2. Field Notes Gap Detection (BLOCKING)
**Problem:** Aug 9 field notes lines 7-15, 220
- Agents fire 23-37 evidence calls per turn but record **ZERO notes**
- Gap scoring exists but doesn't enforce accountability
- Critical reasoning lost between sessions

**Fix:** Hard enforcement in field-notes plugin
- Gap score ≥2 without note = BLOCK turn completion, not silent gap line
- Add mandatory note reminder before turn ends if filesChanged || toolErrors || userCorrection
- Make gap threshold configurable but default to strict (2)

**Files:**
- `opencode-field-notes/src/hooks.ts` (MODIFY - add blocking enforcement)
- `opencode-field-notes/src/gap.ts` (MODIFY - add pre-turn-end check)

### 3. Checkpoint Resume (BLOCKING)
**Problem:** Aug 6 lines 166-194
- `live_backtracking_e2e.py` regenerates new spine on resume instead of continuing
- Mixed artifacts from multiple runs in same directory
- 60 minutes of work lost to timeout cascade

**Fix:** Immutable spine hash-based checkpointing
- Hash parent state (prompt + Session + VFS + TurnContext) for stable resume key
- On resume, load cached spine from hash-keyed checkpoint file
- Atomic writes: temp file + rename to prevent partial corruption
- Separate attempt directories to prevent artifact mixing

**Files:**
- `packages/opencode/src/session/checkpoint.ts` (NEW)
- `packages/opencode/src/tool/task.ts` (MODIFY - use checkpoint for resume)

### 4. Error Classification (HIGH)
**Problem:** Aug 6 lines 176-193
- "14 SageMaker errors, 9 Redis failures, 56 tool failures" in stderr
- Final score records: "**0 infrastructure errors, 0 retryable errors**"
- Silent failures contaminate "clean" results

**Fix:** Structured error classification in tool results
- Classify: `infrastructure_error`, `retryable_error`, `model_error`, `user_error`
- Persist classification in tool result metadata
- Surface in task summary/status
- Add `--strict-errors` mode that fails on any infrastructure error

**Files:**
- `packages/opencode/src/tool/tool.ts` (MODIFY - add error classification)
- `packages/opencode/src/tool/result.ts` (NEW - typed error categories)

### 5. Determinism Gates (HIGH)
**Problem:** Aug 6 line 190
- "all 10 rendered text parts had SHA-256 `74e994cd...`, but evaluator returned 5 PASS/5 FAIL"
- Identical inputs produce random outputs, accepted as normal

**Fix:** Optional determinism verification
- SHA-256 hash identical inputs (prompt + model + temperature=0)
- Compare outputs, fail if divergent on temperature=0
- Add `--require-determinism` flag for critical workflows
- Log determinism violations separately from errors

**Files:**
- `packages/opencode/src/agent/determinism.ts` (NEW)
- `packages/opencode/src/tool/task.ts` (MODIFY - add determinism check option)

### 6. Audit Verification (MEDIUM)
**Problem:** Aug 6 line 174
- LLM-generated audits claim "invalid sort_column_name caused 0/10"
- Actual evaluator says "sole failed fact was lists_multiple_pos"
- High-confidence hallucinations treated as ground truth

**Fix:** Require audit reasons to match actual evidence
- Parse structured evaluator output (facts passed/failed)
- Cross-reference LLM audit against structured evidence
- Flag mismatches as `audit_hallucination` warning
- Add `--verify-audits` mode that rejects mismatched audits

**Files:**
- `packages/opencode/src/audit/verify.ts` (NEW)

### 7. Data Loss Prevention (CRITICAL)
**Problem:** Aug 6 line 41
- "6 validated DPO pairs... absent from disk. Most likely destroyed by cleanup that removed 77 worktrees"
- Gitignored artifacts + non-force worktree remove = silent destruction

**Fix:** Protected artifact directories
- Mark directories as `.keep` or `.artifact` to prevent cleanup
- Pre-removal scan: warn if gitignored artifacts exist
- Add `--dry-run` to worktree cleanup commands
- Optional auto-commit of artifacts before worktree removal

**Files:**
- Add `.artifact` convention documentation
- Shell script: `scripts/safe-worktree-remove.sh` (NEW)

### 8. Subagent Model Selection (LOW - DOCS)
**Problem:** Random model assignments
- slack-scanner: GLM 5.2
- email-scanner: Qwen 3.7 Plus
- pr-reviewer: Claude Opus 5
- calendar-checker: Qwen 3.7 Plus
- No documented rationale

**Fix:** Document model selection strategy
- Add `model_rationale` field to agent config frontmatter
- Default strategy: use parent model unless overridden
- Document when to use smaller/larger models

**Files:**
- `.opencode/agents/README.md` (NEW)
- Update all `.opencode/agents/*.md` with rationale

## Implementation Priority

1. **Phase 1 (BLOCKING - Week 1):**
   - Background task control (status/cancel/steer)
   - Field notes gap enforcement
   - Checkpoint resume

2. **Phase 2 (HIGH - Week 2):**
   - Error classification
   - Determinism gates
   - Audit verification

3. **Phase 3 (POLISH - Week 3):**
   - Data loss prevention helpers
   - Model selection documentation
   - Integration tests

## Testing Strategy

Each fix includes:
1. Unit tests for new modules
2. Integration test demonstrating the failure mode
3. Regression test proving the fix works
4. Documentation in `docs/reliability/`

## Success Criteria

- [ ] Background tasks can be canceled reliably (< 5s from request to confirmed stop)
- [ ] Zero gap scores ≥2 without notes in 100 test runs
- [ ] Resume continues from checkpoint, not regenerates (verify via artifact timestamps)
- [ ] 100% error classification coverage (no silent stderr failures)
- [ ] Determinism violations logged and gated in strict mode
- [ ] Audit hallucinations flagged automatically
- [ ] Worktree cleanup warns before destroying artifacts
- [ ] All subagents have documented model rationale

## Backward Compatibility

All fixes are opt-in or backward-compatible:
- New tools don't break existing workflows
- Gap enforcement behind `FIELD_NOTES_STRICT=true`
- Determinism checks behind `--require-determinism`
- Audit verification behind `--verify-audits`
- Existing checkpoints ignored if format changes

## References

- Work-agent field notes: `scratch/field-notes/2026-08-06.md`, `2026-08-08.md`, `2026-08-09.md`
- Background task issue: `scratch/repos/opencode-background-task-control-issue.md`
- Claude Code unminified source analysis: `~/Downloads/src` (research from Aug 9)
