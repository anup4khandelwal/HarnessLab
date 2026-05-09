export interface PrefixCacheLookup {
  cachedTokens: number;
  hitRate: number;
  matchedEntryId: string | undefined;
}

export interface PrefixCacheStats {
  averageHitRate: number;
  hits: number;
  misses: number;
  storedEntries: number;
  totalTokensSaved: number;
}

interface PrefixCacheEntry {
  hitCount: number;
  id: string;
  storedAtMs: number;
  tokens: string[];
}

export class PrefixCache {
  private readonly entries: PrefixCacheEntry[] = [];
  private hits = 0;
  private misses = 0;
  private totalTokensSaved = 0;

  public lookup(tokens: string[]): PrefixCacheLookup {
    let bestMatchLength = 0;
    let bestEntryId: string | undefined;

    for (const entry of this.entries) {
      const matchLength = commonPrefixLength(tokens, entry.tokens);

      if (matchLength > bestMatchLength) {
        bestMatchLength = matchLength;
        bestEntryId = entry.id;
      }
    }

    if (bestMatchLength === 0) {
      this.misses += 1;
      return {
        cachedTokens: 0,
        hitRate: 0,
        matchedEntryId: undefined
      };
    }

    this.hits += 1;
    this.totalTokensSaved += bestMatchLength;

    const matched = this.entries.find((entry) => entry.id === bestEntryId);

    if (matched !== undefined) {
      matched.hitCount += 1;
    }

    return {
      cachedTokens: bestMatchLength,
      hitRate: bestMatchLength / Math.max(tokens.length, 1),
      matchedEntryId: bestEntryId
    };
  }

  public store(tokens: string[]): string {
    const id = `prefix_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    this.entries.push({
      hitCount: 0,
      id,
      storedAtMs: performance.now(),
      tokens: [...tokens]
    });
    return id;
  }

  public getStats(): PrefixCacheStats {
    const total = this.hits + this.misses;
    return {
      averageHitRate: total === 0 ? 0 : this.hits / total,
      hits: this.hits,
      misses: this.misses,
      storedEntries: this.entries.length,
      totalTokensSaved: this.totalTokensSaved
    };
  }

  public clear(): void {
    this.entries.length = 0;
    this.hits = 0;
    this.misses = 0;
    this.totalTokensSaved = 0;
  }
}

const commonPrefixLength = (a: string[], b: string[]): number => {
  let length = 0;
  const min = Math.min(a.length, b.length);

  while (length < min && a[length] === b[length]) {
    length += 1;
  }

  return length;
};
