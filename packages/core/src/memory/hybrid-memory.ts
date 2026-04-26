import { nowIso, safeJsonStringify } from "../common";
import type { JsonValue } from "../common";
import type { TraceEvent } from "../observability/tracer";
import type { ToolCall, ToolResult } from "../tooling/tool-registry";

export interface SemanticDocument {
  content: string;
  id: string;
  metadata?: Record<string, JsonValue>;
  payload: JsonValue;
}

export interface SemanticSearchQuery {
  limit?: number;
  query: string;
}

export interface SemanticSearchResult {
  id: string;
  payload: JsonValue;
  score: number;
}

export interface SemanticMemoryStore {
  search(query: SemanticSearchQuery): Promise<SemanticSearchResult[]>;
  upsert(document: SemanticDocument): Promise<void>;
}

export interface KnowledgeGraphEdge {
  from: string;
  label: string;
  to: string;
}

export interface KnowledgeGraphStore {
  neighbors(nodeId: string): Promise<KnowledgeGraphEdge[]>;
  putEdge(edge: KnowledgeGraphEdge): Promise<void>;
}

export class InMemoryEventMemory {
  private readonly events: TraceEvent[] = [];

  public async append(event: TraceEvent): Promise<void> {
    this.events.push(event);
  }

  public list(runId?: string): TraceEvent[] {
    return runId === undefined ? [...this.events] : this.events.filter((event) => event.runId === runId);
  }
}

export class KeywordSemanticMemory implements SemanticMemoryStore {
  private readonly documents = new Map<string, SemanticDocument>();

  public async search(query: SemanticSearchQuery): Promise<SemanticSearchResult[]> {
    const queryTerms = tokenize(query.query);
    const ranked = [...this.documents.values()]
      .map((document) => ({
        id: document.id,
        payload: document.payload,
        score: scoreTerms(queryTerms, tokenize(document.content))
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);

    return ranked.slice(0, query.limit ?? 5);
  }

  public async upsert(document: SemanticDocument): Promise<void> {
    this.documents.set(document.id, document);
  }
}

export class InMemoryKnowledgeGraph implements KnowledgeGraphStore {
  private readonly edges: KnowledgeGraphEdge[] = [];

  public async neighbors(nodeId: string): Promise<KnowledgeGraphEdge[]> {
    return this.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId);
  }

  public async putEdge(edge: KnowledgeGraphEdge): Promise<void> {
    this.edges.push(edge);
  }
}

export interface HybridMemoryOptions {
  eventMemory?: InMemoryEventMemory;
  knowledgeGraph?: KnowledgeGraphStore;
  semanticMemory?: SemanticMemoryStore;
}

export class HybridMemory {
  public readonly eventMemory: InMemoryEventMemory;
  public readonly knowledgeGraph: KnowledgeGraphStore | undefined;
  public readonly semanticMemory: SemanticMemoryStore;

  public constructor(options: HybridMemoryOptions = {}) {
    this.eventMemory = options.eventMemory ?? new InMemoryEventMemory();
    this.knowledgeGraph = options.knowledgeGraph;
    this.semanticMemory = options.semanticMemory ?? new KeywordSemanticMemory();
  }

  public async recall(query: SemanticSearchQuery): Promise<SemanticSearchResult[]> {
    return this.semanticMemory.search(query);
  }

  public async rememberEvent(event: TraceEvent): Promise<void> {
    await this.eventMemory.append(event);
    await this.semanticMemory.upsert({
      content: `${event.type} ${safeJsonStringify(event.payload)}`,
      id: `${event.runId}:${event.step}:${event.type}:${event.timestamp}`,
      metadata: {
        timestamp: event.timestamp,
        type: event.type
      },
      payload: event.payload
    });
  }

  public async rememberKnowledge(edge: KnowledgeGraphEdge): Promise<void> {
    await this.knowledgeGraph?.putEdge(edge);
  }

  public async rememberNote(note: string, payload: JsonValue): Promise<void> {
    await this.semanticMemory.upsert({
      content: note,
      id: `note:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
      metadata: {
        createdAt: nowIso()
      },
      payload
    });
  }

  public async rememberToolResult(
    runId: string,
    step: number,
    call: ToolCall,
    result: ToolResult
  ): Promise<void> {
    await this.semanticMemory.upsert({
      content: `${call.tool} ${safeJsonStringify(call.input)} -> ${safeJsonStringify(result.output)}`,
      id: `${runId}:${step}:${call.tool}`,
      metadata: {
        ok: result.ok,
        tool: call.tool
      },
      payload: result.output ?? {
        error: result.error ?? "Unknown tool error"
      }
    });
  }
}

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 1);

const scoreTerms = (left: string[], right: string[]): number => {
  const haystack = new Set(right);
  let matches = 0;

  for (const term of left) {
    if (haystack.has(term)) {
      matches += 1;
    }
  }

  return matches / Math.max(left.length, 1);
};
