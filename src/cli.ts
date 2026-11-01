#!/usr/bin/env node
/**
 * codehost-remote CLI.
 *   codehost-remote <tool-name> '<json args>'
 *   codehost-remote mcp
 * Requires GITHUB_PERSONAL_ACCESS_TOKEN. Exit codes: 0 success, 1 error, 2 usage.
 */
import { callToolRemote, endpointFromEnv, tokenFromEnv, TOOL_NAMES, VERSION } from "./remote.js";
import type { FetchFn } from "./types.js";

function usage(): never {
  console.error(`Usage:
  codehost-remote <tool> '<json args>'   tools: ${TOOL_NAMES.join(", ")}
  codehost-remote mcp
  codehost-remote --version`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") { console.log(VERSION); return; }
  if (cmd === "mcp") { await import("./mcp.js"); return; }
  if (!cmd || !TOOL_NAMES.includes(cmd)) usage();
  let args: Record<string, unknown> = {};
  const raw = rest.join(" ").trim();
  if (raw) {
    try {
      args = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.error("error: args must be a JSON object");
      process.exit(1);
    }
  }
  try {
    const fetchFn = globalThis.fetch as unknown as FetchFn;
    const out = await callToolRemote(fetchFn, tokenFromEnv(), endpointFromEnv(), cmd, args);
    console.log(out);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
void main();
