function validateVector(vector: number[], name: string) {
  if (vector.length === 0) {
    throw new Error(`${name} must not be empty.`);
  }

  if (vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`${name} must contain only finite numbers.`);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  validateVector(a, "Vector a");
  validateVector(b, "Vector b");

  if (a.length !== b.length) {
    throw new Error(
      `Vector dimensions must match (received ${a.length} and ${b.length}).`,
    );
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let index = 0; index < a.length; index += 1) {
    dotProduct += a[index] * b[index];
    magnitudeA += a[index] * a[index];
    magnitudeB += b[index] * b[index];
  }

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / Math.sqrt(magnitudeA * magnitudeB);
}
