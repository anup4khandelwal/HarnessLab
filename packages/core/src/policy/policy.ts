import { nowIso } from "../common";
import type { JsonObject } from "../common";
import type { ToolCall } from "../tooling/tool-registry";

export interface PolicyContext {
  runId: string;
  step: number;
  workingMemory: JsonObject;
}

export interface PolicyDecision {
  allowed: boolean;
  approval: ApprovalDecision | undefined;
  reason: string;
}

export type ApprovalStatus = "approved" | "denied" | "pending";

export interface ToolPolicy {
  allows(call: ToolCall, context: PolicyContext): Promise<PolicyDecision>;
}

export interface ApprovalRequest {
  call: ToolCall;
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
  effect: "allow" | "approve" | "deny";
  match?: (call: ToolCall, context: PolicyContext) => boolean;
  reason: string;
  tool?: string;
}

export class AllowAllPolicy implements ToolPolicy {
  public async allows(call: ToolCall): Promise<PolicyDecision> {
    return {
      allowed: true,
      approval: undefined,
      reason: `${call.tool} allowed`
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

  public async allows(call: ToolCall, context: PolicyContext): Promise<PolicyDecision> {
    for (const rule of this.rules) {
      const toolMatches = rule.tool === undefined || rule.tool === call.tool;
      const customMatch = rule.match?.(call, context) ?? true;

      if (!toolMatches || !customMatch) {
        continue;
      }

      if (rule.effect === "deny") {
        return {
          allowed: false,
          approval: undefined,
          reason: rule.reason
        };
      }

      if (rule.effect === "allow") {
        return {
          allowed: true,
          approval: undefined,
          reason: rule.reason
        };
      }

      const approval = await this.approvalGate?.request({
        call,
        context,
        requestedAt: nowIso(),
        reason: rule.reason
      });

      return {
        allowed: approval?.status === "approved",
        approval,
        reason:
          approval === undefined
            ? `${rule.reason} (no approval gate configured)`
            : `${rule.reason} (${approval.status})`
      };
    }

    return {
      allowed: true,
      approval: undefined,
      reason: `${call.tool} allowed by default`
    };
  }
}
