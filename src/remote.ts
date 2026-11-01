/**
 * codehost-remote core: forward the 14-tool GitHub core subset to
 * GitHub's hosted remote MCP endpoint at https://api.githubcopilot.com/mcp/
 * (override with GITHUB_REMOTE_MCP_URL).
 *
 * Each local call becomes one JSON-RPC 2.0 `tools/call` POST with
 * `Authorization: Bearer <GITHUB_PERSONAL_ACCESS_TOKEN>`. The hosted
 * endpoint may answer with plain JSON or a text/event-stream (SSE)
 * body whose `data:` lines carry JSON-RPC payloads; both are parsed.
 * A missing token is an error naming GITHUB_PERSONAL_ACCESS_TOKEN.
 * All HTTP goes through an injected FetchFn for offline testing.
 */
import type { FetchFn } from "./types.js";

export const VERSION = "0.1.0";
export const REMOTE_ENDPOINT = "https://api.githubcopilot.com/mcp/";

export const TOOL_NAMES = [
  "create_repository", "fork_repository", "create_branch", "get_file_contents",
  "create_or_update_file", "push_files", "search_repositories", "search_code",
  "list_issues", "get_issue", "create_issue", "add_issue_comment",
  "list_pull_requests", "create_pull_request",
];

export function tokenFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.GITHUB_PERSONAL_ACCESS_TOKEN;
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!token) {
    throw new Error(
      "GITHUB_PERSONAL_ACCESS_TOKEN environment variable is required",
    );
  }
  return token;
}

export function endpointFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.GITHUB_REMOTE_MCP_URL;
  const url = typeof raw === "string" ? raw.trim() : "";
  return url || REMOTE_ENDPOINT;
}

export function extractJsonPayloads(body: string): unknown[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  const dataLines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line.length > 0 && line !== "[DONE]");
  const candidates = dataLines.length > 0 ? dataLines : [trimmed];
  const payloads: unknown[] = [];
  for (const candidate of candidates) {
    try {
      payloads.push(JSON.parse(candidate));
    } catch {
      // Non-JSON stream noise is ignored.
    }
  }
  return payloads;
}

export function resultTextFromPayload(payload: unknown): string {
  if (payload === null || typeof payload !== "object") {
    throw new Error("GitHub remote returned an unexpected response shape");
  }
  const obj = payload as Record<string, unknown>;
  if (obj.error !== undefined && obj.error !== null) {
    const err = obj.error as Record<string, unknown>;
    const message =
      typeof err.message === "string" ? err.message : JSON.stringify(obj.error);
    throw new Error(`GitHub remote error: ${message}`);
  }
  const result = obj.result;
  if (typeof result === "string") return result;
  if (result !== null && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r.content)) {
      const texts = r.content
        .filter(
          (part): part is Record<string, unknown> =>
            part !== null && typeof part === "object",
        )
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text as string);
      if (texts.length > 0) return texts.join("\n");
      if (r.content.length === 0) {
        throw new Error("GitHub remote returned an empty content list");
      }
    }
    if (r.isError === true) {
      throw new Error("GitHub remote returned an error result with no text");
    }
    return JSON.stringify(result, null, 2);
  }
  throw new Error("GitHub remote returned a response with no readable result");
}

export function parseToolResponse(body: string): string {
  const payloads = extractJsonPayloads(body);
  if (payloads.length === 0) {
    throw new Error("GitHub remote returned an empty or non-JSON response");
  }
  for (let i = payloads.length - 1; i >= 0; i--) {
    const payload = payloads[i] as Record<string, unknown>;
    if (payload && (payload.result !== undefined || payload.error !== undefined)) {
      return resultTextFromPayload(payload);
    }
  }
  return resultTextFromPayload(payloads[payloads.length - 1]);
}

let nextRequestId = 1;

export async function callRemoteTool(
  fetchFn: FetchFn,
  token: string,
  endpoint: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!token || !token.trim()) {
    throw new Error(
      "GITHUB_PERSONAL_ACCESS_TOKEN environment variable is required",
    );
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`,
  };
  const requestBody = JSON.stringify({
    jsonrpc: "2.0",
    id: nextRequestId++,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });
  let response;
  try {
    response = await fetchFn(endpoint, { method: "POST", headers, body: requestBody });
  } catch (err) {
    throw new Error(
      `Failed to reach GitHub remote at ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const body = await response.text();
  if (!response.ok) {
    const detail = body.trim().slice(0, 200);
    throw new Error(
      `GitHub remote request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail ? `: ${detail}` : ""}`,
    );
  }
  return parseToolResponse(body);
}

export async function callToolRemote(
  fetchFn: FetchFn,
  token: string,
  endpoint: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!TOOL_NAMES.includes(name)) throw new Error(`Unknown tool: ${name}`);
  return callRemoteTool(fetchFn, token, endpoint, name, args);
}
