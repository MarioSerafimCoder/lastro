export type Env = {
  DB: D1Database;
  ENVIRONMENT?: string;
  DEV_TOKEN?: string;
  ALLOWED_ORIGIN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  OWNER_EMAIL?: string;
  OWNER_PASSWORD_SHA256?: string;
  SESSION_SIGNING_KEY?: string;
  ALLOWED_FETCH_HOSTS?: string;
  OPENALEX_API_KEY?: string;
  INGEST_ENABLED?: string;
  INGEST_BATCH_SIZE?: string;
  AI?: {
    run: (
      model: string,
      input: {
        messages: { role: string; content: string }[];
        max_tokens: number;
        temperature: number;
        response_format?: {
          type: "json_object" | "json_schema";
          json_schema?: unknown;
        };
      },
    ) => Promise<unknown>;
  };
  SYNOPSIS_ENABLED?: string;
  SYNOPSIS_REQUIRED?: string;
};
