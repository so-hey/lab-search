export function normalizeVector(vector: number[]): number[] {
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Embedding must contain finite numeric values.");
  }

  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0),
  );
  if (magnitude === 0) {
    throw new Error("Embedding must not be a zero vector.");
  }
  return vector.map((value) => value / magnitude);
}
