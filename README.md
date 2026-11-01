# codehost-remote

codehost-remote gives you the familiar GitHub tool surface — repositories,
branches, files, search, issues and pull requests — without a local REST
client. Every call is forwarded as a JSON-RPC `tools/call` to GitHub's
hosted remote MCP endpoint at `https://api.githubcopilot.com/mcp/`, and
the hosted answer, whether plain JSON or a streamed SSE response, is
what you get back.

That makes it the lightweight option: no GitHub API versioning to track
locally, and the hosted service does the work. The trade-off is that you
depend on the hosted endpoint's availability and behaviour.

Only a core subset is exposed here: 14 tools. The hosted endpoint
actually serves a much larger, dynamic set of toolsets (40+ tools);
this package deliberately pins the repos / issues / pull-requests core
and never claims the full hosted surface.

Set `GITHUB_PERSONAL_ACCESS_TOKEN`; it is sent as a Bearer token.
`GITHUB_REMOTE_MCP_URL` overrides the endpoint (useful for testing).

## Install

```bash
npx @reneturcios/codehost-remote get_issue '{"owner":"octocat","repo":"hello-world","issue_number":1}'
docker run -i -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/cloudcorprecords/codehost-remote
```

## CLI

Every tool is a subcommand taking one JSON argument object:

```bash
codehost-remote search_repositories '{"query":"mcp language:typescript"}'
codehost-remote create_issue '{"owner":"me","repo":"proj","title":"Bug: startup crash"}'
codehost-remote --version
```

Exit codes: `0` success, `1` error, `2` usage error.

## MCP server

```bash
npx -y @reneturcios/codehost-remote mcp
```

```json
{
  "mcpServers": {
    "codehost-remote": {
      "command": "npx",
      "args": ["-y", "@reneturcios/codehost-remote", "mcp"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token" }
    }
  }
}
```

### Tools

`create_repository`, `fork_repository`, `create_branch`,
`get_file_contents`, `create_or_update_file`, `push_files`,
`search_repositories`, `search_code`, `list_issues`, `get_issue`,
`create_issue`, `add_issue_comment`, `list_pull_requests`,
`create_pull_request`.

A missing token is reported as a tool error naming
`GITHUB_PERSONAL_ACCESS_TOKEN`.

## Development

```bash
npm install
npm run build
npm test
```

Tests run entirely on fake-fetch fixtures, including plain-JSON and
SSE upstream bodies; no network is used.

## License

MIT — see `LICENSE`.
