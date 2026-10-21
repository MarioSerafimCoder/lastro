import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
if (!existsSync(".dev.vars")) {
  writeFileSync(
    ".dev.vars",
    `ENVIRONMENT=development\nDEV_TOKEN=${randomBytes(32).toString("hex")}\nINGEST_ENABLED=true\n# OPENALEX_API_KEY=\n`,
  );
  console.log(
    "Criado .dev.vars com token aleatório. Use DEV_TOKEN no Bearer local.",
  );
} else console.log(".dev.vars existente foi preservado.");
