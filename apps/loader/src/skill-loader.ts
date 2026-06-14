import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpile } from "@bytecodealliance/jco";
import { WASIShim } from "@bytecodealliance/preview2-shim/instantiation";
import {
  parseManifest,
  expandArgumentTemplates,
  type SkillManifest,
  type Permissions,
  type ToolDescriptor,
} from "@skill-cards/skill-manifest";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  _meta?: Record<string, unknown>;
}

export interface LoadedSkill {
  manifest: SkillManifest;
  inputSchemaFor(toolName: string): Record<string, unknown>;
  readResource(uri: string): { mimeType: string; text: string } | null;
  prepareCall(
    toolName: string,
    args: Record<string, unknown>,
  ): { tool: ToolDescriptor; requested: Permissions };
  runWithGrants(
    toolName: string,
    args: Record<string, unknown>,
    grants: Permissions,
  ): Promise<ToolResult>;
}

export async function loadSkillCardFromPath(dir: string): Promise<LoadedSkill> {
  const manifest = parseManifest(
    JSON.parse(await readFile(join(dir, "skill.json"), "utf8")),
  );

  const resources = new Map<string, { mimeType: string; text: string }>();
  for (const r of manifest.resources) {
    resources.set(r.uri, {
      mimeType: r.mimeType,
      text: await readFile(join(dir, r.file), "utf8"),
    });
  }

  const componentBytes = await readFile(join(dir, manifest.component));
  const runtime = await prepareRuntime(componentBytes, manifest.name);

  return {
    manifest,

    inputSchemaFor(toolName) {
      const tool = manifest.tools.find((t) => t.name === toolName);
      return tool?.inputSchema ?? { type: "object", properties: {} };
    },

    readResource(uri) {
      return resources.get(uri) ?? null;
    },

    prepareCall(toolName, args) {
      const tool = manifest.tools.find((t) => t.name === toolName);
      if (!tool) throw new Error(`Unknown tool: ${toolName}`);
      const requested = expandArgumentTemplates(manifest.permissions, args);
      return { tool, requested };
    },

    async runWithGrants(toolName, args, grants) {
      const tool = manifest.tools.find((t) => t.name === toolName);
      if (!tool) throw new Error(`Unknown tool: ${toolName}`);

      const result = await runtime.call(tool, args, grants);

      const meta: Record<string, unknown> = {};
      if (tool._meta.ui) meta.ui = tool._meta.ui;

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        _meta: meta,
      };
    },
  };
}

interface Runtime {
  call(
    tool: ToolDescriptor,
    args: Record<string, unknown>,
    granted: Permissions,
  ): Promise<unknown>;
}

async function prepareRuntime(
  componentBytes: Buffer,
  skillName: string,
): Promise<Runtime> {
  const hash = createHash("sha256")
    .update(componentBytes)
    .digest("hex")
    .slice(0, 16);
  const cacheDir = join(tmpdir(), "skill-cards-cache", `${skillName}-${hash}`);
  const entryPath = join(cacheDir, "component.js");

  if (!existsSync(entryPath)) {
    await mkdir(cacheDir, { recursive: true });
    const { files } = await transpile(componentBytes, {
      name: "component",
      instantiation: "async",
    });
    for (const [filename, bytes] of Object.entries(files)) {
      const parts = filename.split("/");
      if (parts.length > 1) {
        await mkdir(join(cacheDir, ...parts.slice(0, -1)), { recursive: true });
      }
      await writeFile(join(cacheDir, filename), bytes as Uint8Array);
    }
  }

  const mod = await import(pathToFileURL(entryPath).href);

  return {
    async call(tool, args, granted) {
      const shim = buildShim(granted);
      const loader = async (path: string) => {
        const buf = await readFile(join(cacheDir, path));
        return WebAssembly.compile(buf);
      };

      const instance = await mod.instantiate(loader, shim.getImportObject());

      const [, ifaceAndFunc] = tool.export.split("/");
      if (!ifaceAndFunc) throw new Error(`Bad export path: ${tool.export}`);
      const [iface, func] = ifaceAndFunc.split(".");
      if (!iface || !func) throw new Error(`Bad export path: ${tool.export}`);

      const ifaceObj = (instance as Record<string, unknown>)[iface];
      if (!ifaceObj || typeof ifaceObj !== "object") {
        throw new Error(`No interface '${iface}' on component`);
      }
      const fn = (ifaceObj as Record<string, unknown>)[func];
      if (typeof fn !== "function") {
        throw new Error(`No function '${func}' on interface '${iface}'`);
      }

      const ordered = orderArgs(tool, args);
      return await (fn as (...a: unknown[]) => unknown)(...ordered);
    },
  };
}

function orderArgs(
  tool: ToolDescriptor,
  args: Record<string, unknown>,
): unknown[] {
  const order =
    tool.parameterOrder ??
    Object.keys(
      (tool.inputSchema as { properties?: Record<string, unknown> })
        ?.properties ?? {},
    );
  return order.map((k) => args[k]);
}

function buildShim(granted: Permissions): WASIShim {
  const preopens: Record<string, string> = {};
  granted.fs.forEach((p, i) => {
    preopens[`/skill-data/${i}`] = p.path;
  });

  return new WASIShim({
    sandbox: {
      preopens: Object.keys(preopens).length > 0 ? preopens : undefined,
    },
  });
}
