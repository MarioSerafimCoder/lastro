// A trigger body contains semicolons; migration boundaries must stay explicit.
export function migrationStatements(sql: string) {
  return (
    sql.includes("-- statement-breakpoint")
      ? sql.split(/^-- statement-breakpoint\s*$/m)
      : sql.split(";")
  )
    .map((s) => s.trim())
    .filter(Boolean);
}
