export type SearchMode = "local" | "qdrant" | "zilliz";
export type EmbeddingMode = "local" | "gemini" | "voyage";
export type AuthMode = "disabled" | "google";

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function integerEnv(name: string, fallback: number): number {
  const raw = optionalEnv(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

export function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = optionalEnv(name);
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

export function enumEnv<const T extends string>(
  name: string,
  values: readonly T[],
  fallback: T,
): T {
  const value = optionalEnv(name) ?? fallback;
  if (!values.includes(value as T)) {
    throw new Error(`${name} must be one of: ${values.join(", ")}.`);
  }
  return value as T;
}
