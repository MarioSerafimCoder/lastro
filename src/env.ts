export type Env = {
  DB: D1Database;
  ANALYTICS_ENABLED?: string;
  GA4_PROPERTY_ID?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GA4_REFRESH_TOKEN?: string;
  INTEGRATION_ENABLED?: string;
  ECOSYSTEM_STAGING?: string;
  STUDIO?: Fetcher;
  STUDIO_ORIGIN?: string;
  CRM_ORIGIN?: string;
  STUDIO_INTEGRATION_SECRET?: string;
  CRM_INTEGRATION_SECRET?: string;
  CRM_ACCESS_CLIENT_ID?: string;
  CRM_ACCESS_CLIENT_SECRET?: string;
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
