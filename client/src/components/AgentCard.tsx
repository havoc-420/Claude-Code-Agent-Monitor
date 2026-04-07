import { useState } from "react";
import { Bot, GitBranch, Clock, Wrench, Tag, Sparkles, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AgentStatusBadge } from "./StatusBadge";
import type { Agent } from "../lib/types";
import { formatDuration, timeAgo } from "../lib/format";

const platformDotMap: Record<string, string> = {
  claude: "bg-blue-400",
  codebuddy: "bg-cyan-400",
};

interface AgentCardProps {
  agent: Agent;
  onClick?: () => void;
  hideStatus?: boolean;
  compact?: boolean;
  showSubStatus?: boolean;
  groupExpanded?: boolean;
  onGroupToggle?: () => void;
}

export function AgentCard({ agent, onClick, hideStatus = false, compact = false, showSubStatus = false, groupExpanded, onGroupToggle }: AgentCardProps) {
  const navigate = useNavigate();
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const isWorking = agent.status === "working" || agent.status === "connected" || agent.status === "awaiting_approval";
  const isWaiting = agent.status === "idle" && agent.type === "main";

  if (compact) {
    return (
      <div
        onClick={onClick ?? (() => navigate(`/sessions/${agent.session_id}`))}
        className="card-hover p-2.5 cursor-pointer animate-fade-in overflow-hidden"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 bg-violet-500/15 text-violet-400">
            <GitBranch className="w-2.5 h-2.5" />
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="text-xs font-medium text-gray-300 truncate">
              {agent.name}{agent.subagent_type ? ` · ${agent.subagent_type}` : ""}
            </p>
          </div>
          {showSubStatus && <AgentStatusBadge status={agent.status} short />}
          <span className="text-[10px] text-gray-600 flex-shrink-0 tabular-nums">
            {agent.ended_at
              ? formatDuration(agent.started_at, agent.ended_at)
              : timeAgo(agent.updated_at || agent.started_at)}
          </span>
        </div>
      </div>
    );
  }

  // Build ordered tag list: platform first, then token_name
  const tags: { key: string; node: React.ReactNode }[] = [];
  if (agent.platform) {
    tags.push({
      key: "platform",
      node: (
        <span
          className={`inline-flex items-center gap-0.5 text-[10px] border px-1.5 py-0.5 rounded-full flex-shrink-0 ${
            agent.platform === "claude"
              ? "text-blue-400 bg-blue-500/10 border-blue-500/20"
              : "text-cyan-400 bg-cyan-500/10 border-cyan-500/20"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${platformDotMap[agent.platform] ?? "bg-gray-400"}`} />
          {agent.platform === "claude" ? "Claude" : "CodeBuddy"}
        </span>
      ),
    });
  }
  if (agent.token_name) {
    tags.push({
      key: "token",
      node: (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded-full flex-shrink-0">
          <Tag className="w-2.5 h-2.5" />
          {agent.token_name}
        </span>
      ),
    });
  }

  // How many tags to show before collapsing
  const VISIBLE_COUNT = 2;
  const hiddenCount = tags.length - VISIBLE_COUNT;
  const visibleTags = tagsExpanded ? tags : tags.slice(0, VISIBLE_COUNT);

  function handleClick() {
    if (onClick) {
      onClick();
    } else {
      navigate(`/sessions/${agent.session_id}`);
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`card-hover p-4 cursor-pointer animate-fade-in overflow-hidden ${
        isWorking ? "border-l-2 border-l-emerald-500/50" : isWaiting ? "border-l-2 border-l-amber-500/50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
          <div
            className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
              agent.type === "main"
                ? "bg-accent/15 text-accent"
                : "bg-violet-500/15 text-violet-400"
            }`}
          >
            {agent.type === "main" ? (
              <Bot className="w-3.5 h-3.5" />
            ) : (
              <GitBranch className="w-3.5 h-3.5" />
            )}
          </div>
          <div className="min-w-0 overflow-hidden">
            <div className="flex items-center gap-1 min-w-0">
              <p className="text-sm font-medium text-gray-200 truncate flex-1">
                {agent.session_cwd ? agent.session_cwd.split("/").pop() : agent.name}
              </p>
              {onGroupToggle && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onGroupToggle();
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onGroupToggle();
                  }}
                  className={`flex-shrink-0 p-0.5 rounded hover:bg-surface-3 transition-colors ${
                    groupExpanded ? "rotate-90" : ""
                  }`}
                  title={groupExpanded ? "Collapse" : "Expand"}
                >
                  <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-500 truncate mt-0.5">
              {agent.name}{agent.subagent_type ? ` · ${agent.subagent_type}` : ""}
            </p>
          </div>
        </div>
        {!hideStatus && <AgentStatusBadge status={agent.status} />}
      </div>

      {tags.length > 0 && (
        <div className="flex items-center gap-1.5 mb-3 overflow-hidden">
          {visibleTags.map((t) => (
            <span key={t.key}>{t.node}</span>
          ))}
          {!tagsExpanded && hiddenCount > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setTagsExpanded(true); }}
              className="inline-flex items-center text-[10px] text-gray-500 hover:text-gray-300 bg-surface-3 border border-border px-1.5 py-0.5 rounded-full flex-shrink-0 transition-colors"
            >
              +{hiddenCount}
            </button>
          )}
        </div>
      )}

      {agent.task && (
        <p className="text-xs text-gray-400 mb-2 truncate">{agent.task}</p>
      )}

      {agent.last_event_summary && (
        <div className="flex items-start gap-1.5 mb-3 text-[11px] text-gray-500 bg-surface-2 rounded-md px-2.5 py-1.5">
          <Sparkles className="w-3 h-3 flex-shrink-0 mt-0.5 text-violet-400/70" />
          <span className="truncate">{agent.last_event_summary}</span>
        </div>
      )}

      <div className="flex items-center gap-4 text-[11px] text-gray-500 min-w-0 overflow-hidden">
        {agent.current_tool && (
          <span className="flex items-center gap-1">
            <Wrench className="w-3 h-3" />
            {agent.current_tool}
          </span>
        )}
        {agent.ended_at ? (
          <>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              ran {formatDuration(agent.started_at, agent.ended_at)}
            </span>
            <span className="text-gray-600">{timeAgo(agent.ended_at)}</span>
          </>
        ) : (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {timeAgo(agent.updated_at || agent.started_at)}
          </span>
        )}
        <span className="ml-auto font-mono opacity-50">{agent.session_id.slice(0, 8)}</span>
      </div>
    </div>
  );
}
