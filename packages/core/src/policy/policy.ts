import { nowIso } from "../common";
import type { JsonObject } from "../common";
import type { ToolCall } from "../tooling/tool-registry";

export interface PolicyContext {
  runId: string;
  step: number;
  workingMemory: JsonObject;
}

export interface PolicyAction {
  input: JsonObject;
  kind: string;
  name: string;
}

export type PolicyInput = PolicyAction | ToolCall;

export type PolicyDisposition = "allow" | "deny" | "require_approval";

export interface PolicyDecision {
  action: PolicyAction;
  allowed: boolean;
  approval: ApprovalDecision | undefined;
  disposition: PolicyDisposition;
  reason: string;
}

export type ApprovalStatus = "approved" | "denied" | "pending";

export interface ToolPolicy {
  allows(action: PolicyInput, context: PolicyContext): Promise<PolicyDecision>;
}

export interface ApprovalRequest {
  action: PolicyAction;
  context: PolicyContext;
  requestedAt: string;
  reason: string;
}

export interface ApprovalDecision {
  approver?: string;
  decidedAt?: string;
  notes?: string;
  requestedAt: string;
  status: ApprovalStatus;
}

export interface ApprovalGate {
  request(request: ApprovalRequest): Promise<ApprovalDecision>;
}

export interface PolicyRule {
  actionKind?: string;
  effect: "allow" | "approve" | "deny" | "require_approval";
  match?: (action: PolicyAction, context: PolicyContext) => boolean;
  name?: string;
  reason: string;
  tool?: string;
}

export class AllowAllPolicy implements ToolPolicy {
  public async allows(action: PolicyInput): Promise<PolicyDecision> {
    const normalized = normalizePolicyAction(action);

    return {
      action: normalized,
      allowed: true,
      approval: undefined,
      disposition: "allow",
      reason: `${normalized.name} allowed`
    };
  }
}

export class StaticApprovalGate implements ApprovalGate {
  private readonly approved: boolean;
  private readonly approver: string;

  public constructor(approved: boolean, approver = "static-approval-gate") {
    this.approved = approved;
    this.approver = approver;
  }

  public async request(request: ApprovalRequest): Promise<ApprovalDecision> {
    return {
      approver: this.approver,
      decidedAt: nowIso(),
      notes: this.approved ? "Automatically approved" : "Automatically denied",
      requestedAt: request.requestedAt,
      status: this.approved ? "approved" : "denied"
    };
  }
}

export interface ApprovalRecord {
  decision: ApprovalDecision;
  request: ApprovalRequest;
}

export type ApprovalDecider = (
  request: ApprovalRequest
) => Promise<ApprovalDecision> | ApprovalDecision;

export class InMemoryApprovalGate implements ApprovalGate {
  private readonly decider: ApprovalDecider | undefined;
  private readonly records: ApprovalRecord[] = [];

  public constructor(decider?: ApprovalDecider) {
    this.decider = decider;
  }

  public list(): ApprovalRecord[] {
    return [...this.records];
  }

  public async request(request: ApprovalRequest): Promise<ApprovalDecision> {
    const decision =
      (await this.decider?.(request)) ?? {
        notes: "Awaiting manual approval",
        requestedAt: request.requestedAt,
        status: "pending"
      };

    this.records.push({
      decision,
      request
    });

    return decision;
  }
}

export class RuleBasedPolicy implements ToolPolicy {
  private readonly approvalGate: ApprovalGate | undefined;
  private readonly rules: PolicyRule[];

  public constructor(rules: PolicyRule[], approvalGate?: ApprovalGate) {
    this.rules = rules;
    this.approvalGate = approvalGate;
  }

  public async allows(action: PolicyInput, context: PolicyContext): Promise<PolicyDecision> {
    const normalized = normalizePolicyAction(action);

    for (const rule of this.rules) {
      const toolMatches =
        rule.tool === undefined || (normalized.kind === "tool" && rule.tool === normalized.name);
      const nameMatches = rule.name === undefined || rule.name === normalized.name;
      const kindMatches = rule.actionKind === undefined || rule.actionKind === normalized.kind;
      const customMatch = rule.match?.(normalized, context) ?? true;

      if (!toolMatches || !nameMatches || !kindMatches || !customMatch) {
        continue;
      }

      if (rule.effect === "deny") {
        return {
          action: normalized,
          allowed: false,
          approval: undefined,
          disposition: "deny",
          reason: rule.reason
        };
      }

      if (rule.effect === "allow") {
        return {
          action: normalized,
          allowed: true,
          approval: undefined,
          disposition: "allow",
          reason: rule.reason
        };
      }

      const approval = await this.approvalGate?.request({
        action: normalized,
        context,
        requestedAt: nowIso(),
        reason: rule.reason
      });

      return {
        action: normalized,
        allowed: approval?.status === "approved",
        approval,
        disposition: "require_approval",
        reason:
          approval === undefined
            ? `${rule.reason} (no approval gate configured)`
            : `${rule.reason} (${approval.status})`
      };
    }

    return {
      action: normalized,
      allowed: true,
      approval: undefined,
      disposition: "allow",
      reason: `${normalized.name} allowed by default`
    };
  }
}

export const normalizePolicyAction = (action: PolicyInput): PolicyAction =>
  "tool" in action
    ? {
        input: action.input,
        kind: "tool",
        name: action.tool
      }
    : action;
