# Subagent Footer Controls Enhancement

## Current State

OpenCode already has a subagent footer that shows running subagents:
- **Location**: Bottom panel accessed via command menu
- **Shows**: List of subagents with status (running/completed/cancelled/error)
- **Navigation**: Tab through subagents, view their activity
- **Missing**: No kill/steer/control actions

## Required Enhancement

Add interactive controls to the subagent footer panel matching Claude Code's workflow panel:

### Controls Needed

1. **Kill/Cancel** - Stop a running subagent
   - Keybinding: `Ctrl+C` or `x` when focused on subagent
   - Calls: `task_cancel(sessionID)`
   
2. **Steer** - Send guidance to running subagent
   - Keybinding: `s` when focused on subagent
   - Opens input prompt
   - Calls: `task_steer(sessionID, message)`

3. **Status Refresh** - Check current status
   - Keybinding: `r` when focused on subagent
   - Calls: `task_status(sessionID)`
   - Updates tab with latest info

4. **Navigate** - Already exists
   - Tab/Shift+Tab: Cycle through subagents
   - Escape: Close panel
   - Up/Down: Scroll activity

## Implementation Plan

### Files to Modify

1. **packages/opencode/src/cli/cmd/run/footer.subagent.tsx**
   - Add keybindings for kill (`x`), steer (`s`), refresh (`r`)
   - Add UI indicators showing available actions
   - Call SDK methods via callbacks

2. **packages/opencode/src/cli/cmd/run/footer.view.tsx**
   - Pass kill/steer callbacks to RunFooterSubagentBody
   - Connect to SDK client for tool execution

3. **packages/opencode/src/cli/cmd/run/types.ts**
   - Add callback types for subagent control actions

4. **packages/opencode/src/cli/cmd/run/footer.ts**
   - Wire up SDK client to footer API
   - Handle tool call responses

### UI Design

#### Current Subagent Footer
```
◔ Fix failing tests  1 of 3
│ [scrollable activity log]
│ 
│ 
↓ Escape to close │ Tab to cycle
```

#### Enhanced Subagent Footer
```
◔ Fix failing tests  1 of 3
│ [scrollable activity log]
│ 
│ 
↓ x: kill │ s: steer │ r: refresh │ Tab: cycle │ Esc: close
```

When pressing `s` for steer:
```
◔ Fix failing tests  1 of 3
│ [scrollable activity log]
│ 
│ Steer message: ▊
↓ Enter to send │ Esc to cancel
```

### Example Usage

**Scenario: Agent stuck in loop**
1. User sees subagent spinning in footer
2. Press `Ctrl+B` to open subagent panel
3. Navigate to stuck agent with Tab
4. Press `x` to kill
5. Confirmation: "Subagent cancelled"

**Scenario: Steer mid-flight**
1. User sees subagent working in footer
2. Press `Ctrl+B` to open subagent panel  
3. Navigate to agent with Tab
4. Press `s` for steer
5. Type: "Focus on authentication tests only"
6. Press Enter
7. Agent receives message and adjusts approach

**Scenario: Check progress**
1. Subagent running for 2 minutes
2. Press `Ctrl+B` to open subagent panel
3. Press `r` to refresh status
4. See updated: "Turn 3/10, fixing 2nd test file"

## Integration with Existing Tools

The task control tools are already implemented:
- ✅ `task_cancel(task_id, reason?)` - packages/opencode/src/tool/task-cancel.ts
- ✅ `task_steer(task_id, message)` - packages/opencode/src/tool/task-steer.ts
- ✅ `task_status(task_id)` - packages/opencode/src/tool/task-status.ts

Just need to call them from the UI layer via SDK client.

## Implementation Steps

### Step 1: Add Callbacks to Types
```typescript
// packages/opencode/src/cli/cmd/run/types.ts
export type SubagentControlAction =
  | { type: "kill"; sessionID: string; reason?: string }
  | { type: "steer"; sessionID: string; message: string }
  | { type: "refresh"; sessionID: string }
```

### Step 2: Enhance Footer Subagent Component
```typescript
// packages/opencode/src/cli/cmd/run/footer.subagent.tsx
export function RunFooterSubagentBody(props: {
  // ... existing props
  onKill: (sessionID: string) => void
  onSteer: (sessionID: string, message: string) => void
  onRefresh: (sessionID: string) => void
}) {
  const [steerMode, setSteerMode] = createSignal(false)
  const [steerMessage, setSteerMessage] = createSignal("")
  
  useKeyboard((event) => {
    if (!props.active()) return
    
    const currentTab = tab()
    if (!currentTab) return
    
    // Kill subagent
    if (event.name === "x" && !steerMode()) {
      event.preventDefault()
      props.onKill(currentTab.sessionID)
      return
    }
    
    // Steer subagent
    if (event.name === "s" && !steerMode() && currentTab.status === "running") {
      event.preventDefault()
      setSteerMode(true)
      return
    }
    
    // Refresh status
    if (event.name === "r" && !steerMode()) {
      event.preventDefault()
      props.onRefresh(currentTab.sessionID)
      return
    }
    
    // Steer mode: send message
    if (event.name === "return" && steerMode()) {
      event.preventDefault()
      const msg = steerMessage()
      if (msg.trim()) {
        props.onSteer(currentTab.sessionID, msg)
        setSteerMessage("")
        setSteerMode(false)
      }
      return
    }
    
    // Steer mode: cancel
    if (event.name === "escape" && steerMode()) {
      event.preventDefault()
      setSteerMessage("")
      setSteerMode(false)
      return
    }
  })
  
  // ... rest of component
}
```

