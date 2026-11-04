export class JarvisRequestError extends Error {
  constructor(public status: number) {
    super("Jarvis indisponível.");
  }
}
export async function jarvisApi(path: string, init?: RequestInit) {
  const response = await fetch("/api/" + path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (response.status === 401) {
    window.dispatchEvent(new Event("jarvis:logout"));
    window.dispatchEvent(new Event("lastro:unauthorized"));
    throw new Error("Sessão encerrada.");
  }
  if (!response.ok) throw new JarvisRequestError(response.status);
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
