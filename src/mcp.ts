/**
 * codehost-remote MCP server. Core subset: 14 tools, forwarded to the
 * hosted GitHub remote MCP endpoint.
 *
 * Low-level Server API with explicit inputSchema literals (the
 * McpServer+zod path injects $schema/additionalProperties and breaks
 * parity). Zod still validates call args. The literals match the
 * labelled core-subset fixture exactly.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { callToolRemote, endpointFromEnv, tokenFromEnv, VERSION } from "./remote.js";
import type { FetchFn } from "./types.js";

const OwnerRepo = { owner: z.string(), repo: z.string() };
const ARG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  create_repository: z.object({
    name: z.string(), description: z.string().optional(),
    private: z.boolean().optional(), autoInit: z.boolean().optional(),
  }),
  fork_repository: z.object({ ...OwnerRepo }),
  create_branch: z.object({
    ...OwnerRepo, branch: z.string(), from_branch: z.string().optional(),
  }),
  get_file_contents: z.object({
    ...OwnerRepo, path: z.string(), branch: z.string().optional(),
  }),
  create_or_update_file: z.object({
    ...OwnerRepo, path: z.string(), content: z.string(), message: z.string(),
    branch: z.string(), sha: z.string().optional(),
  }),
  push_files: z.object({
    ...OwnerRepo, branch: z.string(),
    files: z.array(z.object({ path: z.string(), content: z.string() })),
    message: z.string(),
  }),
  search_repositories: z.object({
    query: z.string(), page: z.number().optional(), perPage: z.number().optional(),
  }),
  search_code: z.object({
    q: z.string(), page: z.number().optional(), perPage: z.number().optional(),
  }),
  list_issues: z.object({
    ...OwnerRepo, state: z.string().optional(), labels: z.string().optional(),
    perPage: z.number().optional(), page: z.number().optional(),
  }),
  get_issue: z.object({ ...OwnerRepo, issue_number: z.number() }),
  create_issue: z.object({
    ...OwnerRepo, title: z.string(), body: z.string().optional(),
    assignees: z.array(z.string()).optional(), labels: z.array(z.string()).optional(),
  }),
  add_issue_comment: z.object({
    ...OwnerRepo, issue_number: z.number(), body: z.string(),
  }),
  list_pull_requests: z.object({
    ...OwnerRepo, state: z.string().optional(),
    perPage: z.number().optional(), page: z.number().optional(),
  }),
  create_pull_request: z.object({
    ...OwnerRepo, title: z.string(), body: z.string().optional(),
    head: z.string(), base: z.string(), draft: z.boolean().optional(),
  }),
};

export const TOOLS = [
  {
    name: "create_repository",
    description: "Create a new GitHub repository for the authenticated user.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Name for the new repository." },
        description: { type: "string", description: "A short description of the new repository." },
        private: { type: "boolean", description: "Whether the new repository is private (true) or public (false)." },
        autoInit: { type: "boolean", description: "Whether to initialize the new repository with a README file." },
      },
      required: ["name"],
    },
  },
  {
    name: "fork_repository",
    description: "Fork a GitHub repository into the authenticated user's account.",
    inputSchema: {
      type: "object" as const,
      properties: { owner: { type: "string", description: "Owner of the repository to fork (user or organization name)." }, repo: { type: "string", description: "Name of the repository to fork." } },
      required: ["owner", "repo"],
    },
  },
  {
    name: "create_branch",
    description: "Create a new branch in a repository, optionally from another branch.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "Owner of the repository (user or organization name)." }, repo: { type: "string", description: "Name of the repository." },
        branch: { type: "string", description: "Name of the new branch to create." }, from_branch: { type: "string", description: "Name of the existing branch to create the new branch from. If omitted, the repository's default branch is used." },
      },
      required: ["owner", "repo", "branch"],
    },
  },
  {
    name: "get_file_contents",
    description: "Get the contents of a file or directory from a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "Owner of the repository (user or organization name)." }, repo: { type: "string", description: "Name of the repository." },
        path: { type: "string", description: "Path of the file or directory to retrieve, relative to the repository root." }, branch: { type: "string", description: "Branch to get the contents from. If omitted, the repository's default branch is used." },
      },
      required: ["owner", "repo", "path"],
    },
  },
  {
    name: "create_or_update_file",
    description: "Create or update a single file in a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "Owner of the repository (user or organization name)." }, repo: { type: "string", description: "Name of the repository." },
        path: { type: "string", description: "Path where the file will be created or updated, relative to the repository root." }, content: { type: "string", description: "Contents of the file." },
        message: { type: "string", description: "Commit message for the file change." }, branch: { type: "string", description: "Branch on which to create or update the file." },
        sha: { type: "string", description: "SHA of the existing file being replaced. Required when updating an existing file; omit when creating a new file." },
      },
      required: ["owner", "repo", "path", "content", "message", "branch"],
    },
  },
  {
    name: "push_files",
    description: "Push one or more files to a GitHub repository in a single commit.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "Owner of the repository (user or organization name)." }, repo: { type: "string", description: "Name of the repository." },
        branch: { type: "string", description: "Branch to push the files to." },
        files: {
          type: "array",
          description: "List of files to push, each with a path and its content.",
          items: {
            type: "object",
            properties: { path: { type: "string", description: "Path of the file, relative to the repository root." }, content: { type: "string", description: "Contents of the file." } },
            required: ["path", "content"],
          },
        },
        message: { type: "string", description: "Commit message for the push." },
      },
      required: ["owner", "repo", "branch", "files", "message"],
    },
  },
  {
    name: "search_repositories",
    description: "Search for GitHub repositories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The repository search query string." }, page: { type: "number", description: "Page number of the search results to return, for pagination." }, perPage: { type: "number", description: "Number of search results per page, for pagination." },
      },
      required: ["query"],
    },
  },
  {
    name: "search_code",
    description: "Search for code across GitHub repositories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        q: { type: "string", description: "The code search query string." }, page: { type: "number", description: "Page number of the search results to return, for pagination." }, perPage: { type: "number", description: "Number of search results per page, for pagination." },
      },
      required: ["q"],
    },
  },
  {
    name: "list_issues",
    description: "List issues in a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "Owner of the repository (user or organization name)." }, repo: { type: "string", description: "Name of the repository." },
        state: { type: "string", description: "Filter issues by state: open, closed, or all." }, labels: { type: "string", description: "Comma-separated list of label names to filter issues by." },
        perPage: { type: "number", description: "Number of issues per page, for pagination." }, page: { type: "number", description: "Page number of the issues to return, for pagination." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "get_issue",
    description: "Get the details of a specific issue in a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "Owner of the repository (user or organization name)." }, repo: { type: "string", description: "Name of the repository." },
        issue_number: { type: "number", description: "Number of the issue to retrieve." },
      },
      required: ["owner", "repo", "issue_number"],
    },
  },
  {
    name: "create_issue",
    description: "Create a new issue in a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "Owner of the repository (user or organization name)." }, repo: { type: "string", description: "Name of the repository." },
        title: { type: "string", description: "Title of the new issue." }, body: { type: "string", description: "Body text of the new issue." },
        assignees: { type: "array", items: { type: "string" }, description: "List of user logins to assign to the new issue." },
        labels: { type: "array", items: { type: "string" }, description: "List of label names to apply to the new issue." },
      },
      required: ["owner", "repo", "title"],
    },
  },
  {
    name: "add_issue_comment",
    description: "Add a comment to an existing issue in a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "Owner of the repository (user or organization name)." }, repo: { type: "string", description: "Name of the repository." },
        issue_number: { type: "number", description: "Number of the issue to comment on." }, body: { type: "string", description: "Text of the comment to add." },
      },
      required: ["owner", "repo", "issue_number", "body"],
    },
  },
  {
    name: "list_pull_requests",
    description: "List pull requests in a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "Owner of the repository (user or organization name)." }, repo: { type: "string", description: "Name of the repository." },
        state: { type: "string", description: "Filter pull requests by state: open, closed, or all." }, perPage: { type: "number", description: "Number of pull requests per page, for pagination." }, page: { type: "number", description: "Page number of the pull requests to return, for pagination." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "create_pull_request",
    description: "Create a new pull request in a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "Owner of the repository (user or organization name)." }, repo: { type: "string", description: "Name of the repository." },
        title: { type: "string", description: "Title of the new pull request." }, body: { type: "string", description: "Body text of the new pull request." },
        head: { type: "string", description: "Name of the branch containing the changes to merge (the source branch)." }, base: { type: "string", description: "Name of the branch to merge the changes into (the target branch)." },
        draft: { type: "boolean", description: "Whether to create the pull request as a draft." },
      },
      required: ["owner", "repo", "title", "head", "base"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    }],
  };
}
function errorResult(err: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: err instanceof Error ? err.message : String(err),
    }],
    isError: true,
  };
}

const server = new Server(
  { name: "codehost-remote", version: VERSION },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const schema = ARG_SCHEMAS[name];
  if (!schema) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  try {
    const token = tokenFromEnv();
    const parsed = schema.parse(args ?? {}) as Record<string, unknown>;
    const fetchFn = globalThis.fetch as unknown as FetchFn;
    return textResult(await callToolRemote(fetchFn, token, endpointFromEnv(), name, parsed));
  } catch (err) {
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}
void main();
