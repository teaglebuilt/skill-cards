import type { Permissions } from "@skill-cards/skill-manifest";

export function needsConsent(requested: Permissions): boolean {
  return (
    requested.fs.length > 0 ||
    requested.net.length > 0 ||
    requested.env.length > 0
  );
}

export function validateGrants(
  requested: Permissions,
  granted: Permissions,
): Permissions {
  for (const fs of granted.fs) {
    const match = requested.fs.find((r) => r.path === fs.path);
    if (!match) {
      throw new Error(`Granted fs path '${fs.path}' was not requested`);
    }
    for (const access of fs.access) {
      if (!match.access.includes(access)) {
        throw new Error(
          `Granted fs access '${access}' on '${fs.path}' was not requested`,
        );
      }
    }
  }
  for (const net of granted.net) {
    const match = requested.net.find((r) => r.host === net.host);
    if (!match) {
      throw new Error(`Granted net host '${net.host}' was not requested`);
    }
    for (const port of net.ports) {
      if (!match.ports.includes(port)) {
        throw new Error(
          `Granted port ${port} on '${net.host}' was not requested`,
        );
      }
    }
  }
  for (const env of granted.env) {
    const match = requested.env.find((r) => r.name === env.name);
    if (!match) {
      throw new Error(`Granted env '${env.name}' was not requested`);
    }
  }
  return granted;
}
