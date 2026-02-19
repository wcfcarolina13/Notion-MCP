import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { notion, apiCall, collectAllBlocks, isFullPage } from "../notion-client.js";
import { blocksToMarkdown, markdownToBlocks, getPageTitle, formatProperty } from "../markdown.js";

export function registerPageTools(server: McpServer) {
  // ── search ────────────────────────────────────────────────────────────

  server.tool(
    "search",
    "Search Notion workspace by title. Returns matching pages and databases.",
    {
      query: z.string().describe("Search query text"),
      filter: z
        .enum(["page", "database"])
        .optional()
        .describe("Filter results to only pages or only databases"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results to return (default 10)"),
    },
    async ({ query, filter, limit }) => {
      try {
        const params: Parameters<typeof notion.search>[0] = {
          query,
          page_size: limit ?? 10,
          sort: { timestamp: "last_edited_time", direction: "descending" },
        };
        if (filter) {
          params.filter = { property: "object", value: filter };
        }

        const response = await apiCall(() => notion.search(params));
        const lines: string[] = [];

        for (const result of response.results) {
          if (result.object === "page" && isFullPage(result)) {
            const title = getPageTitle(result);
            const edited = result.last_edited_time.slice(0, 10);
            lines.push(`- **${title}** (page, id: ${result.id}, edited: ${edited})`);
          } else if (result.object === "database") {
            const db = result as { id: string; title?: Array<{ plain_text: string }>; last_edited_time?: string };
            const title = db.title?.map((t) => t.plain_text).join("") || "Untitled DB";
            const edited = db.last_edited_time?.slice(0, 10) ?? "";
            lines.push(`- **${title}** (database, id: ${result.id}, edited: ${edited})`);
          }
        }

        if (lines.length === 0) {
          return { content: [{ type: "text" as const, text: `No results found for "${query}"` }] };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `## Search: "${query}"\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error searching: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // ── get_page ──────────────────────────────────────────────────────────

  server.tool(
    "get_page",
    "Get a Notion page's content as Markdown. Fetches all blocks recursively.",
    {
      page_id: z.string().describe("The Notion page ID"),
      include_properties: z
        .boolean()
        .optional()
        .describe("Include page properties in output (default true)"),
    },
    async ({ page_id, include_properties }) => {
      try {
        // Fetch page metadata and blocks in parallel
        const [page, blocks] = await Promise.all([
          apiCall(() => notion.pages.retrieve({ page_id })),
          collectAllBlocks(page_id),
        ]);

        const parts: string[] = [];

        if (isFullPage(page)) {
          const title = getPageTitle(page);
          parts.push(`# ${title}\n`);
          parts.push(`> Page ID: ${page.id}`);
          parts.push(`> Last edited: ${page.last_edited_time}`);

          if (include_properties !== false) {
            const props = page.properties as Record<string, Record<string, unknown>>;
            const propLines: string[] = [];
            for (const [name, prop] of Object.entries(props)) {
              if ((prop.type as string) === "title") continue;
              const value = formatProperty(prop);
              if (value) propLines.push(`- **${name}**: ${value}`);
            }
            if (propLines.length > 0) {
              parts.push(`\n**Properties:**\n${propLines.join("\n")}`);
            }
          }

          parts.push("");
        }

        const markdown = await blocksToMarkdown(blocks);
        parts.push(markdown);

        return {
          content: [{ type: "text" as const, text: parts.join("\n") }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting page: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // ── create_page ───────────────────────────────────────────────────────

  server.tool(
    "create_page",
    "Create a new Notion page. Provide Markdown content and a parent (page or database).",
    {
      parent_id: z.string().describe("Parent page ID or database ID"),
      parent_type: z
        .enum(["page", "database"])
        .describe("Whether the parent is a page or database"),
      title: z.string().describe("Page title"),
      content: z
        .string()
        .optional()
        .describe("Page content in Markdown format"),
      icon: z.string().optional().describe("Emoji icon for the page"),
    },
    async ({ parent_id, parent_type, title, content, icon }) => {
      try {
        const children = content ? markdownToBlocks(content) : [];

        const params: Record<string, unknown> = {
          parent:
            parent_type === "database"
              ? { database_id: parent_id }
              : { page_id: parent_id },
          properties: {
            title: {
              title: [{ text: { content: title } }],
            },
          },
          children,
        };

        if (icon) {
          params.icon = { type: "emoji", emoji: icon };
        }

        const page = await apiCall(() =>
          notion.pages.create(params as Parameters<typeof notion.pages.create>[0])
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Page created: **${title}**\n- ID: ${page.id}\n- URL: ${"url" in page ? page.url : "N/A"}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating page: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // ── update_page ───────────────────────────────────────────────────────

  server.tool(
    "update_page",
    "Update a Notion page's properties (title, icon, cover).",
    {
      page_id: z.string().describe("The Notion page ID to update"),
      title: z.string().optional().describe("New page title"),
      icon: z.string().optional().describe("New emoji icon"),
      cover_url: z.string().optional().describe("New cover image URL"),
    },
    async ({ page_id, title, icon, cover_url }) => {
      try {
        const params: Record<string, unknown> = { page_id };

        if (title) {
          params.properties = {
            title: { title: [{ text: { content: title } }] },
          };
        }
        if (icon) {
          params.icon = { type: "emoji", emoji: icon };
        }
        if (cover_url) {
          params.cover = {
            type: "external",
            external: { url: cover_url },
          };
        }

        await apiCall(() =>
          notion.pages.update(params as Parameters<typeof notion.pages.update>[0])
        );

        const updates: string[] = [];
        if (title) updates.push(`title → "${title}"`);
        if (icon) updates.push(`icon → ${icon}`);
        if (cover_url) updates.push(`cover → ${cover_url}`);

        return {
          content: [
            {
              type: "text" as const,
              text: `Page updated (${page_id}):\n${updates.map((u) => `- ${u}`).join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error updating page: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // ── archive_page ──────────────────────────────────────────────────────

  server.tool(
    "archive_page",
    "Archive or restore a Notion page.",
    {
      page_id: z.string().describe("The Notion page ID"),
      archived: z
        .boolean()
        .describe("true to archive, false to restore"),
    },
    async ({ page_id, archived }) => {
      try {
        await apiCall(() =>
          notion.pages.update({ page_id, archived })
        );

        const action = archived ? "archived" : "restored";
        return {
          content: [
            { type: "text" as const, text: `Page ${action} (${page_id})` },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error archiving page: ${error}` }],
          isError: true,
        };
      }
    }
  );
}
