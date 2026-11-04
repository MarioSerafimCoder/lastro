export class JarvisRequestError extends Error {
  constructor(
    public status: number,
    message = "Jarvis indisponível.",
  ) {
    super(message);
  }
}
export async function jarvisApi(path: string, init?: RequestInit) {
  const response = await fetch("/api/" + path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    // A Google authorization failure does not invalidate the Lastro session.
    if (
      response.status === 401 &&
      !String(failure?.error?.code ?? "").startsWith("drive_")
    ) {
      window.dispatchEvent(new Event("jarvis:logout"));
      window.dispatchEvent(new Event("lastro:unauthorized"));
      throw new Error("Sessão encerrada.");
    }
    throw new JarvisRequestError(
      response.status,
      typeof failure?.error?.message === "string"
        ? failure.error.message
        : undefined,
    );
  }
  return response.json();
}
import type { JarvisState } from "../../../packages/contracts/jarvis";
let generation = 0;
let controller: AbortController | null = null;
export function clearJarvisSession() {
  generation++;
  controller?.abort();
  controller = null;
  state = null;
  until = 0;
  inflight = null;
}
let state: JarvisState | null = null,
  until = 0,
  inflight: Promise<JarvisState> | null = null;
export function invalidateJarvisClient() {
  until = 0;
}
export async function loadJarvisState(): Promise<JarvisState> {
  if (state && Date.now() < until) return state;
  if (inflight) return inflight;
  const epoch = generation;
  controller = new AbortController();
  inflight = jarvisApi("jarvis/state", { signal: controller.signal })
    .then((data: JarvisState) => {
      if (epoch === generation) {
        state = data;
        until = Date.now() + 300000;
      }
      return data;
    })
    .finally(() => {
      if (epoch === generation) inflight = null;
    });
  return inflight!;
}
