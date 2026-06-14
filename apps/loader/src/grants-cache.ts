import { createHash } from "node:crypto";
import type { Permissions } from "@skill-cards/skill-manifest";

export class GrantsCache {
  private store = new Map<string, Permissions>();

  static scopeKey(
    skillName: string,
    toolName: string,
    requested: Permissions,
  ): string {
    const canonical = JSON.stringify({
      skill: skillName,
      tool: toolName,
      fs: [...requested.fs]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((p) => ({ path: p.path, access: [...p.access].sort() })),
      net: [...requested.net]
        .sort((a, b) => a.host.localeCompare(b.host))
        .map((p) => ({ host: p.host, ports: [...p.ports].sort() })),
      env: [...requested.env]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ name: p.name })),
    });
    return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  }

  get(scopeKey: string): Permissions | null {
    return this.store.get(scopeKey) ?? null;
  }

  set(scopeKey: string, grants: Permissions): void {
    this.store.set(scopeKey, grants);
  }

  clear(): void {
    this.store.clear();
  }
}
