import type { EmbeddingProvider } from "./EmbeddingProvider.js";

const DEFAULT_DIMENSIONS = 384;

type WeightedFeature = {
  count: number;
  weight: number;
};

function hashFeature(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function addFeature(
  features: Map<string, WeightedFeature>,
  feature: string,
  weight: number,
) {
  const current = features.get(feature);
  features.set(feature, {
    count: (current?.count ?? 0) + 1,
    weight,
  });
}

function extractFeatures(text: string): Map<string, WeightedFeature> {
  const normalized = text.normalize("NFKC").toLocaleLowerCase().trim();
  const features = new Map<string, WeightedFeature>();
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];

  for (const word of words) {
    addFeature(features, `word:${word}`, 2);
  }

  for (let index = 0; index < words.length - 1; index += 1) {
    addFeature(features, `pair:${words[index]}_${words[index + 1]}`, 1.5);
  }

  const characterSource = normalized.replace(/\s+/g, " ");
  const characterNgrams = [
    { size: 2, weight: 0.55 },
    { size: 3, weight: 0.35 },
  ];

  for (const { size, weight } of characterNgrams) {
    for (let index = 0; index <= characterSource.length - size; index += 1) {
      addFeature(
        features,
        `char-${size}:${characterSource.slice(index, index + size)}`,
        weight,
      );
    }
  }

  return features;
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local-hashing-v2";
  readonly dimensions: number;

  constructor(dimensions = DEFAULT_DIMENSIONS) {
    if (!Number.isInteger(dimensions) || dimensions < 8) {
      throw new Error("Embedding dimensions must be an integer of at least 8.");
    }

    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const vector = Array<number>(this.dimensions).fill(0);

    for (const [feature, { count, weight }] of extractFeatures(text)) {
      const bucket = hashFeature(feature) % this.dimensions;
      const sign = hashFeature(`${feature}:sign`) % 2 === 0 ? 1 : -1;
      const termFrequency = 1 + Math.log(count);
      vector[bucket] += sign * weight * termFrequency;
    }

    const magnitude = Math.sqrt(
      vector.reduce((sum, value) => sum + value * value, 0),
    );

    if (magnitude === 0) {
      return vector;
    }

    return vector.map((value) => value / magnitude);
  }

  async embedDocument(text: string, title?: string): Promise<number[]> {
    void title;
    return this.embed(text);
  }

  async embedDocuments(texts: string[], title?: string): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embedDocument(text, title)));
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text);
  }
}