### Step 3: Wire Up SDK Calls
```typescript
// packages/opencode/src/cli/cmd/run/footer.ts
// In RunFooter constructor, add handlers:

const handleSubagentKill = async (sessionID: string) => {
  const sdk = opts.sdk
  await sdk.tool.execute({
    sessionID: opts.sessionID(),
    tool: "task_cancel",
    parameters: { task_id: sessionID, reason: "User cancelled" }
  })
  
  // Update footer state
  this.event({
    type: "subagent.update",
    sessionID,
    status: "cancelled"
  })
}

const handleSubagentSteer = async (sessionID: string, message: string) => {
  const sdk = opts.sdk
  await sdk.tool.execute({
    sessionID: opts.sessionID(),
    tool: "task_steer", 
    parameters: { task_id: sessionID, message }
  })
  
  // Show confirmation
  this.event({
    type: "status",
    status: "Guidance sent to subagent"
  })
}

const handleSubagentRefresh = async (sessionID: string) => {
  const sdk = opts.sdk
  const result = await sdk.tool.execute({
    sessionID: opts.sessionID(),
    tool: "task_status",
    parameters: { task_id: sessionID }
  })
  
  // Update tab with latest status
  this.event({
    type: "subagent.update",
    sessionID,
    lastUpdatedAt: Date.now()
  })
}
```

### Step 4: Update Footer Help Text
```typescript
// Show available actions in footer help line
const helpText = createMemo(() => {
  const current = tab()
  if (!current) return "Esc: close"
  
  const actions = ["Esc: close", "Tab: cycle"]
  
  if (current.status === "running") {
    actions.unshift("x: kill", "s: steer", "r: refresh")
  } else {
    actions.unshift("r: refresh")
  }
  
  return actions.join(" │ ")
})
```

## Testing Plan

1. **Kill Test**
   - Start background subagent
   - Open subagent panel
   - Press `x` to kill
   - Verify: subagent status changes to "cancelled"
   - Verify: process actually terminates

2. **Steer Test**
   - Start background subagent
   - Open subagent panel
   - Press `s` for steer
   - Type message
   - Press Enter
   - Verify: message delivered to subagent
   - Verify: subagent output shows it received guidance

3. **Refresh Test**
   - Start background subagent
   - Open subagent panel
   - Wait for activity
   - Press `r` to refresh
   - Verify: status updates with latest info

4. **Navigation Test**
   - Start 3 background subagents
   - Open subagent panel
   - Tab through all 3
   - Verify: can navigate and control each

## Success Criteria

- [x] Subagent footer shows all running background tasks
- [ ] User can kill subagents with `x` key
- [ ] User can steer subagents with `s` key + message
- [ ] User can refresh status with `r` key
- [ ] Tab navigation works between multiple subagents
- [ ] Help text shows available actions
- [ ] Confirmation messages appear after actions
- [ ] Works with both running and completed subagents

## Comparison to Claude Code

| Feature | Claude Code | OpenCode Current | After Enhancement |
|---------|-------------|------------------|-------------------|
| Show running subagents | ✅ | ✅ | ✅ |
| Navigate between them | ✅ | ✅ | ✅ |
| View activity log | ✅ | ✅ | ✅ |
| Kill subagent | ✅ | ❌ | ✅ |
| Steer subagent | ✅ | ❌ | ✅ |
| Check status | ✅ | ❌ | ✅ |
| Keyboard shortcuts | ✅ | Partial | ✅ |

## Related Features

This enhancement pairs with:
- Phase 1: Background task control tools (already implemented)
- Goal loop: Users can kill/steer goal-driven agents mid-flight
- /loop command: Users can control periodic tasks
- Field notes: Users can verify subagent work before continuing

## Future Enhancements

1. **Pause/Resume** - Temporarily pause a subagent
2. **Priority Control** - Adjust subagent priority
3. **Resource Limits** - Set max turns/time per subagent
4. **Bulk Actions** - Kill/steer multiple subagents at once
5. **Subagent Chat** - Interactive Q&A with running subagent
