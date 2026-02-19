import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { notion, apiCall, isFullBlock } from "../notion-client.js";
import { markdownToBlocks, richTextToMarkdown } from "../markdown.js";

export function registerBlockTools(server: McpServer) {
  // ── append_blocks ─────────────────────────────────────────────────────

  server.tool(
    "append_blocks",
    "Append content to a Notion page or block. Accepts Markdown that gets converted to Notion blocks.",
    {
      block_id: z
        .string()
        .describe("The page ID or block ID to append content to"),
      content: z
        .string()
        .describe("Markdown content to append"),
    },
    async ({ block_id, content }) => {
      try {
        const blocks = markdownToBlocks(content);

        const response = await apiCall(() =>
          notion.blocks.children.append({
            block_id,
            children: blocks as Parameters<
              typeof notion.blocks.children.append
            >[0]["children"],
          })
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Appended ${response.results.length} block(s) to ${block_id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Error appending blocks: ${error}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ── update_block ──────────────────────────────────────────────────────

  server.tool(
    "update_block",
    "Update a specific Notion block's text content. The block type is preserved.",
    {
      block_id: z.string().describe("The block ID to update"),
      content: z
        .string()
        .describe(
          "New text content for the block (inline Markdown supported: **bold**, *italic*, `code`, [links](url))"
        ),
    },
    async ({ block_id, content }) => {
      try {
        // First retrieve the block to know its type
        const existing = await apiCall(() =>
          notion.blocks.retrieve({ block_id })
        );

        if (!isFullBlock(existing)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Could not retrieve full block data",
              },
            ],
            isError: true,
          };
        }

        // Build rich_text from content
        const richText = parseInlineToRichText(content);

        // Build update payload based on block type
        const updatePayload: Record<string, unknown> = { block_id };
        const type = existing.type;

        switch (type) {
          case "paragraph":
            updatePayload.paragraph = { rich_text: richText };
            break;
          case "heading_1":
            updatePayload.heading_1 = { rich_text: richText };
            break;
          case "heading_2":
            updatePayload.heading_2 = { rich_text: richText };
            break;
          case "heading_3":
            updatePayload.heading_3 = { rich_text: richText };
            break;
          case "bulleted_list_item":
            updatePayload.bulleted_list_item = { rich_text: richText };
            break;
          case "numbered_list_item":
            updatePayload.numbered_list_item = { rich_text: richText };
            break;
          case "to_do": {
            const td = existing as Extract<typeof existing, { type: "to_do" }>;
            updatePayload.to_do = {
              rich_text: richText,
              checked: td.to_do.checked,
            };
            break;
          }
          case "toggle":
            updatePayload.toggle = { rich_text: richText };
            break;
          case "quote":
            updatePayload.quote = { rich_text: richText };
            break;
          case "callout": {
            const co = existing as Extract<typeof existing, { type: "callout" }>;
            updatePayload.callout = {
              rich_text: richText,
              icon: co.callout.icon,
            };
            break;
          }
          case "code": {
            const cd = existing as Extract<typeof existing, { type: "code" }>;
            updatePayload.code = {
              rich_text: [{ text: { content } }],
              language: cd.code.language,
            };
            break;
          }
          default:
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Block type "${type}" does not support text updates`,
                },
              ],
              isError: true,
            };
        }

        await apiCall(() =>
          notion.blocks.update(
            updatePayload as Parameters<typeof notion.blocks.update>[0]
          )
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Block updated (${block_id}, type: ${type})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Error updating block: ${error}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ── delete_block ──────────────────────────────────────────────────────

  server.tool(
    "delete_block",
    "Delete a Notion block by its ID.",
    {
      block_id: z.string().describe("The block ID to delete"),
    },
    async ({ block_id }) => {
      try {
        await apiCall(() => notion.blocks.delete({ block_id }));

        return {
          content: [
            { type: "text" as const, text: `Block deleted (${block_id})` },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Error deleting block: ${error}` },
          ],
          isError: true,
        };
      }
    }
  );
}

// ── Inline Markdown → Rich Text (for block updates) ──────────────────────

function parseInlineToRichText(
  text: string
): Array<{
  text: { content: string; link?: { url: string } | null };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  };
}> {
  const items: Array<{
    text: { content: string; link?: { url: string } | null };
    annotations?: {
      bold?: boolean;
      italic?: boolean;
      strikethrough?: boolean;
      code?: boolean;
    };
  }> = [];

  const regex =
    /\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|~~(.+?)~~|([^[*`~]+|[*`~[]+)/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1] !== undefined && match[2] !== undefined) {
      items.push({
        text: { content: match[1], link: { url: match[2] } },
      });
    } else if (match[3] !== undefined) {
      items.push({
        text: { content: match[3] },
        annotations: { bold: true },
      });
    } else if (match[4] !== undefined) {
      items.push({
        text: { content: match[4] },
        annotations: { italic: true },
      });
    } else if (match[5] !== undefined) {
      items.push({
        text: { content: match[5] },
        annotations: { code: true },
      });
    } else if (match[6] !== undefined) {
      items.push({
        text: { content: match[6] },
        annotations: { strikethrough: true },
      });
    } else if (match[7] !== undefined) {
      items.push({ text: { content: match[7] } });
    }
  }

  if (items.length === 0) {
    items.push({ text: { content: text } });
  }

  return items;
}
