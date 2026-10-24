import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export function fullMotion() {
  return (
    document.documentElement.dataset.motion === "full" &&
    document.documentElement.dataset.input !== "keyboard" &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
let layoutTransition: ViewTransition | undefined;
export function transitionLayout(update: () => void) {
  layoutTransition?.skipTransition();
  if (fullMotion() && document.startViewTransition) {
    layoutTransition = document.startViewTransition(() => flushSync(update));
    void layoutTransition.finished.catch(() => {});
  } else flushSync(update);
}
const layouts = new WeakMap<HTMLElement, Animation>();
export function transitionCards(update: () => void) {
  const cards = [...document.querySelectorAll<HTMLElement>(".content-card")];
  // Capture presentation rectangles before cancelling an interrupted transition.
  const before = new Map(
    cards.map((card) => [card.id, card.getBoundingClientRect()]),
  );
  cards.forEach((card) => layouts.get(card)?.cancel());
  flushSync(update);
  if (!fullMotion()) return;
  const viewport = document.getElementById("main")?.getBoundingClientRect();
  for (const card of document.querySelectorAll<HTMLElement>(".content-card")) {
    const first = before.get(card.id),
      last = card.getBoundingClientRect();
    if (
      !first ||
      !viewport ||
      (first.bottom < viewport.top && last.bottom < viewport.top) ||
      (first.top > viewport.bottom && last.top > viewport.bottom)
    )
      continue;
    if (Math.abs(first.x - last.x) + Math.abs(first.y - last.y) < 1) continue;
    const a = card.animate(
      [
        { transform: `translate(${first.x - last.x}px,${first.y - last.y}px)` },
        { transform: "translate(0,0)" },
      ],
      { duration: 240, easing: "cubic-bezier(.23,1,.32,1)" },
    );
    a.id = "lastro-layout";
    layouts.set(card, a);
    a.onfinish = () => {
      if (layouts.get(card) === a) layouts.delete(card);
    };
  }
}

/** A reversible popover: keep the live presentation on rapid open/close. */
export function usePresence<T extends HTMLElement>(
  open: boolean,
  from: string,
) {
  const ref = useRef<T>(null),
    animation = useRef<Animation | null>(null);
  const [present, setPresent] = useState(open);
  const visible = open || present;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const previous = animation.current;
    const style = previous ? getComputedStyle(el) : null;
    const current = style
      ? { opacity: style.opacity, transform: style.transform }
      : null;
    if (previous) {
      previous.oncancel = null;
      previous.cancel();
    }
    if (!fullMotion()) {
      animation.current = null;
      setPresent(open);
      return;
    }
    setPresent(true);
    const hidden = { opacity: 0, transform: from },
      shown = { opacity: 1, transform: "translate(0,0) scale(1)" };
    const a = el.animate(
      [current ?? (open ? hidden : shown), open ? shown : hidden],
      {
        duration: open ? 180 : 120,
        easing: "cubic-bezier(.23,1,.32,1)",
      },
    );
    a.id = "lastro-presence";
    animation.current = a;
    const finish = () => {
      if (animation.current === a) {
        animation.current = null;
        setPresent(open);
      }
    };
    a.onfinish = finish;
    a.oncancel = finish;
  }, [open, visible, from]);
  useEffect(
    () => () => {
      if (animation.current) {
        animation.current.oncancel = null;
        animation.current.cancel();
      }
    },
    [],
  );
  return { ref, visible };
}
export function stopMotion() {
  for (const a of document.getAnimations())
    if (a.id.startsWith("lastro-")) a.cancel();
  layoutTransition?.skipTransition();
}
