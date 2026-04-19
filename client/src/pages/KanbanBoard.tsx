import { useEffect, useState, useCallback, useMemo } from "react";
import { RefreshCw, Columns3, ChevronDown, Ellipsis } from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { AgentCard } from "../components/AgentCard";
import { EmptyState } from "../components/EmptyState";
import { STATUS_CONFIG } from "../lib/types";
import type { Agent, AgentStatus } from "../lib/types";

const COLUMNS: AgentStatus[] = ["awaiting_approval", "working", "idle", "connected", "error", "completed"];
const COLUMN_PAGE_SIZE = 5;

interface AgentGroup {
  root: Agent;
  children: Agent[];
}

export function KanbanBoard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedCols, setExpandedCols] = useState<Record<string, number>>({});
  const [showAllChildren, setShowAllChildren] = useState<Record<string, boolean>>({});
  const [pinnedEmptyCols, setPinnedEmptyCols] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await api.agents.list({ limit: 10000 });
      setAgents(res.agents);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return eventBus.subscribe((msg) => {
      if (msg.type === "agent_created" || msg.type === "agent_updated") {
        load();
      }
    });
  }, [load]);

  // Build parent-child groups
  const groups = useMemo(() => {
    const agentMap = new Map<string, Agent>();
    const childrenMap = new Map<string, Agent[]>();

    for (const a of agents) {
      agentMap.set(a.id, a);
      if (a.parent_agent_id) {
        const list = childrenMap.get(a.parent_agent_id) ?? [];
        list.push(a);
        childrenMap.set(a.parent_agent_id, list);
      }
    }

    const groupsArr: AgentGroup[] = [];
    const assigned = new Set<string>();

    // Process main agents first
    for (const a of agents) {
      if (a.type === "main" || !a.parent_agent_id) {
        assigned.add(a.id);
        const children = childrenMap.get(a.id) ?? [];
        // Mark children as assigned so they don't appear as standalone cards
        for (const c of children) assigned.add(c.id);
        groupsArr.push({
          root: a,
          children,
        });
      }
    }

    // Orphan subagents (parent not in dataset)
    for (const a of agents) {
      if (!assigned.has(a.id)) {
        groupsArr.push({ root: a, children: [] });
      }
    }

    return groupsArr;
  }, [agents]);

  // Map groups to columns based on root agent status
  const grouped = useMemo(() => {
    const result = COLUMNS.reduce(
      (acc, status) => {
        acc[status] = groups.filter((g) => g.root.status === status);
        return acc;
      },
      {} as Record<AgentStatus, AgentGroup[]>,
    );
    return result;
  }, [groups]);

  // Auto-expand groups with active children
  useEffect(() => {
    const autoExpand: Record<string, boolean> = {};
    for (const g of groups) {
      if (g.children.length > 0) {
        const hasActive = g.children.some(
          (c) => c.status === "working" || c.status === "connected" || c.status === "awaiting_approval",
        );
        if (hasActive) autoExpand[g.root.id] = true;
      }
    }
    setExpandedGroups((prev) => ({ ...autoExpand, ...prev }));
  }, [groups]);

  const toggleGroup = (rootId: string) => {
    setExpandedGroups((prev) => ({ ...prev, [rootId]: !prev[rootId] }));
  };

  if (!loading && agents.length === 0) {
    return (
      <div className="animate-fade-in">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
            <Columns3 className="w-4.5 h-4.5 text-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-100">Agent Board</h1>
            <p className="text-xs text-gray-500">Kanban view of all agents by status</p>
          </div>
        </div>
        <EmptyState
          icon={Columns3}
          title="No agents tracked yet"
          description="Start a Claude Code session with hooks installed to see agents appear here."
          action={
            <button onClick={load} className="btn-primary">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
            <Columns3 className="w-4.5 h-4.5 text-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-100">Agent Board</h1>
            <p className="text-xs text-gray-500">
              {agents.length} agent{agents.length !== 1 ? "s" : ""} tracked
            </p>
          </div>
        </div>
        <button onClick={load} className="btn-ghost flex-shrink-0">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="flex gap-4 min-h-[600px] overflow-x-auto pb-4 -mx-8 px-8">
        {COLUMNS.map((status) => {
          const config = STATUS_CONFIG[status];
          const items = grouped[status];
          const visibleCount = expandedCols[status] || COLUMN_PAGE_SIZE;
          const visibleGroups = items?.slice(0, visibleCount) ?? [];
          const hasMore = (items?.length ?? 0) > visibleCount;
          const count = items?.length ?? 0;
          const isCollapsed = count === 0 && !pinnedEmptyCols[status];

          if (isCollapsed) {
            return (
              <button
                key={status}
                type="button"
                onClick={() => setPinnedEmptyCols((p) => ({ ...p, [status]: true }))}
                title={`${config.label} — 0 agents (click to expand)`}
                className="group bg-surface-1/60 hover:bg-surface-1 rounded-xl border border-border/70 hover:border-border p-2 flex flex-col items-center flex-shrink-0 w-12 transition-all duration-300 ease-out overflow-hidden cursor-pointer"
              >
                <span className={`w-2 h-2 rounded-full ${config.dot} mt-1 mb-3 flex-shrink-0`} />
                <span
                  className={`text-[11px] font-semibold uppercase tracking-wider ${config.color} whitespace-nowrap`}
                  style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                >
                  {config.label}
                </span>
                <span className="mt-auto pt-3 text-[10px] text-gray-600 bg-surface-3 px-1.5 py-0.5 rounded-full">
                  0
                </span>
              </button>
            );
          }

          return (
            <div
              key={status}
              className="bg-surface-1 rounded-xl border border-border p-3 flex flex-col flex-shrink-0 w-72 transition-all duration-300 ease-out animate-fade-in"
            >
              <div className="flex items-center gap-2 mb-4 px-1">
                <span
                  className={`w-2 h-2 rounded-full ${config.dot} ${
                    status === "working" || status === "awaiting_approval" ? "animate-pulse-dot" : ""
                  }`}
                />
                <span className={`text-xs font-semibold uppercase tracking-wider ${config.color}`}>
                  {config.label}
                </span>
                <span className="ml-auto text-[11px] text-gray-600 bg-surface-3 px-2 py-0.5 rounded-full">
                  {count}
                </span>
                {count === 0 && pinnedEmptyCols[status] && (
                  <button
                    type="button"
                    onClick={() =>
                      setPinnedEmptyCols((p) => {
                        const next = { ...p };
                        delete next[status];
                        return next;
                      })
                    }
                    title="Collapse column"
                    className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors"
                  >
                    −
                  </button>
                )}
              </div>

              <div className="flex-1 space-y-2.5 overflow-y-auto">
                {visibleGroups.length > 0 ? (
                  <>
                    {visibleGroups.map((group) => {
                      const { root, children } = group;
                      const hasChildren = children.length > 0;
                      const isExpanded = hasChildren && expandedGroups[root.id] === true;
                      const activeChildren = children.filter(
                        (c) => c.status === "working" || c.status === "connected",
                      ).length;

                      return (
                        <div key={root.id}>
                          {/* Group header - expand/collapse is inside AgentCard name area */}
                          <AgentCard
                            agent={root}
                            hideStatus
                            groupExpanded={isExpanded}
                            onGroupToggle={hasChildren ? () => toggleGroup(root.id) : undefined}
                          />

                          {/* Collapsed hint */}
                          {hasChildren && !isExpanded && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleGroup(root.id);
                              }}
                              className="ml-3 mt-1 flex items-center gap-1.5 hover:opacity-80 transition-opacity cursor-pointer"
                              title="Expand subagents"
                            >
                              <span className="text-[11px] text-violet-400/80">
                                {children.length} subagent{children.length !== 1 ? "s" : ""}
                              </span>
                              {activeChildren > 0 && (
                                <span className="text-[10px] text-emerald-400/70">
                                  ({activeChildren} active)
                                </span>
                              )}
                            </button>
                          )}

                          {/* Expanded children list */}
                          {hasChildren && isExpanded && (() => {
                            const sorted = [...children].sort(
                              (a, b) => new Date(b.updated_at || b.started_at).getTime() - new Date(a.updated_at || a.started_at).getTime(),
                            );
                            const isShowAll = showAllChildren[root.id] === true;
                            const visible = isShowAll ? sorted : sorted.slice(0, 3);
                            const remaining = sorted.length - visible.length;

                            return (
                              <div className="ml-3 mt-1 pl-2.5 border-l-2 border-violet-500/20 space-y-1.5 animate-fade-in">
                                {visible.map((child) => (
                                  <div key={child.id} className="relative">
                                    <AgentCard agent={child} compact showSubStatus />
                                  </div>
                                ))}
                                {remaining > 0 && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setShowAllChildren((p) => ({ ...p, [root.id]: true })); }}
                                    className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-violet-400 transition-colors w-full py-1"
                                  >
                                    <Ellipsis className="w-3 h-3" />
                                    <span>{remaining} more</span>
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                    {hasMore && (
                      <button
                        onClick={() =>
                          setExpandedCols((prev) => ({
                            ...prev,
                            [status]: (prev[status] || COLUMN_PAGE_SIZE) + COLUMN_PAGE_SIZE,
                          }))
                        }
                        className="w-full py-2 text-[11px] text-gray-500 hover:text-gray-300 flex items-center justify-center gap-1 transition-colors"
                      >
                        <ChevronDown className="w-3 h-3" />
                        Show more ({(items?.length ?? 0) - visibleCount} remaining)
                      </button>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-center h-24 text-xs text-gray-600">
                    No agents
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
