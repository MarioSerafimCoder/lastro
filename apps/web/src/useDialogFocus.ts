import { useEffect } from "react";

export function useDialogFocus(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const selector =
      'button:not(:disabled), a[href], input, textarea, select, [tabindex="0"]';
    dialog.querySelector<HTMLElement>(selector)?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = [
        ...dialog.querySelectorAll<HTMLElement>(selector),
      ].filter((e) => e.getClientRects().length);
      const first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [active]);
}
