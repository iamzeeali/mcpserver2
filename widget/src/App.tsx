import { useCallback, useEffect, useState } from "react";
import {
  callTool,
  initBridge,
  subscribeToolResults,
  type TodoTask,
} from "./bridge";

function extractTasks(response: unknown): TodoTask[] | null {
  if (
    response &&
    typeof response === "object" &&
    "structuredContent" in response
  ) {
    const sc = (response as { structuredContent?: { tasks?: TodoTask[] } })
      .structuredContent;
    if (sc?.tasks) return sc.tasks;
  }
  return null;
}

export function App() {
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [title, setTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  useEffect(() => {
    initBridge().catch(() => {
      setBridgeError("Could not connect to ChatGPT host bridge.");
    });
  }, []);

  useEffect(() => {
    return subscribeToolResults((payload) => {
      const next = extractTasks(payload);
      if (next) setTasks(next);
    });
  }, []);

  const setBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || isAdding) return;

    setIsAdding(true);
    try {
      const response = await callTool("add_todo", { title: trimmed });
      const next = extractTasks(response);
      if (next) setTasks(next);
      setTitle("");
    } catch (err) {
      console.error("Failed to add todo:", err);
    } finally {
      setIsAdding(false);
    }
  };

  const onToggleComplete = async (task: TodoTask, checked: boolean) => {
    if (!checked) return;
    if (busyIds.has(task.id) || task.completed) return;

    setBusy(task.id, true);
    const previous = tasks;
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, completed: true } : t))
    );
    try {
      const response = await callTool("complete_todo", { id: task.id });
      const next = extractTasks(response);
      if (next) setTasks(next);
    } catch (err) {
      console.error("Failed to complete todo:", err);
      setTasks(previous);
    } finally {
      setBusy(task.id, false);
    }
  };

  return (
    <main className="shell">
      <header className="header">
        <p className="eyebrow">ChatGPT Apps SDK</p>
        <h1 className="title">Todos</h1>
        <p className="subtitle">Add tasks and mark them done.</p>
      </header>

      {bridgeError ? (
        <p className="banner banner--error" role="alert">
          {bridgeError}
        </p>
      ) : null}

      <form className="form" onSubmit={onSubmit} autoComplete="off">
        <input
          className="input"
          name="title"
          placeholder="Add a task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Task title"
        />
        <button className="button" type="submit" disabled={isAdding}>
          {isAdding ? "Adding…" : "Add"}
        </button>
      </form>

      {tasks.length === 0 ? (
        <div className="empty" aria-live="polite">
          <p className="empty-title">Nothing here yet</p>
          <p className="empty-copy">Try “Review Apps SDK docs” as a first task.</p>
        </div>
      ) : (
        <ul className="list" aria-label="Tasks">
          {tasks.map((task) => {
            const busy = busyIds.has(task.id);
            return (
              <li
                key={task.id}
                className="row"
                data-completed={task.completed ? "true" : "false"}
                data-busy={busy ? "true" : "false"}
              >
                <label className="row-label">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={task.completed}
                    disabled={busy}
                    onChange={(e) => onToggleComplete(task, e.target.checked)}
                  />
                  <span className="row-title">{task.title}</span>
                </label>
                {busy ? <span className="spinner" aria-hidden /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
