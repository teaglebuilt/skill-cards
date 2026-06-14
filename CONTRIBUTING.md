

## Prerequisites

- Node ≥ 20
- pnpm 9
- Rust + `cargo-component` (`cargo install cargo-component`)
- `wasm32-wasip2` target (`rustup target add wasm32-wasip2`)
- `oras` CLI (only for `pnpm push`)

## Quickstart

```bash
pnpm install
pnpm run dev
```

## Testing Skills

### Run the loader against local skills (skips OCI for fast iteration)

```bash
pnpm --filter @skill-cards/loader start \
  ./skills/cron-analyzer \
  ./skills/sbom-auditor
```

To wire into an MCP client, point its stdio config at the loader binary with
your skill paths as args.


## Layout

```
apps/
  loader/                MCP server: pulls skill cards, registers tools, runs Wasm via jco
packages/
  skill-manifest/        Shared types + zod validator for skill.json
skills/
  cron-analyzer/         No-permissions skill: cron parse + upcoming runs
  sbom-auditor/          fs:read skill: parse package-lock.json + match vulns
```
