import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const STORAGE_KEY = "quorumind.theme";

function read(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Fall back to the system theme.
  }
  return "system";
}

function apply(theme: ThemeChoice) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

/** The theme the person chose, from the first screen on: the pages outside the app's shell follow it too. */
export function applyStoredTheme() {
  apply(read());
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeChoice>(read);
  useEffect(() => {
    apply(theme);
    try {
      if (theme === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Not critical.
    }
  }, [theme]);
  return [theme, setTheme] as const;
}
