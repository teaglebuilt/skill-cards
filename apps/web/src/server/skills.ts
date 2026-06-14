import { createServerFn } from "@tanstack/react-start";
import { resolve } from "node:path";
import {
  loadSkillCardFromPath,
  type LoadedSkill,
  GrantsCache,
  needsConsent,
  validateGrants,
  RequestStateSealer,
} from "@skill-cards/loader/lib";
import type { Permissions } from "@skill-cards/skill-manifest";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export interface SerializableToolResult {
  content: Array<{ type: "text"; text: string }>;
  _meta?: JsonObject;
  resultType?: "input_required";
  inputRequests?: Record<string, JsonObject>;
  requestState?: string;
}

// Skills to load at server start. Configure via SKILL_PATHS env if set.
const SKILL_PATHS = process.env.SKILL_PATHS?.split(",").filter(Boolean) ?? [
  resolve(process.cwd(), "../../skills/cron-analyzer"),
  resolve(process.cwd(), "../../skills/sbom-auditor"),
];

let skillsPromise: Promise<LoadedSkill[]> | null = null;
function getSkills(): Promise<LoadedSkill[]> {
  if (!skillsPromise) {
    skillsPromise = Promise.all(SKILL_PATHS.map(loadSkillCardFromPath));
  }
  return skillsPromise;
}

const grantsCache = new GrantsCache();
const stateSealer = new RequestStateSealer();

export interface ToolSummary {
  name: string;
  description: string;
  inputSchema: JsonObject;
  parameterOrder?: string[];
  hasConsentUi: boolean;
}

export interface SkillSummary {
  name: string;
  version: string;
  permissions: Permissions;
  tools: ToolSummary[];
}

export const listSkills = createServerFn({ method: "GET" }).handler(
  async (): Promise<SkillSummary[]> => {
    const skills = await getSkills();
    return skills.map((s) => ({
      name: s.manifest.name,
      version: s.manifest.version,
      permissions: s.manifest.permissions,
      tools: s.manifest.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: s.inputSchemaFor(t.name) as JsonObject,
        parameterOrder: t.parameterOrder,
        hasConsentUi: !!t._meta.consentUi,
      })),
    }));
  },
);

export const readResource = createServerFn({ method: "GET" })
  .validator((d: { uri: string }) => d)
  .handler(async ({ data }) => {
    const skills = await getSkills();
    for (const s of skills) {
      const r = s.readResource(data.uri);
      if (r) return r;
    }
    return null;
  });

export interface CallToolInput {
  skill: string;
  tool: string;
  args: Record<string, unknown>;
  requestState?: string;
  inputResponses?: Record<string, unknown>;
}

export const callTool = createServerFn({ method: "POST" })
  .validator((d: CallToolInput) => d)
  .handler(async ({ data }): Promise<SerializableToolResult> => {
    if (data.requestState && data.inputResponses) {
      return await resume(data.requestState, data.inputResponses);
    }
    return await freshCall(data.skill, data.tool, data.args);
  });

async function freshCall(
  skillName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<SerializableToolResult> {
  const skills = await getSkills();
  const skill = skills.find((s) => s.manifest.name === skillName);
  if (!skill) throw new Error(`Unknown skill: ${skillName}`);

  const { tool, requested } = skill.prepareCall(toolName, args);

  if (!needsConsent(requested)) {
    return toSerializable(await skill.runWithGrants(toolName, args, requested));
  }

  const scopeKey = GrantsCache.scopeKey(skillName, toolName, requested);
  const cached = grantsCache.get(scopeKey);
  if (cached) {
    return toSerializable(await skill.runWithGrants(toolName, args, cached));
  }

  const consentUi = tool._meta.consentUi;
  if (!consentUi) {
    throw new Error(
      `Tool ${skillName}.${toolName} requires consent but no consentUi declared`,
    );
  }

  const requestState = stateSealer.seal({
    skill: skillName,
    tool: toolName,
    args,
    requested,
  });

  return {
    resultType: "input_required",
    inputRequests: {
      grants: {
        type: "elicitation",
        message: `Grant permissions for ${skillName}.${toolName}`,
        schema: {
          type: "object",
          properties: {
            fs: { type: "array", items: { type: "object" } },
            net: { type: "array", items: { type: "object" } },
            env: { type: "array", items: { type: "object" } },
            rememberChoice: { type: "boolean", default: false },
          },
        },
        _meta: {
          ui: { resourceUri: consentUi.resourceUri },
          requested: requested as unknown as JsonObject,
        },
      },
    },
    requestState,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          status: "input_required",
          skill: skillName,
          tool: toolName,
          requested,
        }),
      },
    ],
    _meta: { ui: { resourceUri: consentUi.resourceUri } },
  };
}

async function resume(
  requestState: string,
  inputResponses: Record<string, unknown>,
): Promise<SerializableToolResult> {
  const sealed = stateSealer.open(requestState);

  const skills = await getSkills();
  const skill = skills.find((s) => s.manifest.name === sealed.skill);
  if (!skill) throw new Error(`Unknown skill: ${sealed.skill}`);

  const grantsResponse = inputResponses.grants as
    | (Permissions & { rememberChoice?: boolean })
    | undefined;
  if (!grantsResponse || typeof grantsResponse !== "object") {
    throw new Error("Resume requires inputResponses.grants");
  }
  const granted: Permissions = {
    fs: grantsResponse.fs ?? [],
    net: grantsResponse.net ?? [],
    env: grantsResponse.env ?? [],
  };
  const rememberChoice = Boolean(grantsResponse.rememberChoice);

  const validated = validateGrants(sealed.requested, granted);

  if (rememberChoice) {
    const scopeKey = GrantsCache.scopeKey(
      sealed.skill,
      sealed.tool,
      sealed.requested,
    );
    grantsCache.set(scopeKey, validated);
  }

  return toSerializable(
    await skill.runWithGrants(sealed.tool, sealed.args, validated),
  );
}

function toSerializable(result: {
  content: Array<{ type: "text"; text: string }>;
  _meta?: Record<string, unknown>;
}): SerializableToolResult {
  return {
    content: result.content,
    _meta: result._meta ? (result._meta as JsonObject) : undefined,
  };
}
