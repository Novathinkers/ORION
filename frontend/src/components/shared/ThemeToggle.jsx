import { useTheme } from "../../contexts/ThemeContext";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      type="button"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded-lg bg-base-raised border border-base-border text-ink hover:border-signal/40 transition-colors shadow-sm cursor-pointer"
      title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
    >
      {theme === "dark" ? (
        <>
          <span className="text-amber-400">☀</span>
          <span>Light Mode</span>
        </>
      ) : (
        <>
          <span className="text-indigo-400">🌙</span>
          <span>Dark Mode</span>
        </>
      )}
    </button>
  );
}
