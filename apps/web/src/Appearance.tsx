import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import Select from "./Select";
import { transitionLayout, stopMotion } from "./motion";
export { fullMotion, transitionLayout, transitionCards } from "./motion";

export type MotionPreference = "full" | "reduced" | "off";
const memory = new Map<string, string>();
function stored(key: string, fallback: string) {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Preferences still work in memory. */
  }
}
export function applyAppearance() {
  const root = document.documentElement;
  root.dataset.theme =
    stored("lastro:theme", "dark") === "light" ? "light" : "dark";
  const preference = stored("lastro:motion", "full");
  root.dataset.motion =
    preference === "off"
      ? "off"
      : preference === "reduced" ||
          matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "reduced"
        : "full";
  if (root.dataset.motion !== "full") stopMotion();
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      root.dataset.theme === "light" ? "#f8f9fa" : "#121212",
    );
}
export default function AppearanceControls() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme ?? "dark",
  );
  const [motion, setMotion] = useState(stored("lastro:motion", "full"));
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", applyAppearance);
    const keyboard = () => {
      document.documentElement.dataset.input = "keyboard";
      stopMotion();
    };
    const pointer = () => {
      if (document.documentElement.dataset.input !== "pointer")
        document.documentElement.dataset.input = "pointer";
    };
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("pointermove", pointer, {
      capture: true,
      passive: true,
    });
    return () => {
      media.removeEventListener("change", applyAppearance);
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("pointermove", pointer, true);
    };
  }, []);
  return (
    <div className="appearance-controls" aria-label="Aparência e movimento">
      <button
        type="button"
        className="appearance-theme"
        aria-label={
          theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"
        }
        onClick={() => {
          const next = theme === "dark" ? "light" : "dark";
          transitionLayout(() => {
            save("lastro:theme", next);
            setTheme(next);
            applyAppearance();
          });
        }}
      >
        {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        <span>{theme === "dark" ? "Claro" : "Escuro"}</span>
      </button>
      <label>
        <span className="sr-only">Intensidade de movimento</span>
        <Select
          label="Intensidade de movimento"
          value={motion}
          onValueChange={(nextValue) => {
            setMotion(nextValue);
            save("lastro:motion", nextValue);
            applyAppearance();
          }}
        >
          <option value="full">Movimento completo</option>
          <option value="reduced">Movimento reduzido</option>
          <option value="off">Movimento desativado</option>
        </Select>
      </label>
    </div>
  );
}
