import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints.js";
import { notion, apiCall, isFullBlock, collectAllBlocks } from "../notion-client.js";
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

  // ── insert_after_block ───────────────────────────────────────────────

  server.tool(
    "insert_after_block",
    "Insert content after a specific block within a page. Like append_blocks but positions content after a specified block instead of at the end. Use list_children_blocks first to find the target block ID.",
    {
      block_id: z
        .string()
        .describe("The parent page or block ID containing the target block"),
      after: z
        .string()
        .describe("Block ID to insert content after (use list_children_blocks to find IDs)"),
      content: z
        .string()
        .describe("Markdown content to insert"),
    },
    async ({ block_id, after, content }) => {
      try {
        const blocks = markdownToBlocks(content);

        const response = await apiCall(() =>
          notion.blocks.children.append({
            block_id,
            after,
            children: blocks as Parameters<
              typeof notion.blocks.children.append
            >[0]["children"],
          })
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Inserted ${response.results.length} block(s) after ${after} in ${block_id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Error inserting blocks: ${error}` },
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

  // ── list_children_blocks ────────────────────────────────────────────────

  server.tool(
    "list_children_blocks",
    "List all child blocks of a page or block. Returns block IDs, types, and content previews for programmatic manipulation.",
    {
      block_id: z
        .string()
        .describe("The page ID or block ID to list children of"),
    },
    async ({ block_id }) => {
      try {
        const blocks = await collectAllBlocks(block_id);

        if (blocks.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No child blocks found." },
            ],
          };
        }

        const lines: string[] = [
          `## Child Blocks (${blocks.length})\n`,
          "| # | Block ID | Type | Has Children | Preview |",
          "| --- | --- | --- | --- | --- |",
        ];

        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i];
          const preview = getBlockPreview(block);
          const children = block.has_children ? "yes" : "no";
          lines.push(
            `| ${i + 1} | ${block.id} | ${block.type} | ${children} | ${preview} |`
          );
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing children: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── replace_page_content ────────────────────────────────────────────────

  server.tool(
    "replace_page_content",
    "Replace all content on a page — deletes every existing block then appends new Markdown content. Atomic rewrite operation.",
    {
      page_id: z.string().describe("The page ID to rewrite"),
      content: z.string().describe("New Markdown content for the page"),
    },
    async ({ page_id, content }) => {
      try {
        // 1. Fetch existing top-level blocks
        const existing = await collectAllBlocks(page_id);
        const totalToDelete = existing.length;

        // 2. Delete in chunked parallel batches of 10 (prevents timeout on large pages)
        const deleteFailed: string[] = [];
        let deletedCount = 0;
        const DELETE_BATCH_SIZE = 10;

        for (let i = 0; i < existing.length; i += DELETE_BATCH_SIZE) {
          const batch = existing.slice(i, i + DELETE_BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map((block) =>
              apiCall(() => notion.blocks.delete({ block_id: block.id }))
            )
          );
          for (let j = 0; j < results.length; j++) {
            if (results[j].status === "fulfilled") {
              deletedCount++;
            } else {
              deleteFailed.push(batch[j].id);
            }
          }
        }

        // 3. Convert markdown to blocks
        const newBlocks = markdownToBlocks(content);

        // 4. Insert in chunked batches of 50 (Notion API limit is 100, use 50 for safety)
        const INSERT_BATCH_SIZE = 50;
        let createdCount = 0;

        for (let i = 0; i < newBlocks.length; i += INSERT_BATCH_SIZE) {
          const batch = newBlocks.slice(i, i + INSERT_BATCH_SIZE);
          const response = await apiCall(() =>
            notion.blocks.children.append({
              block_id: page_id,
              children: batch as Parameters<
                typeof notion.blocks.children.append
              >[0]["children"],
            })
          );
          createdCount += response.results.length;
        }

        let summary = `Page content replaced (${page_id})\n- Blocks deleted: ${deletedCount}/${totalToDelete}`;
        if (deleteFailed.length > 0) {
          summary += `\n- Failed to delete: ${deleteFailed.length} block(s)`;
        }
        summary += `\n- Blocks created: ${createdCount}`;

        return {
          content: [{ type: "text" as const, text: summary }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error replacing page content: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── batch_delete_blocks ─────────────────────────────────────────────────

  server.tool(
    "batch_delete_blocks",
    "Delete multiple Notion blocks in one call.",
    {
      block_ids: z
        .array(z.string())
        .describe("Array of block IDs to delete"),
    },
    async ({ block_ids }) => {
      try {
        let deleted = 0;
        const failed: Array<{ id: string; error: string }> = [];
        const BATCH_SIZE = 10;

        // Process in parallel batches of 10 (prevents timeout on large sets)
        for (let i = 0; i < block_ids.length; i += BATCH_SIZE) {
          const batch = block_ids.slice(i, i + BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map((id) =>
              apiCall(() => notion.blocks.delete({ block_id: id }))
            )
          );
          for (let j = 0; j < results.length; j++) {
            if (results[j].status === "fulfilled") {
              deleted++;
            } else {
              const reason = (results[j] as PromiseRejectedResult).reason;
              failed.push({ id: batch[j], error: String(reason) });
            }
          }
        }

        const lines: string[] = [`Deleted ${deleted} of ${block_ids.length} block(s)`];
        if (failed.length > 0) {
          lines.push(`\nFailed (${failed.length}):`);
          for (const f of failed) {
            lines.push(`- ${f.id}: ${f.error}`);
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          isError: failed.length > 0,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error in batch delete: ${error}`,
            },
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

// ── Block Preview (for list_children_blocks) ──────────────────────────────

function getBlockPreview(block: BlockObjectResponse): string {
  const type = block.type;

  // Blocks with rich_text — extract via the block's type-specific property
  const blockData = (block as Record<string, unknown>)[type] as
    | { rich_text?: Parameters<typeof richTextToMarkdown>[0] }
    | undefined;
  if (
    blockData?.rich_text &&
    [
      "paragraph", "heading_1", "heading_2", "heading_3",
      "bulleted_list_item", "numbered_list_item", "to_do",
      "toggle", "quote", "callout",
    ].includes(type)
  ) {
    const text = richTextToMarkdown(blockData.rich_text);
    return text.length > 80 ? text.slice(0, 77) + "..." : text;
  }

  switch (type) {
    case "code": {
      const b = block as Extract<BlockObjectResponse, { type: "code" }>;
      const text = richTextToMarkdown(b.code.rich_text);
      const lang = b.code.language || "";
      const preview = text.length > 60 ? text.slice(0, 57) + "..." : text;
      return `\`\`\`${lang}: ${preview}`;
    }
    case "image":
      return "(image)";
    case "video":
      return "(video)";
    case "file":
      return "(file)";
    case "pdf":
      return "(pdf)";
    case "bookmark": {
      const b = block as Extract<BlockObjectResponse, { type: "bookmark" }>;
      return b.bookmark.url;
    }
    case "embed": {
      const b = block as Extract<BlockObjectResponse, { type: "embed" }>;
      return b.embed.url;
    }
    case "divider":
      return "---";
    case "table":
      return "(table)";
    case "child_page": {
      const b = block as Extract<BlockObjectResponse, { type: "child_page" }>;
      return `Child page: ${b.child_page.title}`;
    }
    case "child_database": {
      const b = block as Extract<BlockObjectResponse, { type: "child_database" }>;
      return `Child DB: ${b.child_database.title}`;
    }
    case "column_list":
      return "(columns)";
    case "table_of_contents":
      return "(table of contents)";
    case "equation": {
      const b = block as Extract<BlockObjectResponse, { type: "equation" }>;
      return b.equation.expression;
    }
    default:
      return `(${type})`;
  }
}
