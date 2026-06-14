// Local shim for MCP SEP-2322 (Multi Round-Trip Requests).
// Remove once @modelcontextprotocol/sdk exposes these on CallToolResult /
// CallToolRequest.params.

import type { ToolResult } from "./skill-loader.js";

export const MRTR_META_KEY = "dev.skill-cards/mrtr" as const;

export interface ElicitationRequest {
  type: "elicitation";
  schema: Record<string, unknown>;
  message?: string;
  _meta?: Record<string, unknown>;
}

export type InputRequest = ElicitationRequest;

export interface InputRequiredResult {
  resultType: "input_required";
  inputRequests: Record<string, InputRequest>;
  requestState: string;
  content: Array<{ type: "text"; text: string }>;
  _meta?: Record<string, unknown>;
}

export type CallToolHandlerResult = ToolResult | InputRequiredResult;

export interface MrtrParamsMeta {
  inputResponses: Record<string, unknown>;
  requestState: string;
}

export function readMrtrMeta(
  params: { _meta?: Record<string, unknown> } | undefined,
): MrtrParamsMeta | null {
  const raw = params?._meta?.[MRTR_META_KEY];
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<MrtrParamsMeta>;
  if (
    typeof m.requestState !== "string" ||
    !m.inputResponses ||
    typeof m.inputResponses !== "object"
  ) {
    return null;
  }
  return { requestState: m.requestState, inputResponses: m.inputResponses };
}
