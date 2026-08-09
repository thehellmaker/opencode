/** @jsxImportSource @opentui/solid */
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { registerOpencodeSpinner } from "@opencode-ai/tui/component/register-spinner"
import { Show, createMemo, createSignal, indexArray } from "solid-js"
import { SPINNER_FRAMES } from "@opencode-ai/tui/component/spinner"
import { RunEntryContent, separatorRows } from "./scrollback.writer"
import type { FooterSubagentDetail, FooterSubagentTab, RunDiffStyle } from "./types"
import type { RunFooterTheme, RunTheme } from "./theme"

registerOpencodeSpinner()

export const SUBAGENT_INSPECTOR_ROWS = 14

function statusColor(theme: RunFooterTheme, status: FooterSubagentTab["status"]) {
  if (status === "completed") {
    return theme.highlight
  }

  if (status === "cancelled") {
    return theme.muted
  }

  if (status === "error") {
    return theme.error
  }

  return theme.highlight
}

function statusIcon(status: FooterSubagentTab["status"]) {
  if (status === "completed") {
    return "●"
  }

  if (status === "cancelled") {
    return "○"
  }

  if (status === "error") {
    return "◍"
  }

  return "◔"
}

export function RunFooterSubagentBody(props: {
  active: () => boolean
  theme: () => RunTheme
  tab: () => FooterSubagentTab | undefined
  index: () => number
  total: () => number
  detail: () => FooterSubagentDetail | undefined
  width: () => number
  diffStyle?: RunDiffStyle
  onCycle: (dir: -1 | 1) => void
  onClose: () => void
  onKill?: (sessionID: string) => void
  onSteer?: (sessionID: string, message: string) => void
  onRefresh?: (sessionID: string) => void
}) {
  const theme = createMemo(() => props.theme())
  const footer = createMemo(() => theme().footer)
  const tab = createMemo(() => props.tab())
  const commits = createMemo(() => props.detail()?.commits ?? [])
  const opts = createMemo(() => ({ diffStyle: props.diffStyle }))
  const scrollbar = createMemo(() => ({
    trackOptions: {
      backgroundColor: footer().surface,
      foregroundColor: footer().line,
    },
  }))
  const title = createMemo(() => {
    const current = tab()
    if (!current) {
      return ""
    }

    return current.description || current.title || current.label
  })
  const subtitle = createMemo(() => {
    const current = tab()
    if (!current || title() === current.label) {
      return ""
    }

    return current.label
  })
  const rows = indexArray(commits, (commit, index) => (
    <box flexDirection="column" gap={0} flexShrink={0}>
      {index > 0 && separatorRows(commits()[index - 1], commit()) > 0 ? <box height={1} flexShrink={0} /> : null}
      <RunEntryContent commit={commit()} theme={theme()} opts={opts()} width={props.width()} />
    </box>
  ))
  let scroll: ScrollBoxRenderable | undefined

  // Steer mode state
  const [steerMode, setSteerMode] = createSignal(false)
  const [steerMessage, setSteerMessage] = createSignal("")

  useKeyboard((event) => {
    if (!props.active()) {
      return
    }

    const currentTab = tab()

    // Steer mode active - handle text input
    if (steerMode()) {
      if (event.name === "return") {
        event.preventDefault()
        const msg = steerMessage().trim()
        if (msg && currentTab && props.onSteer) {
          props.onSteer(currentTab.sessionID, msg)
          setSteerMessage("")
          setSteerMode(false)
        }
        return
      }

      if (event.name === "escape") {
        event.preventDefault()
        setSteerMessage("")
        setSteerMode(false)
        return
      }

      // Allow typing in steer mode
      if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        event.preventDefault()
        setSteerMessage((prev) => prev + event.name)
        return
      }

      if (event.name === "backspace") {
        event.preventDefault()
        setSteerMessage((prev) => prev.slice(0, -1))
        return
      }

      return
    }

    // Normal mode - handle controls
    if (event.name === "escape") {
      event.preventDefault()
      props.onClose()
      return
    }

    if (event.name === "tab" && !event.shift) {
      event.preventDefault()
      props.onCycle(1)
      return
    }

    // Kill subagent
    if ((event.name === "x" || (event.name === "c" && event.ctrl)) && currentTab && props.onKill) {
      event.preventDefault()
      props.onKill(currentTab.sessionID)
      return
    }

    // Steer subagent (only if running)
    if (event.name === "s" && currentTab && currentTab.status === "running" && props.onSteer) {
      event.preventDefault()
      setSteerMode(true)
      return
    }

    // Refresh status
    if (event.name === "r" && currentTab && props.onRefresh) {
      event.preventDefault()
      props.onRefresh(currentTab.sessionID)
      return
    }

    if (event.name === "up" || event.name === "k") {
      event.preventDefault()
      scroll?.scrollBy(-1)
      return
    }

    if (event.name === "down" || event.name === "j") {
      event.preventDefault()
      scroll?.scrollBy(1)
    }
  })

  // Help text with available actions
  const helpText = createMemo(() => {
    if (steerMode()) {
      return "Enter: send │ Esc: cancel"
    }

    const current = tab()
    const actions: string[] = []

    if (current) {
      if (current.status === "running") {
        actions.push("x: kill", "s: steer", "r: refresh")
      } else {
        actions.push("r: refresh")
      }
    }

    if (props.total() > 1) {
      actions.push("Tab: cycle")
    }

    actions.push("Esc: close")

    return actions.join(" │ ")
  })

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={footer().surface}>
      <box paddingTop={1} paddingLeft={1} paddingRight={3} paddingBottom={1} flexDirection="column" flexGrow={1}>
        <Show when={tab()}>
          {(current) => (
            <box width="100%" flexDirection="row" gap={1} paddingBottom={1} flexShrink={0}>
              {current().status === "running" ? (
                <box flexShrink={0}>
                  <spinner frames={SPINNER_FRAMES} interval={80} color={statusColor(footer(), current().status)} />
                </box>
              ) : (
                <text fg={statusColor(footer(), current().status)} wrapMode="none" truncate flexShrink={0}>
                  {statusIcon(current().status)}
                </text>
              )}
              <text fg={footer().text} wrapMode="none" truncate flexGrow={1} flexShrink={1}>
                {title()}
                <Show when={subtitle().length > 0}>
                  <span style={{ fg: footer().muted }}>{"  " + subtitle()}</span>
                </Show>
              </text>
              <Show when={props.total() > 1 && props.index() > 0}>
                <text fg={footer().muted} wrapMode="none" truncate flexShrink={0}>
                  {props.index()} of {props.total()}
                </text>
              </Show>
            </box>
          )}
        </Show>
        <scrollbox
          width="100%"
          height="100%"
          stickyScroll={true}
          stickyStart="bottom"
          verticalScrollbarOptions={scrollbar()}
          ref={(item) => {
            scroll = item
          }}
        >
          <box width="100%" flexDirection="column" gap={0}>
            {commits().length > 0 ? (
              rows()
            ) : (
              <text fg={footer().muted} wrapMode="word">
                No subagent activity yet
              </text>
            )}
          </box>
        </scrollbox>
        <Show when={steerMode()}>
          <box width="100%" paddingTop={1} flexShrink={0}>
            <text fg={footer().text}>
              <span style={{ fg: footer().muted }}>Steer message: </span>
              {steerMessage()}
              <span style={{ fg: footer().highlight }}>▊</span>
            </text>
          </box>
        </Show>
        <box width="100%" paddingTop={1} flexShrink={0}>
          <text fg={footer().muted} wrapMode="none" truncate>
            {helpText()}
          </text>
        </box>
      </box>
    </box>
  )
}
