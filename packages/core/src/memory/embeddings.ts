import type { SemanticDocument, SemanticMemoryStore, SemanticSearchQuery, SemanticSearchResult } from "./hybrid-memory";

export interface EmbeddingModel {
  dimensions: number | undefined;
  embed(texts: string[]): Promise<number[][]>;
  name: string;
}

interface VectorEntry {
  document: SemanticDocument;
  vector: number[];
}

export class HashedEmbeddingModel implements EmbeddingModel {
  public readonly dimensions: number;
  public readonly name: string;

  public constructor(dimensions = 128, name = "hashed-embedding") {
    this.dimensions = dimensions;
    this.name = name;
  }

  public async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => embedText(text, this.dimensions));
  }
}

export class VectorSemanticMemory implements SemanticMemoryStore {
  private readonly documents = new Map<string, VectorEntry>();
  private readonly embeddingModel: EmbeddingModel;

  public constructor(embeddingModel: EmbeddingModel) {
    this.embeddingModel = embeddingModel;
  }

  public async search(query: SemanticSearchQuery): Promise<SemanticSearchResult[]> {
    const [queryVector] = await this.embeddingModel.embed([query.query]);

    if (queryVector === undefined) {
      return [];
    }

    const ranked = [...this.documents.values()]
      .map((entry) => ({
        id: entry.document.id,
        payload: entry.document.payload,
        score: cosineSimilarity(queryVector, entry.vector)
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);

    return ranked.slice(0, query.limit ?? 5);
  }

  public async upsert(document: SemanticDocument): Promise<void> {
    const [vector] = await this.embeddingModel.embed([document.content]);

    if (vector === undefined) {
      throw new Error("Embedding model did not return a vector");
    }

    this.documents.set(document.id, {
      document,
      vector
    });
  }
}

const embedText = (text: string, dimensions: number): number[] => {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 1);

  for (const token of tokens) {
    const slot = stableHash(token) % dimensions;
    vector[slot] = (vector[slot] ?? 0) + 1;
  }

  return normalizeVector(vector);
};

const stableHash = (value: string): number => {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
};

const normalizeVector = (vector: number[]): number[] => {
  const magnitude = Math.sqrt(vector.reduce((sum, current) => sum + current * current, 0));

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
};

const cosineSimilarity = (left: number[], right: number[]): number => {
  const length = Math.min(left.length, right.length);
  let dot = 0;

  for (let index = 0; index < length; index += 1) {
    dot += left[index]! * right[index]!;
  }

  return dot;
};
