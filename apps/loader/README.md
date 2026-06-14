# Skill Loader

## What

## How

The loader uses `@bytecodealliance/jco` to transpile the Wasm Component to
JS at first load (cached by content hash under `$TMPDIR/skill-cards-cache/`),
then dynamic-imports the result and calls exports through a `WASIShim`
configured per-invocation from the consented permissions.

When a tool declares `fs:read` with a `{argument:path}` template, the shim
gets a preopen for the resolved path only — the component can't reach
anything else on disk.

## Why
