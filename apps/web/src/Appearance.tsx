import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { flushSync } from "react-dom";
import Select from "./Select";

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
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      root.dataset.theme === "light" ? "#f8f9fa" : "#121212",
    );
}
export function fullMotion() {
  return (
    document.documentElement.dataset.motion === "full" &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
export function transitionLayout(update: () => void) {
  if (fullMotion() && document.startViewTransition) {
    void document
      .startViewTransition(() => flushSync(update))
      .finished.catch(() => {});
  } else update();
}
export function transitionCards(update: () => void) {
  if (!fullMotion()) {
    update();
    return;
  }
  const cards = [...document.querySelectorAll<HTMLElement>(".content-card")];
  const before = new Map(
    cards.map((card) => [card.id, card.getBoundingClientRect()]),
  );
  flushSync(update);
  const viewport = document.getElementById("main")?.getBoundingClientRect();
  for (const card of cards) {
    const first = before.get(card.id)!,
      last = card.getBoundingClientRect();
    if (
      viewport &&
      ((first.bottom > viewport.top && first.top < viewport.bottom) ||
        (last.bottom > viewport.top && last.top < viewport.bottom))
    )
      card.animate(
        [
          {
            transform: `translate(${first.x - last.x}px,${first.y - last.y}px)`,
            opacity: 0.65,
          },
          { transform: "translate(0,0)", opacity: 1 },
        ],
        { duration: 280, easing: "cubic-bezier(.22,1,.36,1)" },
      );
  }
}
export default function AppearanceControls() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme ?? "dark",
  );
  const [motion, setMotion] = useState(stored("lastro:motion", "full"));
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", applyAppearance);
    return () => media.removeEventListener("change", applyAppearance);
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
