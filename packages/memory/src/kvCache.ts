export type KvCacheEvictionStrategy = "lru" | "sliding_window";

export interface KvCacheOptions {
  evictionStrategy?: KvCacheEvictionStrategy;
  maxBytes: number;
  tokenByteOverhead?: number;
  windowSizeTokens?: number;
}

export interface KvCacheTokenInput {
  position: number;
  requestId: string;
  sizeBytes?: number;
  token: string;
}

export interface KvCacheEntry {
  addedAtMs: number;
  id: string;
  lastAccessedAtMs: number;
  position: number;
  requestId: string;
  sizeBytes: number;
  token: string;
}

export interface KvCacheUsage {
  evictionCount: number;
  maxBytes: number;
  tokenCount: number;
  usedBytes: number;
  utilization: number;
}

export interface KvCacheAddResult {
  entry: KvCacheEntry;
  evicted: KvCacheEntry[];
}

export class KvCacheSimulator {
  private readonly evictionStrategy: KvCacheEvictionStrategy;
  private evictions = 0;
  private readonly maxBytes: number;
  private readonly tokenByteOverhead: number;
  private readonly windowSizeTokens: number;
  private readonly entries = new Map<string, KvCacheEntry>();
  private usedBytes = 0;

  public constructor(options: KvCacheOptions) {
    this.evictionStrategy = options.evictionStrategy ?? "sliding_window";
    this.maxBytes = options.maxBytes;
    this.tokenByteOverhead = options.tokenByteOverhead ?? 64;
    this.windowSizeTokens = options.windowSizeTokens ?? 128;
  }

  public add(input: KvCacheTokenInput): KvCacheAddResult {
    const now = performance.now();
    const entry: KvCacheEntry = {
      addedAtMs: now,
      id: buildEntryId(input.requestId, input.position),
      lastAccessedAtMs: now,
      position: input.position,
      requestId: input.requestId,
      sizeBytes: input.sizeBytes ?? estimateTokenBytes(input.token, this.tokenByteOverhead),
      token: input.token
    };

    this.entries.set(entry.id, entry);
    this.usedBytes += entry.sizeBytes;

    const evicted: KvCacheEntry[] = [];
    evicted.push(...this.applySlidingWindow(entry.requestId));
    evicted.push(...this.applyMemoryLimit());

    return {
      entry,
      evicted
    };
  }

  public touch(requestId: string, position: number): void {
    const key = buildEntryId(requestId, position);
    const entry = this.entries.get(key);

    if (entry !== undefined) {
      entry.lastAccessedAtMs = performance.now();
    }
  }

  public listEntries(requestId?: string): KvCacheEntry[] {
    const values = [...this.entries.values()].sort((left, right) => left.position - right.position);
    return requestId === undefined ? values : values.filter((entry) => entry.requestId === requestId);
  }

  public getUsage(): KvCacheUsage {
    return {
      evictionCount: this.evictions,
      maxBytes: this.maxBytes,
      tokenCount: this.entries.size,
      usedBytes: this.usedBytes,
      utilization: this.maxBytes === 0 ? 0 : this.usedBytes / this.maxBytes
    };
  }

  public clear(): void {
    this.entries.clear();
    this.usedBytes = 0;
    this.evictions = 0;
  }

  private applySlidingWindow(requestId: string): KvCacheEntry[] {
    if (this.evictionStrategy !== "sliding_window") {
      return [];
    }

    const entries = this.listEntries(requestId);
    if (entries.length <= this.windowSizeTokens) {
      return [];
    }

    const overflow = entries.length - this.windowSizeTokens;
    return entries.slice(0, overflow).map((entry) => this.evictEntry(entry.id)).filter(isDefined);
  }

  private applyMemoryLimit(): KvCacheEntry[] {
    const evicted: KvCacheEntry[] = [];

    while (this.usedBytes > this.maxBytes && this.entries.size > 0) {
      const next = this.selectVictim();

      if (next === undefined) {
        break;
      }

      const removed = this.evictEntry(next.id);

      if (removed !== undefined) {
        evicted.push(removed);
      }
    }

    return evicted;
  }

  private selectVictim(): KvCacheEntry | undefined {
    const candidates = [...this.entries.values()];

    if (this.evictionStrategy === "lru") {
      return candidates.sort((left, right) => left.lastAccessedAtMs - right.lastAccessedAtMs)[0];
    }

    return candidates.sort((left, right) => left.addedAtMs - right.addedAtMs)[0];
  }

  private evictEntry(id: string): KvCacheEntry | undefined {
    const entry = this.entries.get(id);

    if (entry === undefined) {
      return undefined;
    }

    this.entries.delete(id);
    this.usedBytes -= entry.sizeBytes;
    this.evictions += 1;

    return entry;
  }
}

const buildEntryId = (requestId: string, position: number): string => `${requestId}:${position}`;

const estimateTokenBytes = (token: string, tokenByteOverhead: number): number =>
  tokenByteOverhead + Math.max(token.length * 2, 2);

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

