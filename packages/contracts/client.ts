import type {
  AdminSource,
  AdminOverview,
  ReviewCandidate,
  EditorialDecision,
  IngestionRun,
  SourceInput,
  Source,
  ApiError,
  Content,
  FeedPage,
  Page,
  Preferences,
  InteractionInput,
  ResearchInput,
  ResearchPackage,
  PromptResponse,
  Explanation,
  Policy,
} from "./index";

export class LastroApiError extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(body.error.message);
  }
}
export type SearchQuery = {
  q?: string;
  topic?: string;
  sourceId?: string;
  kind?: Content["kind"];
  language?: string;
  after?: string;
  before?: string;
  classification?: Content["annotations"][number]["classification"];
  limit?: number;
  offset?: number;
};
export type RelevanceResponse = {
  eligible: boolean;
  explanation: Explanation | null;
  scope: "individual_preview";
  note: string;
};
export type Collection = { id: string; name: string; createdAt?: string };
/** Production: same origin and Access session. devToken is only for a local development session. */
export function createLastroClient(
  options: {
    baseUrl?: string;
    devToken?: () => string | undefined;
    fetcher?: typeof fetch;
  } = {},
) {
  const fetcher = options.fetcher ?? fetch;
  const request = async <T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> => {
    const token = options.devToken?.();
    const response = await fetcher(`${options.baseUrl ?? ""}/api${path}`, {
      method,
      credentials: "include",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      if (response.status === 401 && typeof window !== "undefined")
        window.dispatchEvent(new Event("lastro:unauthorized"));
      let error: ApiError;
      try {
        error = (await response.json()) as ApiError;
      } catch {
        error = {
          error: {
            code: "network_response",
            message: "Resposta inesperada do servidor.",
            requestId: response.headers.get("X-Request-Id") ?? "",
          },
        };
      }
      throw new LastroApiError(response.status, error);
    }
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T);
  };
  const query = (q: object) => {
    const values = Object.entries(q)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]);
    return new URLSearchParams(values).toString();
  };
  return {
    radarStatus: (since?: string) =>
      request<import("./index").RadarStatus>(
        `/radar/status?${query({ since })}`,
      ),
    adminOverview: () => request<AdminOverview>("/admin/overview"),
    policy: () => request<Policy>("/admin/policy"),
    savePolicy: (input: Policy) =>
      request<Policy>("/admin/policy", "PUT", input),
    sources: (offset = 0) =>
      request<Page<AdminSource>>(`/admin/sources?limit=50&offset=${offset}`),
    saveSource: (input: SourceInput, id?: string) =>
      request<AdminSource>(
        `/admin/sources${id ? `/${id}` : ""}`,
        id ? "PUT" : "POST",
        input,
      ),
    sourceStatus: (id: string, status: Source["status"], reason: string) =>
      request<AdminSource>(`/admin/sources/${id}/status`, "PATCH", {
        status,
        reason,
      }),
    ingest: (id: string) =>
      request<IngestionRun>(`/admin/sources/${id}/ingest`, "POST"),
    candidates: (outcome = "pending", offset = 0) =>
      request<Page<ReviewCandidate>>(
        `/admin/candidates?${query({ outcome: outcome || undefined, offset, limit: 20 })}`,
      ),
    review: (id: string, input: import("./index").ReviewInput) =>
      request<{ contentId: string | null }>(
        `/admin/candidates/${id}/review`,
        "POST",
        input,
      ),
    runs: (offset = 0) =>
      request<Page<IngestionRun>>(
        `/admin/ingestion-runs?limit=20&offset=${offset}`,
      ),
    decisions: (offset = 0) =>
      request<Page<EditorialDecision>>(
        `/admin/decisions?limit=20&offset=${offset}`,
      ),
    feed: (q: { limit?: number; cursor?: string } = {}) =>
      request<FeedPage>(`/feed?${query(q)}`),
    search: (q: SearchQuery = {}) =>
      request<Page<Content>>(`/search?${query(q)}`),
    content: (id: string) =>
      request<Content>(`/contents/${encodeURIComponent(id)}`),
    relevance: (id: string) =>
      request<RelevanceResponse>(
        `/contents/${encodeURIComponent(id)}/relevance`,
      ),
    favorite: (id: string) =>
      request<Content>(`/contents/${encodeURIComponent(id)}/favorite`, "PUT"),
    unfavorite: (id: string) =>
      request<void>(`/contents/${encodeURIComponent(id)}/favorite`, "DELETE"),
    favorites: (q: SearchQuery = {}) =>
      request<Page<Content>>(`/favorites?${query(q)}`),
    collections: (q: { limit?: number; offset?: number } = {}) =>
      request<Page<Collection>>(`/collections?${query(q)}`),
    createCollection: (name: string) =>
      request<Collection>("/collections", "POST", { name }),
    collectionItems: (
      id: string,
      q: { limit?: number; offset?: number } = {},
    ) =>
      request<Page<Content>>(
        `/collections/${encodeURIComponent(id)}/items?${query(q)}`,
      ),
    addToCollection: (id: string, contentId: string) =>
      request<void>(
        `/collections/${encodeURIComponent(id)}/items/${encodeURIComponent(contentId)}`,
        "PUT",
      ),
    removeFromCollection: (id: string, contentId: string) =>
      request<void>(
        `/collections/${encodeURIComponent(id)}/items/${encodeURIComponent(contentId)}`,
        "DELETE",
      ),
    interact: (id: string, input: InteractionInput) =>
      request<Content>(
        `/contents/${encodeURIComponent(id)}/interactions`,
        "POST",
        input,
      ),
    note: (id: string, text: string) =>
      request<{ text: string }>(
        `/contents/${encodeURIComponent(id)}/note`,
        "PUT",
        { text },
      ),
    selection: () => request<{ items: Content[] }>("/workshop/selection"),
    setSelection: (contentIds: string[]) =>
      request<{ items: Content[] }>("/workshop/selection", "PUT", {
        contentIds,
      }),
    createPackage: (input: ResearchInput) =>
      request<ResearchPackage>("/research-packages", "POST", input),
    getPackage: (id: string) =>
      request<ResearchPackage>(`/research-packages/${encodeURIComponent(id)}`),
    prompt: (id: string) =>
      request<PromptResponse>(
        `/research-packages/${encodeURIComponent(id)}/prompt`,
        "POST",
      ),
    preferences: () => request<Preferences>("/preferences"),
    setPreferences: (input: Preferences) =>
      request<Preferences>("/preferences", "PUT", input),
  };
}
