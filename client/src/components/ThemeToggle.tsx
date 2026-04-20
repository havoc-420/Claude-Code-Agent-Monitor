import { Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

interface ThemeToggleProps {
  collapsed?: boolean;
}

export function ThemeToggle({ collapsed = false }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Light mode" : "Dark mode";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-gray-300 hover:bg-surface-3 transition-colors"
    >
      {collapsed ? (
        isDark ? (
          <Sun className="w-4 h-4 flex-shrink-0 mx-auto" />
        ) : (
          <Moon className="w-4 h-4 flex-shrink-0 mx-auto" />
        )
      ) : (
        <>
          {isDark ? (
            <Sun className="w-4 h-4 flex-shrink-0" />
          ) : (
            <Moon className="w-4 h-4 flex-shrink-0" />
          )}
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
