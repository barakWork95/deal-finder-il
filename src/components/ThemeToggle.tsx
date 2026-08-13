"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Sun, Moon } from "lucide-react";

type Theme = "dark" | "light";

const KEY = "theme";
const EVENT = "karkahot:theme";

/**
 * The stored theme is external state, so it is read through
 * useSyncExternalStore rather than hydrated inside an effect: the server has no
 * localStorage, and this is the API that lets React treat the first client
 * value as legitimately different from the server one. The snapshot is a plain
 * string, so it stays referentially stable without any caching.
 */
function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener); // other tabs
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

function read(): Theme {
  try {
    return window.localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => "dark" as Theme);

  // Publishing the theme to <html> is a side effect on an external system,
  // which is exactly what an effect is for. Other components (the map) watch
  // this attribute.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggle = useCallback(() => {
    const next: Theme = read() === "dark" ? "light" : "dark";
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Preference just won't persist; the attribute below still flips.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return (
    <button
      onClick={toggle}
      aria-label="החלף מצב תצוגה"
      title={theme === "dark" ? "מעבר למצב בהיר" : "מעבר למצב כהה"}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted transition hover:text-primary hover:border-border-strong"
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
