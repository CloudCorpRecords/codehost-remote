# Changelog

## 0.1.0 (2026-10-26)

- Initial release: the 14-tool GitHub core subset as a forwarding
  client of GitHub's hosted remote MCP endpoint
  (`https://api.githubcopilot.com/mcp/`, override
  `GITHUB_REMOTE_MCP_URL`).
- CLI: `codehost-remote <tool> '<json args>'` for every tool, plus `mcp`.
- MCP server (`codehost-remote mcp`, stdio) with 14 tools matching the
  labelled core-subset fixture; the hosted endpoint itself serves a
  larger dynamic toolset surface — this package exposes the subset only.
- Auth: `GITHUB_PERSONAL_ACCESS_TOKEN`, sent as a Bearer token.
- Responses in plain JSON and text/event-stream (SSE) shapes are both
  parsed. All HTTP goes through an injectable fetch function, so tests
  run on fixtures with no network access.
