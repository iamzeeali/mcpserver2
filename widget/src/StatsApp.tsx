import { useEffect, useState } from "react";
import { callTool, initBridge, subscribeToolResults, type TodoStats } from "./bridge";

function extractStats(response: unknown): TodoStats | null {
  if (
    response &&
    typeof response === "object" &&
    "structuredContent" in response
  ) {
    const sc = (response as { structuredContent?: { stats?: TodoStats } })
      .structuredContent;
    if (sc?.stats) return sc.stats;
  }
  return null;
}

export function StatsApp() {
  const [stats, setStats] = useState<TodoStats>({
    total: 0,
    completed: 0,
    pending: 0,
  });
  const [loading, setLoading] = useState(true);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  useEffect(() => {
    // Initialize once, then fetch fresh stats for first paint.
    initBridge()
      .then(async () => {
        const response = await callTool("get_todo_stats", {});
        const next = extractStats(response);
        if (next) setStats(next);
      })
      .catch((error) => {
        console.error("Failed to initialize stats widget:", error);
        setBridgeError("Could not connect to ChatGPT host bridge.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Refresh when model-triggered tool results arrive in this chat.
    return subscribeToolResults((payload) => {
      const next = extractStats(payload);
      if (next) setStats(next);
    });
  }, []);

  return (
    <main className="shell">
      <header className="header">
        <p className="eyebrow">ChatGPT Apps SDK</p>
        <h1 className="title">Todo stats</h1>
        <p className="subtitle">Snapshot of your current todo list.</p>
      </header>

      {bridgeError ? (
        <p className="banner banner--error" role="alert">
          {bridgeError}
        </p>
      ) : null}

      {loading ? (
        <p className="subtitle">Loading stats...</p>
      ) : (
        <section className="stats-grid" aria-label="Todo statistics">
          <article className="stat-card">
            <p className="stat-label">Total</p>
            <p className="stat-value">{stats.total}</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">Completed</p>
            <p className="stat-value">{stats.completed}</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">Pending</p>
            <p className="stat-value">{stats.pending}</p>
          </article>
        </section>
      )}
    </main>
  );
}
