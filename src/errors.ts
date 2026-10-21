export class ApiFault extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function must<T>(
  value: T | null | undefined,
  message = "Registro não encontrado",
): T {
  if (value == null) throw new ApiFault(404, "not_found", message);
  return value;
}
