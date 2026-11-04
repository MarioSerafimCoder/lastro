import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { fullMotion } from "./motion";

export default function RadarCountryCarousel({
  code,
  name,
  count,
  children,
}: {
  code: string;
  name: string;
  count: number;
  children: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    left: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const frame = useRef(0);
  const [position, setPosition] = useState({
    first: 1,
    last: Math.min(3, count),
    start: true,
    end: count <= 3,
  });
  const headingId = `radar-country-${code}`;
  const trackId = `radar-track-${code}`;
  const stride = () => {
    const el = track.current;
    if (!el) return 0;
    return (
      (el.firstElementChild?.getBoundingClientRect().width ?? 0) +
      parseFloat(getComputedStyle(el).columnGap || "0")
    );
  };
  function measure() {
    const el = track.current;
    if (!el) return;
    const step = stride();
    const first = step ? Math.round(el.scrollLeft / step) + 1 : 1;
    const next = {
      first,
      last: Math.min(count, first + 2),
      start: el.scrollLeft < 2,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    };
    setPosition((old) =>
      Object.keys(next).every(
        (key) =>
          old[key as keyof typeof old] === next[key as keyof typeof next],
      )
        ? old
        : next,
    );
  }
  function scheduleMeasure() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  }
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [count]);
  function advance(direction: number, animate = true) {
    track.current?.scrollBy({
      left: stride() * direction * 3,
      behavior: animate && fullMotion() ? "smooth" : "auto",
    });
  }
  function release() {
    const el = track.current,
      current = drag.current;
    drag.current = null;
    el?.classList.remove("is-dragging", "is-pressed");
    if (current && el?.hasPointerCapture(current.id))
      el.releasePointerCapture(current.id);
    if (current && el) {
      const step = stride();
      if (step)
        el.scrollTo({
          left: Math.round(el.scrollLeft / step) * step,
          behavior: fullMotion() ? "smooth" : "auto",
        });
    }
    requestAnimationFrame(() => {
      suppressClick.current = false;
    });
    scheduleMeasure();
  }
  return (
    <section
      className="radar-country"
      aria-labelledby={headingId}
      data-country={code}
    >
      <header className="radar-country-heading">
        <div className="radar-country-name">
          {code !== "unknown" && (
            <span className="radar-country-code" aria-hidden="true">
              {code}
            </span>
          )}
          <h3 id={headingId}>{name}</h3>
          <span className="radar-country-count">
            {count} {count === 1 ? "matéria" : "matérias"}
          </span>
        </div>
        {count > 3 && (
          <div className="radar-carousel-controls">
            <span
              className="radar-carousel-position"
              aria-label={`Posição no carrossel de ${name}`}
            >
              {position.first}–{position.last} <span>de {count}</span>
            </span>
            <button
              type="button"
              aria-label={`Matérias anteriores — ${name}`}
              aria-controls={trackId}
              disabled={position.start}
              onClick={(e) => advance(-1, e.detail !== 0)}
            >
              <ArrowLeft size={18} />
            </button>
            <button
              type="button"
              aria-label={`Próximas matérias — ${name}`}
              aria-controls={trackId}
              disabled={position.end}
              onClick={(e) => advance(1, e.detail !== 0)}
            >
              <ArrowRight size={18} />
            </button>
          </div>
        )}
      </header>
      <div
        ref={track}
        id={trackId}
        className="radar-carousel-track"
        role="region"
        aria-roledescription="carrossel"
        aria-label={`Matérias de ${name}`}
        tabIndex={0}
        onScroll={scheduleMeasure}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            advance(e.key === "ArrowRight" ? 1 : -1, false);
          }
          if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            e.currentTarget.scrollTo({
              left: e.key === "Home" ? 0 : e.currentTarget.scrollWidth,
              behavior: "auto",
            });
          }
        }}
        onPointerDown={(e) => {
          if (
            e.pointerType !== "mouse" ||
            e.button !== 0 ||
            !e.isPrimary ||
            (e.target as Element).closest(
              ".radar-card-actions,a,input,select,textarea",
            )
          )
            return;
          suppressClick.current = false;
          e.currentTarget.classList.add("is-pressed");
          e.currentTarget.scrollTo({
            left: e.currentTarget.scrollLeft,
            behavior: "instant",
          });
          drag.current = {
            id: e.pointerId,
            x: e.clientX,
            left: e.currentTarget.scrollLeft,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          const current = drag.current;
          if (!current || current.id !== e.pointerId) return;
          if (!(e.buttons & 1)) {
            release();
            return;
          }
          const distance = e.clientX - current.x;
          if (!current.moved && Math.abs(distance) < 6) return;
          if (!current.moved) {
            current.moved = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            e.currentTarget.classList.add("is-dragging");
            window.getSelection()?.removeAllRanges();
          }
          suppressClick.current = true;
          e.preventDefault();
          e.currentTarget.scrollLeft = current.left - distance;
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={() => {
          if (drag.current) release();
        }}
        onDragStart={(e) => e.preventDefault()}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.preventDefault();
            e.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        {children}
      </div>
    </section>
  );
}
