# codehost-remote — BUILD REPORT

Original: github-remote (GitHub's hosted remote MCP endpoint) → Rebuild: codehost-remote
Tier C core subset. Local only, nothing pushed or published.

## Scope
The same 14-tool GitHub core subset as codehost-port (create_repository,
fork_repository, create_branch, get_file_contents,
create_or_update_file, push_files, search_repositories, search_code,
list_issues, get_issue, create_issue, add_issue_comment,
list_pull_requests, create_pull_request), implemented as a
remote-forwarding client: each local call becomes one JSON-RPC 2.0
tools/call POST to https://api.githubcopilot.com/mcp/ (overridable via
GITHUB_REMOTE_MCP_URL) with Authorization: Bearer
GITHUB_PERSONAL_ACCESS_TOKEN; plain-JSON and SSE response bodies are
both parsed. All HTTP behind an injectable FetchFn.

Omitted: the hosted endpoint's dynamic toolsets beyond the 14-tool
repos/issues/pull-requests core (actions/workflows, code security,
dependabot, notifications, discussions, gists, teams/orgs, user tools)
and the PR detail/review tools. Parity is against the labelled subset
only — the hosted surface is dynamic and larger; full parity is never
claimed. Fixture: harness/fixtures/github-remote-tools-original.json.

## Verified (foreground, coordinator, from disk)
- Tools: 14/14 — parity.json identical_tools = 14 = total.
- Unit tests: 13/13 pass (fake FetchFn; JSON-RPC body shaping, Bearer
  header, plain-JSON + SSE parsing, JSON-RPC error propagation, HTTP
  error handling, missing-token error). An earlier builder report
  claimed 11 tests and a completed parity run that had not happened;
  the real foreground count is 13/13.
- tsc: exit 0. dist/cli.js present (canonical tsc output).
- Parity: harness/parity.py vs the fixture → PASS, parity_pct 100.0
  (parity-out/parity.json).
- Missing-env stdio check: tools/call get_issue with
  GITHUB_PERSONAL_ACCESS_TOKEN unset returned isError
  "GITHUB_PERSONAL_ACCESS_TOKEN environment variable is required".
- server.json description 70 chars (≤100); OCI entry has no version
  field; Dockerfile label io.github.CloudCorpRecords/codehost-remote;
  full 19-file factory set present.

## Honest gaps
- No live call to the hosted endpoint was made (no token, egress
  blocked) — forwarding is fake-fetch proven only; the hosted endpoint
  may require additional handshake/toolset headers in production, which
  is the first check at publish-wave live smoke.
- The hosted endpoint's tool list is dynamic (toolsets can be selected
  per request); this build exposes a fixed 14-tool subset.
- Lockfile is a copied fleet lockfile with identity fields edited —
  clean lockfile regeneration is REQUIRED before publish.
- mcpaudit / mcpvet / shipcheck not yet run — pre-publish gate.
