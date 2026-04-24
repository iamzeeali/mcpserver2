export type TodoTask = {
  id: string;
  title: string;
  completed: boolean;
};

export type TodoStats = {
  total: number;
  completed: number;
  pending: number;
};

type ToolCallResult = {
  structuredContent?: { tasks?: TodoTask[] };
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string; code?: number; data?: unknown };
};

let rpcId = 0;
const pendingRequests = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
>();

const rpcNotify = (method: string, params: unknown) => {
  window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
};

const rpcRequest = (method: string, params: unknown) =>
  new Promise<unknown>((resolve, reject) => {
    const id = ++rpcId;
    pendingRequests.set(id, { resolve, reject });
    window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
  });

const toolResultListeners = new Set<(result: ToolCallResult) => void>();

export function subscribeToolResults(
  handler: (result: ToolCallResult) => void
): () => void {
  toolResultListeners.add(handler);
  return () => toolResultListeners.delete(handler);
}

function initMessageListener() {
  window.addEventListener(
    "message",
    (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const message = event.data as JsonRpcRequest;
      if (!message || message.jsonrpc !== "2.0") return;

      if (typeof message.id === "number") {
        const pending = pendingRequests.get(message.id);
        if (!pending) return;
        pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(message.error);
          return;
        }

        pending.resolve(message.result);
        return;
      }

      if (typeof message.method !== "string") return;
      if (message.method === "ui/notifications/tool-result") {
        const params = message.params as ToolCallResult | undefined;
        if (params) {
          for (const listener of toolResultListeners) {
            listener(params);
          }
        }
      }
    },
    { passive: true }
  );
}

let bridgeReady: Promise<void> | null = null;

export function initBridge(): Promise<void> {
  if (bridgeReady) return bridgeReady;

  initMessageListener();

  bridgeReady = (async () => {
    const appInfo = { name: "todo-widget", version: "0.1.0" };
    const appCapabilities = {};
    const protocolVersion = "2026-01-26";

    await rpcRequest("ui/initialize", {
      appInfo,
      appCapabilities,
      protocolVersion,
    });
    rpcNotify("ui/notifications/initialized", {});
  })().catch((error) => {
    bridgeReady = null;
    console.error("Failed to initialize the MCP Apps bridge:", error);
    throw error;
  });

  return bridgeReady;
}

export async function callTool(
  name: string,
  arguments_: Record<string, unknown>
): Promise<ToolCallResult> {
  await initBridge();
  const response = (await rpcRequest("tools/call", {
    name,
    arguments: arguments_,
  })) as ToolCallResult;
  return response;
}
