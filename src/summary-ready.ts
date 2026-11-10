import { synopsisGate } from "./synopsis-evidence";

// Apply before pagination so missing previews cannot create empty pages.
export const summaryReadySql = `((json_extract(s.config_json,'$.summaryAllowed')=1
  AND length(trim(COALESCE(json_extract(c.metadata_json,'$.description'),'')))>0)
  OR ${synopsisGate})`;
