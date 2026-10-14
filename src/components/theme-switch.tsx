"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY } from "./theme-script";

type Choice = "system" | "light" | "dark";

const read = (): Choice => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
};
const subscribe = (cb: () => void) => {
  window.addEventListener("kvs-theme", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("kvs-theme", cb);
    window.removeEventListener("storage", cb);
  };
};

function pick(c: Choice) {
  try {
    if (c === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, c);
  } catch {
    // Storage blocked: the theme still changes for this page view.
    document.documentElement.dataset.theme = c === "dark" || (c === "system" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }
  window.dispatchEvent(new Event("kvs-theme"));
}

const OPTIONS: { value: Choice; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light theme", icon: <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /> },
  { value: "dark", label: "Dark theme", icon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /> },
  { value: "system", label: "Match my device", icon: <path d="M4 5h16v11H4zM8 20h8m-4-4v4" /> },
];

/** Light / dark / device theme picker; the choice stays in this browser (see theme-script.ts). */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  const choice = useSyncExternalStore(subscribe, read, () => "system" as Choice);
  return (
    <div role="group" aria-label="Colour theme" className={`inline-flex rounded-full border border-slate-300 p-0.5 ${className}`}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => pick(o.value)}
          aria-pressed={choice === o.value}
          title={o.label}
          className={`grid h-7 w-7 place-items-center rounded-full ${choice === o.value ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"}`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {o.icon}
          </svg>
          <span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
