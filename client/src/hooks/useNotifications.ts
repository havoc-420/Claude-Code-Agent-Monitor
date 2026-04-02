import { useEffect, useRef } from "react";
import { eventBus } from "../lib/eventBus";
import type { WSMessage, Session, Agent, DashboardEvent } from "../lib/types";

const NOTIF_KEY = "agent-monitor-notifications";

interface NotifPrefs {
  enabled: boolean;
  onNewSession: boolean;
  onSessionError: boolean;
  onSessionComplete: boolean;
  onSubagentSpawn: boolean;
  onWaitingForInput: boolean;
  onPermissionRequest: boolean;
  onNotification: boolean;
}

function loadPrefs(): NotifPrefs {
  try {
    const raw = localStorage.getItem(NOTIF_KEY);
    if (!raw)
      return {
        enabled: false,
        onNewSession: true,
        onSessionError: true,
        onSessionComplete: false,
        onSubagentSpawn: false,
        onWaitingForInput: true,
        onPermissionRequest: true,
        onNotification: true,
      };
    return {
      enabled: false,
      onNewSession: true,
      onSessionError: true,
      onSessionComplete: false,
      onSubagentSpawn: false,
      onWaitingForInput: true,
      onPermissionRequest: true,
      onNotification: true,
      ...JSON.parse(raw),
    };
  } catch {
    return {
      enabled: false,
      onNewSession: true,
      onSessionError: true,
      onSessionComplete: false,
      onSubagentSpawn: false,
      onWaitingForInput: true,
      onPermissionRequest: true,
      onNotification: true,
    };
  }
}

function notify(title: string, body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch {
    // Safari/mobile may not support Notification constructor
  }
}

/**
 * Subscribe to the event bus and fire browser notifications based on user preferences.
 * Call once at the app root level.
 */
export function useNotifications() {
  // Track previous agent statuses to detect transitions to idle
  const prevAgentStatus = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    return eventBus.subscribe((msg: WSMessage) => {
      const prefs = loadPrefs();
      if (!prefs.enabled) return;

      switch (msg.type) {
        case "session_created": {
          if (!prefs.onNewSession) return;
          const s = msg.data as Session;
          notify("New Session", s.name || `Session ${s.id.slice(0, 8)}`);
          break;
        }
        case "session_updated": {
          const s = msg.data as Session;
          if (s.status === "error" && prefs.onSessionError) {
            notify("Session Error", s.name || `Session ${s.id.slice(0, 8)}`);
          }
          break;
        }
        case "agent_created": {
          if (!prefs.onSubagentSpawn) return;
          const a = msg.data as Agent;
          if (a.type === "subagent") {
            notify("Subagent Spawned", a.name);
          }
          break;
        }
        case "agent_updated": {
          const a = msg.data as Agent;

          // Detect main agent transitioning to awaiting_approval (PermissionRequest)
          if (prefs.onPermissionRequest && a.type === "main" && a.status === "awaiting_approval") {
            const prev = prevAgentStatus.current.get(a.id);
            if (prev && prev !== "awaiting_approval") {
              const toolName = a.current_tool || "a tool";
              notify("Approval Required", `${a.name.replace(/^Main Agent — /, "")} is waiting for permission to use ${toolName}`);
            }
          }

          // Detect main agent transitioning to idle (Stop event = waiting for user input)
          if (!prefs.onWaitingForInput) {
            prevAgentStatus.current.set(a.id, a.status);
            break;
          }
          if (a.type === "main" && a.status === "idle") {
            const prev = prevAgentStatus.current.get(a.id);
            // Only notify on actual transition (not on initial load / re-subscription)
            if (prev && prev !== "idle") {
              notify("Waiting for Input", a.name.replace(/^Main Agent — /, "") + " is ready for input");
            }
          }
          prevAgentStatus.current.set(a.id, a.status);
          break;
        }
        case "new_event": {
          const ev = msg.data as DashboardEvent;
          if (ev.event_type === "Stop" && prefs.onSessionComplete) {
            notify("Claude Finished Responding", ev.summary || "Ready for input");
          } else if (ev.event_type === "SessionEnd" && prefs.onSessionComplete) {
            notify("Session Completed", ev.summary || "Session closed");
          } else if (ev.event_type === "Notification" && prefs.onNotification) {
            notify("Claude Code", ev.summary || "Notification");
          }
          break;
        }
      }
    });
  }, []);
}

export type { NotifPrefs };
