import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  listSkills,
  callTool,
  readResource,
  type SkillSummary,
  type ToolSummary,
} from "../server/skills";

export const Route = createFileRoute("/")({
  loader: () => listSkills(),
  component: Home,
});

interface SelectedTool {
  skill: string;
  tool: ToolSummary;
}

interface RenderedResult {
  raw: unknown;
  uiUri: string | null;
  uiHtml: string | null;
  requestState: string | null;
}

function Home() {
  const skills = Route.useLoaderData();
  const [selected, setSelected] = useState<SelectedTool | null>(null);
  const [args, setArgs] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<RenderedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Reset form + result when selecting a different tool
  useEffect(() => {
    setArgs({});
    setResult(null);
    setError(null);
  }, [selected]);

  async function loadUi(toolResult: { _meta?: { ui?: { resourceUri?: string } } }) {
    const uri = toolResult._meta?.ui?.resourceUri;
    if (!uri) return null;
    const resource = await readResource({ data: { uri } });
    return resource ? { uri, html: resource.text } : null;
  }

  async function dispatch(payload: {
    tool: string;
    args: Record<string, unknown>;
    requestState?: string;
    inputResponses?: Record<string, unknown>;
  }) {
    if (!selected) return;
    const r = await callTool({
      data: {
        skill: selected.skill,
        tool: payload.tool,
        args: payload.args,
        requestState: payload.requestState,
        inputResponses: payload.inputResponses,
      },
    });
    const ui = await loadUi(r);
    const requestState =
      (r as { requestState?: string }).requestState ?? null;
    setResult({
      raw: r,
      uiUri: ui?.uri ?? null,
      uiHtml: ui?.html ?? null,
      requestState,
    });
  }

  async function runTool() {
    if (!selected) return;
    setError(null);
    try {
      await dispatch({ tool: selected.tool.name, args });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Bridge: iframe postMessage → server function → postMessage back
  useEffect(() => {
    async function onMessage(e: MessageEvent) {
      if (!selected) return;
      try {
        if (e.data?.type === "consent-response") {
          if (!result?.requestState) {
            throw new Error("No pending consent: missing requestState");
          }
          await dispatch({
            tool: selected.tool.name,
            args,
            requestState: result.requestState,
            inputResponses: e.data.inputResponses,
          });
          return;
        }
        if (e.data?.type === "tool-call") {
          await dispatch({
            tool: e.data.tool,
            args: e.data.arguments ?? {},
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [selected, args, result?.requestState]);

  // Push result into iframe when result changes (and iframe is mounted)
  useEffect(() => {
    if (!result || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const post = () =>
      iframe.contentWindow?.postMessage(
        { type: "tool-result", result: result.raw },
        "*",
      );
    if (iframe.contentDocument?.readyState === "complete") {
      post();
    } else {
      iframe.addEventListener("load", post);
      return () => iframe.removeEventListener("load", post);
    }
  }, [result]);

  return (
    <div className="app">
      <header>
        <h1>MCP Skill Cards</h1>
        <p>Live demo of Wasm-backed tools with sandboxed UIs</p>
      </header>
      <div className="layout">
        <Sidebar skills={skills} selected={selected} onSelect={setSelected} />
        <main>
          {selected ? (
            <ToolPanel
              selected={selected}
              args={args}
              onArgsChange={setArgs}
              onRun={runTool}
              result={result}
              error={error}
              iframeRef={iframeRef}
            />
          ) : (
            <p className="placeholder">Pick a tool from the left to begin.</p>
          )}
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  skills,
  selected,
  onSelect,
}: {
  skills: SkillSummary[];
  selected: SelectedTool | null;
  onSelect: (s: SelectedTool) => void;
}) {
  return (
    <aside>
      {skills.map((skill) => (
        <section key={skill.name} className="skill">
          <header>
            <h2>{skill.name}</h2>
            <span className="version">v{skill.version}</span>
          </header>
          <PermissionBadges p={skill.permissions} />
          <ul>
            {skill.tools.map((tool) => {
              const isSelected =
                selected?.skill === skill.name && selected.tool.name === tool.name;
              return (
                <li key={tool.name}>
                  <button
                    className={isSelected ? "selected" : ""}
                    onClick={() => onSelect({ skill: skill.name, tool })}
                  >
                    <span className="tname">{tool.name}</span>
                    <span className="tdesc">{tool.description}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </aside>
  );
}

function PermissionBadges({ p }: { p: SkillSummary["permissions"] }) {
  const items: string[] = [];
  if (p.fs.length) items.push(`fs:${p.fs.length}`);
  if (p.net.length) items.push(`net:${p.net.length}`);
  if (p.env.length) items.push(`env:${p.env.length}`);
  if (items.length === 0) items.push("no caps");
  return (
    <div className="badges">
      {items.map((i) => (
        <span key={i} className="badge">
          {i}
        </span>
      ))}
    </div>
  );
}

function ToolPanel({
  selected,
  args,
  onArgsChange,
  onRun,
  result,
  error,
  iframeRef,
}: {
  selected: SelectedTool;
  args: Record<string, unknown>;
  onArgsChange: (a: Record<string, unknown>) => void;
  onRun: () => void;
  result: RenderedResult | null;
  error: string | null;
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
}) {
  const props = useMemo(() => {
    const schema = selected.tool.inputSchema as {
      properties?: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
    const order =
      selected.tool.parameterOrder ?? Object.keys(schema.properties ?? {});
    return order.map((name) => ({
      name,
      ...(schema.properties?.[name] ?? {}),
      required: schema.required?.includes(name) ?? false,
    }));
  }, [selected]);

  return (
    <div className="panel">
      <h3>
        {selected.skill}.{selected.tool.name}
      </h3>
      <p className="desc">{selected.tool.description}</p>

      <div className="form">
        {props.map((prop) => (
          <label key={prop.name}>
            <span>
              {prop.name}
              {prop.required && <span className="req">*</span>}
            </span>
            <input
              type={prop.type === "integer" ? "number" : "text"}
              value={String(args[prop.name] ?? "")}
              placeholder={prop.description ?? ""}
              onChange={(e) => {
                const v = prop.type === "integer"
                  ? e.target.value === "" ? "" : Number(e.target.value)
                  : e.target.value;
                onArgsChange({ ...args, [prop.name]: v });
              }}
            />
          </label>
        ))}
        <button onClick={onRun} className="primary">
          Run
        </button>
      </div>

      {error && <pre className="error">{error}</pre>}

      {result && (
        <div className="result">
          <details className="raw">
            <summary>Raw tool result</summary>
            <pre>{JSON.stringify(result.raw, null, 2)}</pre>
          </details>
          {result.uiHtml && (
            <iframe
              key={result.uiUri}
              ref={iframeRef}
              srcDoc={result.uiHtml}
              sandbox="allow-scripts"
              className="ui-frame"
              title="Skill UI"
            />
          )}
        </div>
      )}
    </div>
  );
}
