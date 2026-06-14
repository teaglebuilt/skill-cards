# Skill Cards

A demo of portable, sandboxed tools for AI agents — built by composing two orthogonal extensions of the Model Context Protocol.

This repo is the working argument behind a thesis about the new design space MCP's extension framework enables. Two example skills, a sandboxed Wasm runtime, a stateless MCP server, and a TanStack Start web app that proves the host side works outside the existing major MCP clients.

## What

A **skill card** is a single OCI artifact bundling four things: a WebAssembly Component (the logic), a WIT interface (the typed contract), one or more UI resources (HTML surfaces the user interacts with), and a permission manifest (capabilities the component needs, with rationales). Author once, push to a registry, and any host that implements MCP Apps and a Wasm runtime can pull it down, execute it sandboxed, and render its UI inline in the conversation. Closer to a browser tab than installing a cli.

## How

The architecture is three layers stacked on the MCP base protocol, each owning a distinct concern.

**Distribution** uses OCI registries. Each skill card is a content-addressable artifact in `application/wasm` + `application/json` + `text/html` parts, pushed by `oras` and pulled by Wassette or the loader's local file reader. The OCI manifest hash is the version identity — a skill upgrade is just a new tag pointing at a new manifest. Authoritative content, no separate package metadata.

**Execution** uses WebAssembly Components running in Wasmtime. Each call to a skill's tool builds a fresh `WASIShim` configured from the consented permissions for that specific invocation. The component sees a sandbox containing only what the user agreed to expose: a single preopened directory, a specific outbound host, no environment variables it wasn't granted. Tool functions are declared in WIT and exposed as MCP tools with auto-derived JSON schemas. The execution surface is provided by `@bytecodealliance/jco` in this demo and would swap to Microsoft's Wassette in production without code changes — same WASIShim contract.

**Presentation** uses MCP's UI resource mechanism. When a tool returns a result, it can declare `_meta.ui.resourceUri` pointing at a UI resource declared in the same manifest. The host fetches the resource, renders it in a sandboxed iframe attached to the result, and brokers `postMessage` communication between the iframe and the host. UI-initiated actions flow back through the same MCP protocol as direct tool calls — same audit, same consent path.

## Why

**Sandboxing is per-call, not per-tool.** A skill card's manifest declares `fs:read` with a `{argument:path}` template; the `WASIShim` built for an invocation grants access only to the specific path the agent passed. Granting "always allow" once doesn't expose the entire home directory on future calls — it caches the *resolved* permissions for that specific scope. Calling the SBOM auditor on `~/proj/foo/package-lock.json` doesn't authorize calling it on `~/proj/bar/package-lock.json`. This is what makes the policy comprehensible to humans: you're never granting an abstract capability, you're granting specific access to a specific thing for a specific stated reason.

## Further Documentation

1. [CONTRIBUTING.md](./CONTRIBUTING.md)
2. [Architecture](./docs/architecture.md)