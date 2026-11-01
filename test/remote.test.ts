import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  callRemoteTool,
  callToolRemote,
  endpointFromEnv,
  extractJsonPayloads,
  parseToolResponse,
  tokenFromEnv,
} from "../src/remote.js";
import type { FetchFn, HttpResponse } from "../src/types.js";

interface Captured { url?: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }

function resp(body: string, opts: Partial<HttpResponse> = {}): HttpResponse {
  return { ok: true, status: 200, statusText: "OK", headers: { get: () => null }, text: async () => body, ...opts };
}
const jsonResult = (text: string) =>
  JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });
const sseResult = (text: string) =>
  `event: message\ndata: ${jsonResult(text)}\n\n`;
function fake(captured: Captured, body: string): FetchFn {
  return async (url, init) => { captured.url = url; captured.init = init; return resp(body); };
}

describe("tokenFromEnv / endpointFromEnv", () => {
  it("returns the trimmed token and throws naming the variable when missing", () => {
    assert.equal(tokenFromEnv({ GITHUB_PERSONAL_ACCESS_TOKEN: " ghp_x " }), "ghp_x");
    assert.throws(() => tokenFromEnv({}), /GITHUB_PERSONAL_ACCESS_TOKEN/);
    assert.throws(() => tokenFromEnv({ GITHUB_PERSONAL_ACCESS_TOKEN: "  " }), /GITHUB_PERSONAL_ACCESS_TOKEN/);
  });
  it("defaults to the Copilot endpoint and honours the override", () => {
    assert.equal(endpointFromEnv({}), "https://api.githubcopilot.com/mcp/");
    assert.equal(endpointFromEnv({ GITHUB_REMOTE_MCP_URL: " https://example.test/mcp " }), "https://example.test/mcp");
  });
});

describe("extractJsonPayloads / parseToolResponse", () => {
  it("parses plain JSON result content", () => {
    assert.equal(parseToolResponse(jsonResult("issue #1")), "issue #1");
  });
  it("parses SSE data lines, ignoring comments", () => {
    assert.equal(parseToolResponse(`: keep-alive\n${sseResult("sse text")}`), "sse text");
  });
  it("uses the last result payload when several arrive", () => {
    const body = `data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: ${jsonResult("final")}\n\n`;
    assert.equal(extractJsonPayloads(body).length, 2);
    assert.equal(parseToolResponse(body), "final");
  });
  it("throws on JSON-RPC error payloads and empty bodies", () => {
    assert.throws(() => parseToolResponse(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "toolset off" } })), /GitHub remote error: toolset off/);
    assert.throws(() => parseToolResponse(""), /empty or non-JSON/);
  });
});

describe("callRemoteTool", () => {
  it("POSTs a tools/call JSON-RPC body to the Copilot endpoint with Bearer auth", async () => {
    const c: Captured = {};
    const text = await callToolRemote(fake(c, jsonResult("ok")), "ghp_token", "https://api.githubcopilot.com/mcp/", "get_issue", { owner: "octo", repo: "demo", issue_number: 3 });
    assert.equal(text, "ok");
    assert.equal(c.url, "https://api.githubcopilot.com/mcp/");
    assert.equal(c.init?.method, "POST");
    assert.equal(c.init?.headers?.Authorization, "Bearer ghp_token");
    const sent = JSON.parse(c.init?.body ?? "{}");
    assert.equal(sent.method, "tools/call");
    assert.equal(sent.params.name, "get_issue");
    assert.deepEqual(sent.params.arguments, { owner: "octo", repo: "demo", issue_number: 3 });
    assert.ok(String(c.init?.headers?.Accept).includes("text/event-stream"));
  });
  it("handles an SSE upstream response", async () => {
    const c: Captured = {};
    assert.equal(await callRemoteTool(fake(c, sseResult("from sse")), "tok", "https://api.githubcopilot.com/mcp/", "search_code", { q: "mcp" }), "from sse");
  });
  it("rejects an empty token naming GITHUB_PERSONAL_ACCESS_TOKEN", async () => {
    await assert.rejects(() => callRemoteTool(fake({}, jsonResult("x")), "", "https://api.githubcopilot.com/mcp/", "get_issue", {}), /GITHUB_PERSONAL_ACCESS_TOKEN/);
    await assert.rejects(() => callRemoteTool(fake({}, jsonResult("x")), "   ", "https://api.githubcopilot.com/mcp/", "get_issue", {}), /GITHUB_PERSONAL_ACCESS_TOKEN/);
  });
  it("rejects unknown tool names before any fetch", async () => {
    let called = false;
    const spy: FetchFn = async () => { called = true; return resp(jsonResult("x")); };
    await assert.rejects(() => callToolRemote(spy, "tok", "https://api.githubcopilot.com/mcp/", "merge_pull_request", {}), /Unknown tool/);
    assert.equal(called, false);
  });
  it("surfaces HTTP failures with status and detail", async () => {
    const failing: FetchFn = async () => resp("bad token", { ok: false, status: 401, statusText: "Unauthorized" });
    await assert.rejects(() => callRemoteTool(failing, "tok", "https://api.githubcopilot.com/mcp/", "get_issue", {}), /HTTP 401.*bad token/);
  });
  it("surfaces connection failures naming the endpoint", async () => {
    const failing: FetchFn = async () => { throw new Error("fetch failed"); };
    await assert.rejects(() => callRemoteTool(failing, "tok", "https://api.githubcopilot.com/mcp/", "get_issue", {}), /Failed to reach GitHub remote at https:\/\/api\.githubcopilot\.com\/mcp\/: fetch failed/);
  });
  it("forwards push_files arguments unchanged", async () => {
    const c: Captured = {};
    await callToolRemote(fake(c, jsonResult("pushed")), "tok", "https://api.githubcopilot.com/mcp/", "push_files", { owner: "o", repo: "r", branch: "main", files: [{ path: "a.txt", content: "hi" }], message: "add a" });
    assert.deepEqual(JSON.parse(c.init?.body ?? "{}").params.arguments.files, [{ path: "a.txt", content: "hi" }]);
  });
});
