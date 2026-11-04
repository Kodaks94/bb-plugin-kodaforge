// One settings object for the whole browser: every open workspace re-renders when it
// changes, including from another BB tab (the storage event).
import { useCallback, useSyncExternalStore } from "react";
import { parseSettings, SETTINGS_KEY, type Settings } from "@/lib/settings";

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: Settings;

function read(): Settings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parseSettings(raw);
  }
  return cached;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => event.key === SETTINGS_KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, read);
  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...read(), [key]: value }));
    listeners.forEach((listener) => listener());
  }, []);
  const reset = useCallback(() => {
    localStorage.removeItem(SETTINGS_KEY);
    listeners.forEach((listener) => listener());
  }, []);
  return { settings, update, reset };
}
