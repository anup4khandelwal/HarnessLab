import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  component: Home
});

interface ModuleSummary {
  description: string;
  failureMode: string;
  slug: string;
  title: string;
}

interface TraceSummary {
  events: Array<{ step: number; type: string }>;
  status: string;
  summary?: string;
  traceId: string;
}

const API_BASE = import.meta.env.VITE_HARNESSLAB_API_URL ?? "http://localhost:3001";

function Home() {
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [traces, setTraces] = useState<TraceSummary[]>([]);

  useEffect(() => {
    const load = async () => {
      const [modulesResponse, tracesResponse] = await Promise.all([
        fetch(`${API_BASE}/modules`),
        fetch(`${API_BASE}/traces`)
      ]);

      setModules(await modulesResponse.json());
      setTraces(await tracesResponse.json());
    };

    void load();
  }, []);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Agent = Model + Harness</p>
        <h1>HarnessLab</h1>
        <p className="lede">
          Learn harness engineering by stepping through broken agents, loop fixes, tool contracts,
          guardrails, hybrid memory, tracing, and evaluation.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <div className="panel-header">
            <span>Learning Modules</span>
            <strong>{modules.length}</strong>
          </div>
          <ul className="module-list">
            {modules.map((module) => (
              <li key={module.slug}>
                <h2>{module.title}</h2>
                <p>{module.description}</p>
                <small>{module.failureMode}</small>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <div className="panel-header">
            <span>Recent Traces</span>
            <strong>{traces.length}</strong>
          </div>
          <ul className="trace-list">
            {traces.length === 0 ? (
              <li className="empty">Run `bun run agent` or hit the API to populate traces.</li>
            ) : (
              traces.map((trace) => (
                <li key={trace.traceId}>
                  <div>
                    <h2>{trace.traceId}</h2>
                    <p>{trace.summary ?? "Trace captured"}</p>
                  </div>
                  <span>{trace.status}</span>
                </li>
              ))
            )}
          </ul>
        </article>
      </section>
    </main>
  );
}

