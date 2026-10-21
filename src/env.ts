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
};
