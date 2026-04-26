import type { JsonObject } from "../common";
import type { ToolCall } from "../tooling/tool-registry";

export interface PolicyContext {
  runId: string;
  step: number;
  workingMemory: JsonObject;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
}

export interface ToolPolicy {
  allows(call: ToolCall, context: PolicyContext): Promise<PolicyDecision>;
}

export interface ApprovalRequest {
  call: ToolCall;
  context: PolicyContext;
  reason: string;
}

export interface ApprovalGate {
  request(request: ApprovalRequest): Promise<boolean>;
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
      reason: `${call.tool} allowed`
    };
  }
}

export class StaticApprovalGate implements ApprovalGate {
  private readonly approved: boolean;

  public constructor(approved: boolean) {
    this.approved = approved;
  }

  public async request(): Promise<boolean> {
    return this.approved;
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
          reason: rule.reason
        };
      }

      if (rule.effect === "allow") {
        return {
          allowed: true,
          reason: rule.reason
        };
      }

      const approved = await this.approvalGate?.request({
        call,
        context,
        reason: rule.reason
      });

      return {
        allowed: approved ?? false,
        reason: approved ? `${rule.reason} (approved)` : `${rule.reason} (approval denied)`
      };
    }

    return {
      allowed: true,
      reason: `${call.tool} allowed by default`
    };
  }
}
