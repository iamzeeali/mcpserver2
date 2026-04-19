# ChatGPT Todo MCP demo (Apps SDK + React)

A minimal **todo** app for **ChatGPT**: an MCP server exposes tools and an interactive HTML UI, built with **React + Vite** and embedded as a single-file bundle. Includes a small **dev OAuth** layer so ChatGPT’s connector wizard can complete discovery.

Official reference: [Apps SDK Quickstart](https://developers.openai.com/apps-sdk/quickstart).

## Quick start

```bash
npm install
npm start          # builds widget (prestart) then runs server on port 8787 by default
```

- MCP endpoint: `http://localhost:8787/mcp`
- For ChatGPT: expose with **HTTPS** (e.g. ngrok) and create a connector pointing at `https://<your-host>/mcp`.
- If discovery URLs show the wrong scheme/host behind a tunnel, set:

  `export PUBLIC_BASE_URL=https://your-ngrok-host.example`

## Project layout

| Path | Role |
|------|------|
| `server.js` | HTTP router: OAuth discovery + CORS + MCP `StreamableHTTPServerTransport` on `/mcp` |
| `oauth-dev.js` | Dev-only OAuth 2.1 discovery + DCR/PKCE (replace with a real IdP for production) |
| `widget/` | Vite + React source for the in-chat UI |
| `dist/todo-widget.html` | Built single-file HTML (gitignored); loaded by `server.js` at startup |

---

## Architecture and concepts

### One-sentence model

**ChatGPT** acts as the MCP client. It speaks **MCP over HTTPS** to your **Node server** at `/mcp`. The server registers **tools** (what the model can call) and a **resource** (HTML for the widget). The widget runs in an **iframe** and talks to ChatGPT through a **JSON-RPC bridge** over `postMessage`. **OAuth** metadata on the same origin lets ChatGPT attach the connector; it is separate from MCP tool execution but required for onboarding.

### Model Context Protocol (MCP)

MCP is a standard way for a host (ChatGPT) to discover and invoke **tools** and read **resources** on a server. This repo uses `@modelcontextprotocol/sdk`: an `McpServer` instance registers capabilities and is connected to a **transport** that maps MCP messages to HTTP (`StreamableHTTPServerTransport`).

### Base MCP vs Apps SDK helpers

- **`@modelcontextprotocol/sdk`**: core `McpServer`, schemas, transport.
- **`@modelcontextprotocol/ext-apps`**: `registerAppTool` and `registerAppResource` normalize **UI metadata** (which HTML resource to show for a tool) and set the Apps HTML MIME type (`RESOURCE_MIME_TYPE`).

The widget is registered as a resource at a logical URI (e.g. `ui://widget/todo.html`). That URI does not need to be a public web URL; the host resolves it via MCP `resources/read`. Each tool’s `_meta.ui.resourceUri` points at the same URI so ChatGPT knows which UI surface belongs to which tool.

### HTTP front door (`server.js`)

One Node `http.Server` handles several surfaces:

1. **OAuth / discovery** (`oauth-dev.js`) — well-known URLs and token endpoints ChatGPT expects.
2. **CORS** `OPTIONS` for `/mcp`.
3. **Health** `GET /`.
4. **MCP** `POST` / `GET` / `DELETE` on `/mcp` via the streamable HTTP transport.
5. **404** for unknown paths.

So you have **one process**, **multiple logical HTTP APIs** (OAuth HTTP + MCP HTTP).

### Streamable HTTP and server lifetime

The transport is created per incoming MCP request, with `sessionIdGenerator: undefined` (stateless mode for this demo). A new `McpServer` is constructed per request and torn down when the response closes.

**Important:** in-memory todo state (`todos` in `server.js`) lives at **module scope**, not inside the `McpServer` instance. So state persists for the lifetime of the Node process even though each request gets a new MCP server object.

### Tools and the UI contract

Tools (`add_todo`, `complete_todo`) declare **input schemas** (Zod) so the host validates arguments.

Tool results include:

- **`content`**: usual MCP content (e.g. text) for the model/conversation.
- **`structuredContent`**: JSON consumed by the widget—here `{ tasks: [...] }`.

Using the same `structuredContent` shape for every mutation keeps the **React UI** in sync whether the call was triggered by the **user in the widget** or by the **model** in chat.

### OAuth (`oauth-dev.js`)

ChatGPT’s connector flow fetches **OAuth protected resource metadata** and **authorization server metadata** (see [Apps SDK auth](https://developers.openai.com/apps-sdk/build/auth/)). Without those routes, setup can fail with “Error fetching OAuth configuration.”

This repo ships a **development-only** authorization server (discovery, dynamic client registration, authorize redirect, PKCE token exchange) scoped to ChatGPT redirect URLs. **Do not use it as-is for production**—swap in Auth0, Stytch, Cognito, or similar, and verify tokens on MCP requests.

`PUBLIC_BASE_URL` forces the public `https://` origin in metadata when proxies/ngrok do not set `Host` / `X-Forwarded-Proto` the way you need.

### Widget bridge (`widget/src/bridge.ts`)

The built HTML runs **inside ChatGPT’s iframe**. It does not call your `/mcp` URL like a normal SPA; it uses the **MCP Apps UI bridge**:

1. **`ui/initialize`** then **`ui/notifications/initialized`** — handshake with the host.
2. **`tools/call`** — ask the host to run a named MCP tool with arguments (same tools the model uses).
3. **`ui/notifications/tool-result`** — when the **model** runs a tool, the host can push the result so the UI updates without a direct return path from `tools/call`.

So there are **two update paths**: RPC responses for UI-initiated calls, and notifications for model-initiated calls.

### Why single-file HTML (Vite + `vite-plugin-singlefile`)

ChatGPT receives the widget as **embedded HTML** from the MCP resource read, not as “your site + separate JS chunks.” Relative chunk URLs would break in that embedding model. The build produces **one** `dist/todo-widget.html` with inlined JS/CSS; `server.js` reads it at startup into `todoHtml`.

React is a **developer ergonomics** layer; the **deployable artifact** is static HTML.

### End-to-end flows

**User in ChatGPT:** message → model selects a tool → ChatGPT POSTs to your `/mcp` → tool runs → returns `structuredContent.tasks` → host shows/updates the widget.

**User in the widget:** React → `tools/call` via `postMessage` → host forwards to MCP → same handlers → RPC result updates state.

**Connector setup:** ChatGPT hits `/.well-known/...` on your origin → OAuth linking if required → subsequent MCP calls to `/mcp` may include `Authorization: Bearer ...` (enforcing that on every tool is a production step).

### Natural next steps

| Area | Direction |
|------|-----------|
| State | Persist todos in a database; scope by authenticated user id from the access token. |
| Auth | Replace `oauth-dev.js` with a real IdP; validate issuer, audience, scopes on each MCP request. |
| MCP session | Stateful sessions if you need different streaming or lifecycle semantics. |
| Tools | Richer descriptions/schemas, optional `outputSchema`, clearer names for model routing. |
| Widget | Same bridge; improve UX, errors, and loading states. |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build `dist/todo-widget.html` from `widget/` |
| `npm start` | `npm run build` then `node server.js` |
| `npm run build:widget` | Vite build only |

Default port: **8787** (`PORT` env overrides).
