import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { usePresence } from "./motion";
type Option = { value: string; label: string; disabled?: boolean };
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? text(child.props.children)
        : String(child),
    )
    .join("");
}
export default function Select({
  value,
  onValueChange,
  children,
  label,
  "aria-label": ariaLabel,
  id,
  name,
  disabled = false,
  compactLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  label?: string;
  "aria-label"?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  compactLabel?: string;
}) {
  const uid = useId(),
    button = useRef<HTMLButtonElement>(null);
  const options: Option[] = Children.toArray(children).flatMap((child) =>
    isValidElement<{ value: string; children: ReactNode; disabled?: boolean }>(
      child,
    )
      ? [
          {
            value: String(child.props.value),
            label: text(child.props.children),
            disabled: child.props.disabled,
          },
        ]
      : [],
  );
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(selected);
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    width: 220,
    maxHeight: 280,
    flipped: false,
    origin: 16,
  });
  const { ref: menu, visible } = usePresence<HTMLDivElement>(
    open,
    `translateY(${position.flipped ? -4 : 4}px) scale(.98)`,
  );
  const typed = useRef(""),
    typeTimer = useRef<number | undefined>(undefined);
  const choose = (index: number) => {
    if (options[index]?.disabled) return;
    onValueChange(options[index].value);
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(Math.max(r.width, 220), window.innerWidth - 24),
        below = innerHeight - r.bottom - 16,
        above = r.top - 16;
      const flip = below < 220 && above > below,
        maxHeight = Math.min(320, Math.max(100, flip ? above : below));
      setPosition({
        left: Math.max(12, Math.min(r.left, innerWidth - width - 12)),
        width,
        maxHeight,
        flipped: flip,
        origin: Math.max(
          12,
          r.left -
            Math.max(12, Math.min(r.left, innerWidth - width - 12)) +
            r.width / 2,
        ),
        top: flip
          ? Math.max(
              12,
              r.top - Math.min(maxHeight, options.length * 42 + 12) - 6,
            )
          : r.bottom + 6,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const outside = (event: PointerEvent) => {
      if (
        !button.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (open)
      menu.current?.children.item(active)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  useEffect(() => () => window.clearTimeout(typeTimer.current), []);
  const move = (direction: number) => {
    let next = active;
    for (let i = 0; i < options.length; i++) {
      next = (next + direction + options.length) % options.length;
      if (!options[next].disabled) {
        setActive(next);
        break;
      }
    }
  };
  return (
    <span className="select-control">
      {name && <input type="hidden" name={name} value={value} />}
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel ?? label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? uid : undefined}
        aria-activedescendant={open ? `${uid}-${active}` : undefined}
        disabled={disabled}
        className={`select-trigger ${open ? "is-open" : ""}`}
        onClick={() => {
          setActive(selected);
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            return;
          }
          if (event.key === "Tab") {
            setOpen(false);
            return;
          }
          if (
            ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(
              event.key,
            )
          ) {
            event.preventDefault();
            if (!open) {
              setActive(selected);
              setOpen(true);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp")
              move(event.key === "ArrowDown" ? 1 : -1);
            else if (event.key === "Home") setActive(0);
            else if (event.key === "End") setActive(options.length - 1);
            else choose(active);
          } else if (
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            window.clearTimeout(typeTimer.current);
            typed.current += event.key.toLocaleLowerCase("pt-BR");
            const index = options.findIndex(
              (o) =>
                !o.disabled &&
                o.label.toLocaleLowerCase("pt-BR").startsWith(typed.current),
            );
            if (index >= 0) {
              setActive(index);
              setOpen(true);
            }
            typeTimer.current = window.setTimeout(
              () => (typed.current = ""),
              600,
            );
          }
        }}
      >
        <span
          className={compactLabel && !value ? "select-full-label" : undefined}
        >
          {options.find((option) => option.value === value)?.label ??
            options[0]?.label}
        </span>
        {compactLabel && !value && (
          <span className="select-short-label" aria-hidden="true">
            {compactLabel}
          </span>
        )}
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {visible &&
        createPortal(
          <div
            ref={menu}
            id={uid}
            role="listbox"
            aria-label={ariaLabel ?? label}
            aria-hidden={!open || undefined}
            inert={!open}
            className="select-menu"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
              transformOrigin: `${position.origin}px ${position.flipped ? "bottom" : "top"}`,
            }}
          >
            {options.map((option, index) => (
              <div
                id={`${uid}-${index}`}
                key={option.value}
                role="option"
                aria-selected={value === option.value}
                aria-disabled={option.disabled || undefined}
                className={`select-option ${active === index ? "is-highlighted" : ""}`}
                onPointerMove={() => setActive(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation();
                  choose(index);
                }}
              >
                <span>{option.label}</span>
                {value === option.value && (
                  <Check size={15} aria-hidden="true" />
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
