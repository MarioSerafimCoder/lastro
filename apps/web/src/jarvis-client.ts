import { commercialApi } from "./Opportunities";
import type { JarvisState } from "../../../packages/contracts/jarvis";
let state: JarvisState | null = null,
  until = 0,
  inflight: Promise<JarvisState> | null = null;
export function invalidateJarvisClient() {
  until = 0;
}
export async function loadJarvisState(): Promise<JarvisState> {
  if (state && Date.now() < until) return state;
  if (inflight) return inflight;
  inflight = commercialApi("jarvis/state")
    .then((data: JarvisState) => {
      state = data;
      until = Date.now() + 300000;
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight!;
}
