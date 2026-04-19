/**
 * Minimal OAuth 2.1 discovery + dev authorization server for ChatGPT MCP connectors.
 * ChatGPT fetches /.well-known/oauth-protected-resource* and AS metadata during connector
 * setup; missing routes caused "Error fetching OAuth configuration".
 *
 * Replace with a real IdP for production: https://developers.openai.com/apps-sdk/build/auth/
 */
import { createHash, randomBytes } from "node:crypto";

/** @type {Map<string, { redirect_uris: string[] }>} */
const registeredClients = new Map();

/** @type {Map<string, { codeChallenge: string, codeChallengeMethod: string, redirectUri: string, clientId: string }>} */
const authCodes = new Map();

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export function getPublicBaseUrl(req) {
  const explicit = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const host = req.headers.host ?? `localhost:${process.env.PORT ?? 8787}`;
  const proto = req.headers["x-forwarded-proto"] ?? "http";
  return `${proto}://${host}`;
}

function isAllowedChatGptRedirect(uri) {
  try {
    const u = new URL(uri);
    if (u.protocol !== "https:") return false;
    if (u.hostname !== "chatgpt.com") return false;
    if (u.pathname.startsWith("/connector/oauth")) return true;
    if (u.pathname === "/connector_platform_oauth_redirect") return true;
    return false;
  } catch {
    return false;
  }
}

function s256(verifier) {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

/**
 * @returns {Promise<boolean>} true if this module handled the request
 */
export async function handleOAuthDevRoutes(req, res, url) {
  const base = getPublicBaseUrl(req);
  const mcpResource = `${base}/mcp`;

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "content-type, authorization, mcp-protocol-version, mcp-session-id",
  };

  const p = url.pathname;

  if (req.method === "OPTIONS") {
    if (
      p === "/.well-known/oauth-protected-resource/mcp" ||
      p === "/.well-known/oauth-protected-resource" ||
      p === "/.well-known/oauth-authorization-server" ||
      p.startsWith("/oauth/")
    ) {
      res.writeHead(204, cors);
      res.end();
      return true;
    }
    return false;
  }

  if (req.method === "GET" && p === "/.well-known/oauth-protected-resource/mcp") {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end(
      JSON.stringify({
        resource: mcpResource,
        authorization_servers: [base],
        scopes_supported: ["todo.read", "todo.write"],
        bearer_methods_supported: ["header"],
      })
    );
    return true;
  }

  if (req.method === "GET" && p === "/.well-known/oauth-protected-resource") {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end(
      JSON.stringify({
        resource: mcpResource,
        authorization_servers: [base],
        scopes_supported: ["todo.read", "todo.write"],
        bearer_methods_supported: ["header"],
      })
    );
    return true;
  }

  if (req.method === "GET" && p === "/.well-known/oauth-authorization-server") {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end(
      JSON.stringify({
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/register`,
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["openid", "todo.read", "todo.write"],
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      })
    );
    return true;
  }

  if (req.method === "POST" && p === "/oauth/register") {
    let payload = {};
    try {
      const raw = await readBody(req);
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      res.writeHead(400, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify({ error: "invalid_client_metadata" }));
      return true;
    }
    const client_id = `demo_${randomBytes(12).toString("hex")}`;
    const redirectUris = Array.isArray(payload.redirect_uris)
      ? payload.redirect_uris
      : [];
    registeredClients.set(client_id, { redirect_uris: redirectUris });
    res.writeHead(201, { "content-type": "application/json", ...cors });
    res.end(
      JSON.stringify({
        client_id,
        client_secret: randomBytes(24).toString("base64url"),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: redirectUris,
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      })
    );
    return true;
  }

  if (req.method === "GET" && p === "/oauth/authorize") {
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const clientId = url.searchParams.get("client_id") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const codeChallenge = url.searchParams.get("code_challenge") ?? "";
    const codeChallengeMethod =
      url.searchParams.get("code_challenge_method") ?? "S256";
    const responseType = url.searchParams.get("response_type") ?? "";

    if (responseType !== "code") {
      res.writeHead(400).end("unsupported response_type");
      return true;
    }
    if (!registeredClients.has(clientId)) {
      res.writeHead(400).end("unknown client_id");
      return true;
    }
    if (!isAllowedChatGptRedirect(redirectUri)) {
      res.writeHead(400).end("redirect_uri not allowed for this demo server");
      return true;
    }
    const { redirect_uris: registeredUris } = registeredClients.get(clientId);
    if (registeredUris.length > 0 && !registeredUris.includes(redirectUri)) {
      res.writeHead(400).end("redirect_uri not registered for client");
      return true;
    }
    if (!codeChallenge) {
      res.writeHead(400).end("missing code_challenge");
      return true;
    }

    const code = randomBytes(24).toString("base64url");
    authCodes.set(code, {
      codeChallenge,
      codeChallengeMethod,
      redirectUri,
      clientId,
    });

    const redir = new URL(redirectUri);
    redir.searchParams.set("code", code);
    if (state) redir.searchParams.set("state", state);
    res.writeHead(302, { Location: redir.toString() });
    res.end();
    return true;
  }

  if (req.method === "POST" && p === "/oauth/token") {
    const raw = await readBody(req);
    const params = new URLSearchParams(raw);
    const grantType = params.get("grant_type");
    if (grantType !== "authorization_code") {
      res.writeHead(400, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify({ error: "unsupported_grant_type" }));
      return true;
    }
    const code = params.get("code") ?? "";
    const redirectUri = params.get("redirect_uri") ?? "";
    const clientId = params.get("client_id") ?? "";
    const codeVerifier = params.get("code_verifier") ?? "";

    const rec = authCodes.get(code);
    if (!rec || rec.clientId !== clientId || rec.redirectUri !== redirectUri) {
      res.writeHead(400, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify({ error: "invalid_grant" }));
      return true;
    }
    authCodes.delete(code);

    const method = rec.codeChallengeMethod || "S256";
    if (method !== "S256") {
      res.writeHead(400, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify({ error: "invalid_grant" }));
      return true;
    }
    if (s256(codeVerifier) !== rec.codeChallenge) {
      res.writeHead(400, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify({ error: "invalid_grant" }));
      return true;
    }

    const accessToken = randomBytes(32).toString("base64url");
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end(
      JSON.stringify({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 86400,
        scope: params.get("scope") ?? "todo.read todo.write",
      })
    );
    return true;
  }

  return false;
}
