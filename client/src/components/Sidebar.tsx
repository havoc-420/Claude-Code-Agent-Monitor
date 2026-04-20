import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Columns3,
  FolderOpen,
  Activity,
  BarChart3,
  Workflow,
  Settings,
  Wifi,
  WifiOff,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  ChevronRight,
  Palette,
  Plug,
  Key,
  Bell,
  Database,
  DollarSign,
  Server,
  Share2,
  GitBranch,
  Gauge,
  Layers,
  AlertCircle,
  Clock,
  Boxes,
  Minimize2,
  Search,
  Network,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import { ThemeToggle } from "./ThemeToggle";

interface NavChild {
  /** Hash portion only, without the leading `#`. */
  hash: string;
  icon: LucideIcon;
  label: string;
}

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  children?: NavChild[];
}

/**
 * Primary sidebar navigation. Items may declare `children`, which render as
 * an indented sub-list that jumps to `#<hash>` anchors on the target page.
 * Keep child hashes in sync with the matching `<section id="...">` in the
 * target page (see e.g. `pages/Settings.tsx`).
 */
const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/kanban", icon: Columns3, label: "Agent Board" },
  { to: "/sessions", icon: FolderOpen, label: "Sessions" },
  { to: "/activity", icon: Activity, label: "Activity Feed" },
  { to: "/analytics", icon: BarChart3, label: "Analytics" },
  {
    to: "/workflows",
    icon: Workflow,
    label: "Workflows",
    children: [
      { hash: "orchestration", icon: Share2, label: "Orchestration" },
      { hash: "tool-flow", icon: Wrench, label: "Tool Flow" },
      { hash: "pipeline", icon: GitBranch, label: "Pipeline" },
      { hash: "effectiveness", icon: Gauge, label: "Effectiveness" },
      { hash: "patterns", icon: Layers, label: "Patterns" },
      { hash: "delegation", icon: Network, label: "Delegation" },
      { hash: "errors", icon: AlertCircle, label: "Errors" },
      { hash: "concurrency", icon: Clock, label: "Concurrency" },
      { hash: "complexity", icon: Boxes, label: "Complexity" },
      { hash: "compaction", icon: Minimize2, label: "Compaction" },
      { hash: "drill-in", icon: Search, label: "Drill-In" },
    ],
  },
  {
    to: "/settings",
    icon: Settings,
    label: "Settings",
    children: [
      { hash: "appearance", icon: Palette, label: "Appearance" },
      { hash: "hooks", icon: Plug, label: "Hooks" },
      { hash: "api-tokens", icon: Key, label: "API Tokens" },
      { hash: "notifications", icon: Bell, label: "Notifications" },
      { hash: "data", icon: Database, label: "Data" },
      { hash: "pricing", icon: DollarSign, label: "Model Pricing" },
      { hash: "about", icon: Server, label: "About" },
    ],
  },
] as const;

const STORAGE_KEY = "sidebar-collapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

interface SidebarProps {
  wsConnected: boolean;
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ wsConnected, collapsed, onToggle }: SidebarProps) {
  const navigate = useNavigate();
  const { authEnabled } = useAuth();
  const { pathname, hash } = useLocation();

  const activeHash = useMemo(() => hash.replace(/^#/, ""), [hash]);

  const handleLogout = async () => {
    try {
      await api.auth.logout();
    } catch {
      // Ignore errors
    }
    navigate("/login", { replace: true });
  };

  return (
    <aside
      className={`fixed left-0 top-0 bottom-0 bg-surface-1 border-r border-border flex flex-col z-30 overflow-y-auto overflow-x-hidden transition-[width] duration-200 ${
        collapsed ? "w-[4.25rem]" : "w-60"
      }`}
    >
      {/* Brand */}
      <div className="px-3 py-4 border-b border-border">
        <div className={`flex items-center ${collapsed ? "justify-center" : "gap-3 px-2"}`}>
          <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0">
            <Activity className="w-4 h-4 text-accent" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-gray-100 truncate">Agent Dashboard</h1>
              <p className="text-[11px] text-gray-500">Claude Code Monitor</p>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const { to, icon: Icon, label, children } = item;
          const isOwnerActive =
            pathname === to || (to !== "/" && pathname.startsWith(to + "/"));
          // Accordion behavior: the sub-nav is open iff the user is currently
          // on the owning route. Navigating away auto-collapses it.
          const isOpen = !collapsed && !!children && isOwnerActive;

          return (
            <div key={to}>
              <NavLink
                to={to}
                end={to === "/"}
                title={collapsed ? label : undefined}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-150 ${
                    collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"
                  } ${
                    isActive
                      ? "bg-accent/10 text-accent border border-accent/20"
                      : "text-gray-400 hover:text-gray-200 hover:bg-surface-3 border border-transparent"
                  }`
                }
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{label}</span>
                    {children && (
                      <ChevronRight
                        className={`w-3.5 h-3.5 flex-shrink-0 opacity-60 transition-transform duration-200 ${
                          isOpen ? "rotate-90" : ""
                        }`}
                      />
                    )}
                  </>
                )}
              </NavLink>

              {/* Sub-nav (only when expanded & sidebar is open) */}
              {isOpen && children && (
                <ul className="mt-1 mb-1 ml-5 pl-3 border-l border-border space-y-0.5">
                  {children.map((child) => {
                    const active = isOwnerActive && activeHash === child.hash;
                    const ChildIcon = child.icon;
                    return (
                      <li key={child.hash}>
                        <NavLink
                          to={`${to}#${child.hash}`}
                          onClick={() => {
                            // Re-scroll if the user clicks the already-active
                            // sub-item (hash unchanged → effect wouldn't fire).
                            if (isOwnerActive && activeHash === child.hash) {
                              const el = document.getElementById(child.hash);
                              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                            }
                          }}
                          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                            active
                              ? "text-accent bg-accent/10"
                              : "text-gray-500 hover:text-gray-300 hover:bg-surface-3"
                          }`}
                        >
                          <ChildIcon className="w-3 h-3 flex-shrink-0 opacity-80" />
                          <span className="truncate">{child.label}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 py-2">
        {authEnabled && (
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors mb-1"
            title="Sign out"
          >
            {collapsed ? (
              <LogOut className="w-4 h-4 flex-shrink-0 mx-auto" />
            ) : (
              <>
                <LogOut className="w-4 h-4 flex-shrink-0" />
                <span>Sign out</span>
              </>
            )}
          </button>
        )}
        <ThemeToggle collapsed={collapsed} />
        <button
          onClick={onToggle}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-gray-300 hover:bg-surface-3 transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="w-4 h-4 flex-shrink-0 mx-auto" />
          ) : (
            <>
              <PanelLeftClose className="w-4 h-4 flex-shrink-0" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>

      {/* Footer */}
      <div
        className={`px-3 py-3 border-t border-border ${collapsed ? "items-center" : ""}`}
      >
        <div className={`flex items-center text-xs ${collapsed ? "justify-center" : "gap-2"}`}>
          {wsConnected ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              {!collapsed && <span className="text-emerald-400">Live</span>}
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
              {!collapsed && <span className="text-gray-500">Disconnected</span>}
            </>
          )}
          {!collapsed && <span className="ml-auto text-gray-600">v1.0.0</span>}
        </div>
      </div>
    </aside>
  );
}

export { STORAGE_KEY as SIDEBAR_STORAGE_KEY, loadCollapsed };
