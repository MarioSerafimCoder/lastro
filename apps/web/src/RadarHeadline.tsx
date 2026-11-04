import { useEffect, useRef, useState } from "react";
import type { Content } from "../../../packages/contracts";

const pending = new Map<string, Promise<string | null>>();
let quotaRetryAt = 0;

function cached(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

async function translate(title: string, language: string, key: string) {
  if (Date.now() < quotaRetryAt || new TextEncoder().encode(title).length > 500)
    return null;
  const params = new URLSearchParams({
    q: title,
    langpair: language + "|pt-BR",
  });
  const response = await fetch(
    "https://api.mymemory.translated.net/get?" + params,
    {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(12000),
    },
  );
  if (response.status === 429) quotaRetryAt = Date.now() + 3600000;
  if (!response.ok) return null;
  const data = await response.json();
  if (data.quotaFinished) {
    quotaRetryAt = Date.now() + 3600000;
    return null;
  }
  if (Number(data.responseStatus) !== 200) return null;
  const result = data.responseData?.translatedText;
  if (typeof result !== "string" || !result.trim()) return null;
  try {
    sessionStorage.setItem(key, result);
  } catch {
    /* Storage is optional. */
  }
  return result;
}

export function RadarHeadline({
  content,
  showOriginal = false,
}: {
  content: Content;
  showOriginal?: boolean;
}) {
  const { title } = content;
  const language =
    content.language?.toLowerCase().split(/[-_]/)[0] || "autodetect";
  const key = "radar:pt-br:" + language + ":" + title;
  const host = useRef<HTMLSpanElement>(null);
  const [entry, setEntry] = useState<{ key: string; value: string } | null>(
    null,
  );
  const translated = entry?.key === key ? entry.value : null;
  useEffect(() => {
    if (!host.current || language === "pt") return;
    const saved = cached(key);
    if (saved) {
      setEntry({ key, value: saved });
      return;
    }
    let active = true;
    const observer = new IntersectionObserver(([item]) => {
      if (!item.isIntersecting) return;
      observer.disconnect();
      let task = pending.get(key);
      if (!task) {
        task = translate(title, language, key)
          .catch(() => null)
          .finally(() => pending.delete(key));
        pending.set(key, task);
      }
      void task.then((value) => {
        if (active && value) setEntry({ key, value });
      });
    });
    observer.observe(host.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [key, title, language]);
  return (
    <span
      ref={host}
      lang={translated ? "pt-BR" : content.language || undefined}
    >
      {translated || title}
      {showOriginal && translated && translated !== title && (
        <small className="radar-original-title">
          Título original ·{" "}
          <span lang={content.language || undefined}>{title}</span>
        </small>
      )}
    </span>
  );
}
