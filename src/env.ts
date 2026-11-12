export type Env = {
  DB: D1Database;
  EDITORIAL_AUTOPILOT_FREE_CONFIRMED?: string;
  RADAR_RETENTION_ENABLED?: string;
  ECOSYSTEM_HEALTH_ENABLED?: string;
  HEALTH_CF_ACCOUNT_ID?: string;
  HEALTH_CF_ANALYTICS_TOKEN?: string;
  HEALTH_CF_WORKER_NAME?: string;
  HEALTH_CF_D1_ID?: string;
  HEALTH_CF_FREE_CONFIRMED?: string;
  HEALTH_QUOTA_THRESHOLDS?: string;
  SEARCH_CONSOLE_ENABLED?: string;
  SEARCH_CONSOLE_SETUP?: string;
  SEARCH_CONSOLE_CLIENT_ID?: string;
  SEARCH_CONSOLE_CLIENT_SECRET?: string;
  SEARCH_CONSOLE_TOKEN_KEY?: string;
  BRAIN_DRIVE_ENABLED?: string;
  BRAIN_DRIVE_FREE_CONFIRMED?: string;
  BRAIN_DRIVE_CLIENT_ID?: string;
  BRAIN_DRIVE_CLIENT_SECRET?: string;
  BRAIN_DRIVE_TOKEN_KEY?: string;
  BRAIN_DRIVE_REDIRECT_URI?: string;
  PORTFOLIO_INTEGRATION_SECRET?: string;
  PORTFOLIO_CONTACT_ENDPOINT?: string;
  OPPORTUNITIES_RETENTION_DAYS?: string;
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
        chat_template_kwargs?: { enable_thinking: boolean };
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
