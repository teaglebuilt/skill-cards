import { z } from "zod";

const FsPermission = z.object({
  path: z.string(),
  access: z.array(z.enum(["read", "write"])),
  rationale: z.string(),
});

const NetPermission = z.object({
  host: z.string(),
  ports: z.array(z.number().int().positive()),
  rationale: z.string(),
});

const EnvPermission = z.object({
  name: z.string(),
  rationale: z.string(),
});

const Permissions = z.object({
  fs: z.array(FsPermission).default([]),
  net: z.array(NetPermission).default([]),
  env: z.array(EnvPermission).default([]),
});

const UiResourceRef = z.object({
  resourceUri: z.string().startsWith("ui://"),
});

const ToolDescriptor = z.object({
  export: z.string(),
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.unknown()).optional(),
  parameterOrder: z.array(z.string()).optional(),
  _meta: z
    .object({
      ui: UiResourceRef.optional(),
      consentUi: UiResourceRef.optional(),
    })
    .default({}),
});

const ResourceDescriptor = z.object({
  uri: z.string().startsWith("ui://"),
  file: z.string(),
  mimeType: z.string(),
});

export const SkillManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  component: z.string().default("component.wasm"),
  permissions: Permissions.default({ fs: [], net: [], env: [] }),
  tools: z.array(ToolDescriptor),
  resources: z.array(ResourceDescriptor).default([]),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type ToolDescriptor = z.infer<typeof ToolDescriptor>;
export type Permissions = z.infer<typeof Permissions>;

export function parseManifest(raw: unknown): SkillManifest {
  return SkillManifestSchema.parse(raw);
}

export function expandArgumentTemplates(
  permissions: Permissions,
  args: Record<string, unknown>,
): Permissions {
  const sub = (s: string) =>
    s.replace(/\{argument:([^}]+)\}/g, (_, key) => {
      const v = args[key];
      if (typeof v !== "string") {
        throw new Error(`Cannot bind {argument:${key}} - not a string`);
      }
      return v;
    });
  return {
    fs: permissions.fs.map((p) => ({ ...p, path: sub(p.path) })),
    net: permissions.net.map((p) => ({ ...p, host: sub(p.host) })),
    env: permissions.env,
  };
}
