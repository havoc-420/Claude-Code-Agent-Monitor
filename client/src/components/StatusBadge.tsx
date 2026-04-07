import { STATUS_CONFIG, SESSION_STATUS_CONFIG } from "../lib/types";
import type { AgentStatus, SessionStatus } from "../lib/types";

interface AgentStatusBadgeProps {
  status: AgentStatus;
  pulse?: boolean;
  short?: boolean;
}

export function AgentStatusBadge({ status, pulse, short }: AgentStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const shouldPulse = pulse ?? (status === "working" || status === "connected" || status === "awaiting_approval");
  const label = short ? config.label.slice(0, 3) : config.label;

  return (
    <span className={`badge ${config.bg} ${config.color}`}>
      <span
        className={`w-1.5 h-1.5 rounded-full ${config.dot} ${
          shouldPulse ? "animate-pulse-dot" : ""
        }`}
      />
      {label}
    </span>
  );
}

interface SessionStatusBadgeProps {
  status: SessionStatus;
}

export function SessionStatusBadge({ status }: SessionStatusBadgeProps) {
  const config = SESSION_STATUS_CONFIG[status];
  return <span className={`badge ${config.bg} ${config.color}`}>{config.label}</span>;
}
