import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Permissions } from "@skill-cards/skill-manifest";
import {
  loadSkillCardFromPath,
  type LoadedSkill,
} from "./skill-loader.js";
import { GrantsCache } from "./grants-cache.js";
import { needsConsent, validateGrants } from "./consent.js";
import { RequestStateSealer } from "./request-state.js";
import {
  readMrtrMeta,
  type CallToolHandlerResult,
  type InputRequiredResult,
} from "./mcp-mrtr-types.js";

const skillPaths = process.argv.slice(2);
if (skillPaths.length === 0) {
  console.error("Usage: skill-card-loader <skill-bundle-dir> [<another> ...]");
  process.exit(1);
}

const skills: LoadedSkill[] = await Promise.all(
  skillPaths.map(loadSkillCardFromPath),
);
const grantsCache = new GrantsCache();
const stateSealer = new RequestStateSealer();

const server = new Server(
  { name: "skill-card-loader", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: skills.flatMap((s) =>
    s.manifest.tools.map((t) => ({
      name: `${s.manifest.name}.${t.name}`,
      description: t.description,
      inputSchema: s.inputSchemaFor(t.name),
      _meta: t._meta,
    })),
  ),
}));

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: skills.flatMap((s) =>
    s.manifest.resources.map((r) => ({
      uri: r.uri,
      mimeType: r.mimeType,
      name: r.file,
    })),
  ),
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  for (const s of skills) {
    const r = s.readResource(req.params.uri);
    if (r) {
      return {
        contents: [{ uri: req.params.uri, mimeType: r.mimeType, text: r.text }],
      };
    }
  }
  throw new Error(`Unknown resource: ${req.params.uri}`);
});

server.setRequestHandler(
  CallToolRequestSchema,
  async (req): Promise<CallToolHandlerResult> => {
    const name = req.params.name;
    const args = req.params.arguments ?? {};

    const mrtr = readMrtrMeta(req.params);
    if (mrtr) {
      return await resumeFromRequestState(mrtr.requestState, mrtr.inputResponses);
    }

    const [skillName, toolName] = name.split(".", 2);
    if (!skillName || !toolName) {
      throw new Error(`Bad tool name: ${name}`);
    }
    const skill = findSkill(skillName);
    const { tool, requested } = skill.prepareCall(toolName, args);

    if (!needsConsent(requested)) {
      return await skill.runWithGrants(toolName, args, requested);
    }

    const scopeKey = GrantsCache.scopeKey(skillName, toolName, requested);
    const cached = grantsCache.get(scopeKey);
    if (cached) {
      return await skill.runWithGrants(toolName, args, cached);
    }

    const consentUi = tool._meta.consentUi;
    if (!consentUi) {
      throw new Error(
        `Tool ${name} requires consent but has no consentUi resource in manifest`,
      );
    }

    const requestState = stateSealer.seal({
      skill: skillName,
      tool: toolName,
      args,
      requested,
    });

    const result: InputRequiredResult = {
      resultType: "input_required",
      inputRequests: {
        grants: {
          type: "elicitation",
          message: `Grant permissions for ${skillName}.${toolName}`,
          schema: grantsElicitationSchema(),
          _meta: { ui: consentUi, requested },
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
      _meta: { ui: consentUi },
    };
    return result;
  },
);

async function resumeFromRequestState(
  requestState: string,
  inputResponses: Record<string, unknown>,
): Promise<CallToolHandlerResult> {
  const sealed = stateSealer.open(requestState);
  const skill = findSkill(sealed.skill);

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

  return await skill.runWithGrants(sealed.tool, sealed.args, validated);
}

function findSkill(skillName: string): LoadedSkill {
  const skill = skills.find((s) => s.manifest.name === skillName);
  if (!skill) throw new Error(`Unknown skill: ${skillName}`);
  return skill;
}

function grantsElicitationSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["grants"],
    properties: {
      grants: {
        type: "object",
        properties: {
          fs: { type: "array", items: { type: "object" } },
          net: { type: "array", items: { type: "object" } },
          env: { type: "array", items: { type: "object" } },
        },
      },
      rememberChoice: { type: "boolean", default: false },
    },
  };
}

await server.connect(new StdioServerTransport());
