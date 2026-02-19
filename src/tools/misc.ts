import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { notion, apiCall, isFullComment, isFullUser } from "../notion-client.js";
import { richTextToMarkdown } from "../markdown.js";

export function registerMiscTools(server: McpServer) {
  // ── get_comments ──────────────────────────────────────────────────────

  server.tool(
    "get_comments",
    "List comments on a Notion page or block.",
    {
      block_id: z
        .string()
        .describe("The page ID or block ID to get comments for"),
    },
    async ({ block_id }) => {
      try {
        const response = await apiCall(() =>
          notion.comments.list({ block_id })
        );

        const comments = response.results.filter(isFullComment);

        if (comments.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No comments on this page/block." },
            ],
          };
        }

        const lines: string[] = [`## Comments (${comments.length})\n`];
        for (const comment of comments) {
          const text = richTextToMarkdown(comment.rich_text);
          const date = comment.created_time.slice(0, 10);
          const author = comment.created_by?.id ?? "unknown";
          lines.push(`- **${date}** (by ${author}): ${text}`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Error getting comments: ${error}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ── add_comment ───────────────────────────────────────────────────────

  server.tool(
    "add_comment",
    "Add a comment to a Notion page.",
    {
      page_id: z.string().describe("The page ID to comment on"),
      text: z.string().describe("The comment text"),
      discussion_id: z
        .string()
        .optional()
        .describe("Discussion thread ID to reply to (optional)"),
    },
    async ({ page_id, text, discussion_id }) => {
      try {
        const params: Record<string, unknown> = {
          rich_text: [{ text: { content: text } }],
        };

        if (discussion_id) {
          params.discussion_id = discussion_id;
        } else {
          params.parent = { page_id };
        }

        await apiCall(() =>
          notion.comments.create(
            params as Parameters<typeof notion.comments.create>[0]
          )
        );

        return {
          content: [
            {
              type: "text" as const,
              text: discussion_id
                ? `Reply added to discussion ${discussion_id}`
                : `Comment added to page ${page_id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Error adding comment: ${error}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ── get_users ─────────────────────────────────────────────────────────

  server.tool(
    "get_users",
    "List all users in the Notion workspace.",
    {},
    async () => {
      try {
        const response = await apiCall(() => notion.users.list({}));

        const users = response.results.filter(isFullUser);

        if (users.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No users found." },
            ],
          };
        }

        const lines: string[] = [`## Workspace Users (${users.length})\n`];
        for (const user of users) {
          const type = user.type === "person" ? "person" : "bot";
          const email =
            user.type === "person" && user.person?.email
              ? ` (${user.person.email})`
              : "";
          lines.push(`- **${user.name ?? "Unknown"}** (${type}, id: ${user.id})${email}`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Error listing users: ${error}` },
          ],
          isError: true,
        };
      }
    }
  );
}
