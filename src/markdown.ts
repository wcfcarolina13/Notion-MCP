import type {
  BlockObjectResponse,
  RichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints.js";
import { apiCall, notion, collectAllBlocks } from "./notion-client.js";

// ── Rich Text → Markdown ──────────────────────────────────────────────────

export function richTextToMarkdown(richText: RichTextItemResponse[]): string {
  return richText
    .map((item) => {
      // Handle mention types (page, database, user, date)
      if (item.type === "mention") {
        const m = item as Extract<RichTextItemResponse, { type: "mention" }>;
        if (m.mention.type === "page") {
          return `{{page:${m.mention.page.id}}}`;
        }
        if (m.mention.type === "database") {
          return `{{database:${m.mention.database.id}}}`;
        }
        // For user mentions, date mentions, etc. — fall through to plain_text
      }

      let text = item.plain_text;
      if (!text) return "";

      const ann = item.annotations;
      if (ann.code) text = `\`${text}\``;
      if (ann.bold) text = `**${text}**`;
      if (ann.italic) text = `*${text}*`;
      if (ann.strikethrough) text = `~~${text}~~`;

      if (item.type === "text" && item.text.link) {
        text = `[${text}](${item.text.link.url})`;
      }

      return text;
    })
    .join("");
}

// ── Blocks → Markdown ─────────────────────────────────────────────────────

async function blockToMarkdown(
  block: BlockObjectResponse,
  indent: number = 0
): Promise<string> {
  const prefix = "  ".repeat(indent);
  const type = block.type;
  let line = "";

  switch (type) {
    case "paragraph": {
      const b = block as Extract<BlockObjectResponse, { type: "paragraph" }>;
      line = richTextToMarkdown(b.paragraph.rich_text);
      break;
    }
    case "heading_1": {
      const b = block as Extract<BlockObjectResponse, { type: "heading_1" }>;
      line = `# ${richTextToMarkdown(b.heading_1.rich_text)}`;
      break;
    }
    case "heading_2": {
      const b = block as Extract<BlockObjectResponse, { type: "heading_2" }>;
      line = `## ${richTextToMarkdown(b.heading_2.rich_text)}`;
      break;
    }
    case "heading_3": {
      const b = block as Extract<BlockObjectResponse, { type: "heading_3" }>;
      line = `### ${richTextToMarkdown(b.heading_3.rich_text)}`;
      break;
    }
    case "bulleted_list_item": {
      const b = block as Extract<BlockObjectResponse, { type: "bulleted_list_item" }>;
      line = `- ${richTextToMarkdown(b.bulleted_list_item.rich_text)}`;
      break;
    }
    case "numbered_list_item": {
      const b = block as Extract<BlockObjectResponse, { type: "numbered_list_item" }>;
      line = `1. ${richTextToMarkdown(b.numbered_list_item.rich_text)}`;
      break;
    }
    case "to_do": {
      const b = block as Extract<BlockObjectResponse, { type: "to_do" }>;
      const check = b.to_do.checked ? "x" : " ";
      line = `- [${check}] ${richTextToMarkdown(b.to_do.rich_text)}`;
      break;
    }
    case "toggle": {
      const b = block as Extract<BlockObjectResponse, { type: "toggle" }>;
      line = `<details>\n${prefix}<summary>${richTextToMarkdown(b.toggle.rich_text)}</summary>`;
      break;
    }
    case "code": {
      const b = block as Extract<BlockObjectResponse, { type: "code" }>;
      const lang = b.code.language || "";
      const code = richTextToMarkdown(b.code.rich_text);
      line = `\`\`\`${lang}\n${code}\n\`\`\``;
      break;
    }
    case "quote": {
      const b = block as Extract<BlockObjectResponse, { type: "quote" }>;
      line = `> ${richTextToMarkdown(b.quote.rich_text)}`;
      break;
    }
    case "callout": {
      const b = block as Extract<BlockObjectResponse, { type: "callout" }>;
      const icon =
        b.callout.icon?.type === "emoji" ? b.callout.icon.emoji + " " : "";
      line = `> ${icon}${richTextToMarkdown(b.callout.rich_text)}`;
      break;
    }
    case "divider": {
      line = "---";
      break;
    }
    case "image": {
      const b = block as Extract<BlockObjectResponse, { type: "image" }>;
      const url =
        b.image.type === "external" ? b.image.external.url : b.image.file.url;
      const caption = b.image.caption
        ? richTextToMarkdown(b.image.caption)
        : "image";
      line = `![${caption}](${url})`;
      break;
    }
    case "bookmark": {
      const b = block as Extract<BlockObjectResponse, { type: "bookmark" }>;
      const caption = b.bookmark.caption?.length
        ? richTextToMarkdown(b.bookmark.caption)
        : "";
      line = caption
        ? `{{bookmark:${b.bookmark.url}|${caption}}}`
        : `{{bookmark:${b.bookmark.url}}}`;
      break;
    }
    case "table": {
      // Fetch table rows as children
      const rows = await collectAllBlocks(block.id);
      const tableLines: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.type !== "table_row") continue;
        const r = row as Extract<BlockObjectResponse, { type: "table_row" }>;
        const cells = r.table_row.cells.map((cell) =>
          richTextToMarkdown(cell)
        );
        tableLines.push(`| ${cells.join(" | ")} |`);
        if (i === 0) {
          tableLines.push(`| ${cells.map(() => "---").join(" | ")} |`);
        }
      }
      line = tableLines.join("\n");
      break;
    }
    case "child_page": {
      const b = block as Extract<BlockObjectResponse, { type: "child_page" }>;
      line = `**[Child Page: ${b.child_page.title}]** (id: ${block.id})`;
      break;
    }
    case "child_database": {
      const b = block as Extract<BlockObjectResponse, { type: "child_database" }>;
      line = `**[Child Database: ${b.child_database.title}]** (id: ${block.id})`;
      break;
    }
    case "embed": {
      const b = block as Extract<BlockObjectResponse, { type: "embed" }>;
      line = `{{embed:${b.embed.url}}}`;
      break;
    }
    case "video": {
      const b = block as Extract<BlockObjectResponse, { type: "video" }>;
      const url =
        b.video.type === "external" ? b.video.external.url : b.video.file.url;
      line = `[Video](${url})`;
      break;
    }
    case "file": {
      const b = block as Extract<BlockObjectResponse, { type: "file" }>;
      const url =
        b.file.type === "external" ? b.file.external.url : b.file.file.url;
      const caption = b.file.caption
        ? richTextToMarkdown(b.file.caption)
        : "File";
      line = `[${caption}](${url})`;
      break;
    }
    case "pdf": {
      const b = block as Extract<BlockObjectResponse, { type: "pdf" }>;
      const url =
        b.pdf.type === "external" ? b.pdf.external.url : b.pdf.file.url;
      line = `[PDF](${url})`;
      break;
    }
    case "equation": {
      const b = block as Extract<BlockObjectResponse, { type: "equation" }>;
      line = `$$${b.equation.expression}$$`;
      break;
    }
    case "table_of_contents":
    case "breadcrumb": {
      line = `<!-- ${type} -->`;
      break;
    }
    case "column_list": {
      // Fetch columns and render them sequentially
      const columns = await collectAllBlocks(block.id);
      const parts: string[] = [];
      for (const col of columns) {
        if (col.type === "column") {
          const colBlocks = await collectAllBlocks(col.id);
          const colMd = await blocksToMarkdown(colBlocks, indent);
          parts.push(colMd);
        }
      }
      line = parts.join("\n\n");
      break;
    }
    default: {
      line = `<!-- unsupported block type: ${type} -->`;
      break;
    }
  }

  // Handle nested children (for blocks with has_children)
  let children = "";
  if (
    block.has_children &&
    type !== "table" &&
    type !== "column_list" &&
    type !== "column"
  ) {
    const childBlocks = await collectAllBlocks(block.id);
    children = await blocksToMarkdown(childBlocks, indent + 1);
  }

  const prefixed = line
    .split("\n")
    .map((l) => prefix + l)
    .join("\n");

  if (type === "toggle" && children) {
    return `${prefixed}\n${children}\n${prefix}</details>`;
  }

  return children ? `${prefixed}\n${children}` : prefixed;
}

export async function blocksToMarkdown(
  blocks: BlockObjectResponse[],
  indent: number = 0
): Promise<string> {
  const lines: string[] = [];
  for (const block of blocks) {
    const md = await blockToMarkdown(block, indent);
    lines.push(md);
  }
  return lines.join("\n");
}

// ── Markdown → Rich Text ──────────────────────────────────────────────────

type RichTextInput =
  | {
      text: { content: string; link?: { url: string } | null };
      annotations?: {
        bold?: boolean;
        italic?: boolean;
        strikethrough?: boolean;
        code?: boolean;
      };
    }
  | {
      type: "mention";
      mention: { page: { id: string } } | { database: { id: string } };
    };

function parseInlineMarkdown(text: string): RichTextInput[] {
  const items: RichTextInput[] = [];
  // Pattern: page/database mentions, links, bold, italic, code, strikethrough
  const regex =
    /\{\{(page|database):([^}]+)\}\}|\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|~~(.+?)~~|([^[{*`~]+|[{*`~[]+)/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1] !== undefined && match[2] !== undefined) {
      // Mention: {{page:id}} or {{database:id}}
      const mentionType = match[1] as "page" | "database";
      const id = match[2].trim();
      if (mentionType === "page") {
        items.push({ type: "mention", mention: { page: { id } } });
      } else {
        items.push({ type: "mention", mention: { database: { id } } });
      }
    } else if (match[3] !== undefined && match[4] !== undefined) {
      // Link: [text](url)
      items.push({
        text: { content: match[3], link: { url: match[4] } },
      });
    } else if (match[5] !== undefined) {
      // Bold: **text**
      items.push({
        text: { content: match[5] },
        annotations: { bold: true },
      });
    } else if (match[6] !== undefined) {
      // Italic: *text*
      items.push({
        text: { content: match[6] },
        annotations: { italic: true },
      });
    } else if (match[7] !== undefined) {
      // Code: `text`
      items.push({
        text: { content: match[7] },
        annotations: { code: true },
      });
    } else if (match[8] !== undefined) {
      // Strikethrough: ~~text~~
      items.push({
        text: { content: match[8] },
        annotations: { strikethrough: true },
      });
    } else if (match[9] !== undefined) {
      // Plain text
      items.push({ text: { content: match[9] } });
    }
  }

  if (items.length === 0 && text.length > 0) {
    items.push({ text: { content: text } });
  }

  return items;
}

// ── Markdown → Blocks ─────────────────────────────────────────────────────

interface BlockInput {
  object?: "block";
  type: string;
  [key: string]: unknown;
}

export function markdownToBlocks(markdown: string): BlockInput[] {
  const lines = markdown.split("\n");
  const blocks: BlockInput[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line → skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Code block
    if (line.trim().startsWith("```")) {
      const langMatch = line.trim().match(/^```(\w*)/);
      const language = langMatch?.[1] || "plain text";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        type: "code",
        code: {
          rich_text: [{ text: { content: codeLines.join("\n") } }],
          language: mapLanguage(language),
        },
      });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      const key = `heading_${level}` as const;
      blocks.push({
        type: key,
        [key]: {
          rich_text: parseInlineMarkdown(headingMatch[2]),
        },
      });
      i++;
      continue;
    }

    // Checkbox: - [x] or - [ ]
    const todoMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)/);
    if (todoMatch) {
      blocks.push({
        type: "to_do",
        to_do: {
          rich_text: parseInlineMarkdown(todoMatch[2]),
          checked: todoMatch[1].toLowerCase() === "x",
        },
      });
      i++;
      continue;
    }

    // Bulleted list: - or *
    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      blocks.push({
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: parseInlineMarkdown(bulletMatch[1]),
        },
      });
      i++;
      continue;
    }

    // Numbered list: 1. or 2.
    const numberedMatch = line.match(/^\d+\.\s+(.*)/);
    if (numberedMatch) {
      blocks.push({
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: parseInlineMarkdown(numberedMatch[1]),
        },
      });
      i++;
      continue;
    }

    // Blockquote: >
    const quoteMatch = line.match(/^>\s*(.*)/);
    if (quoteMatch) {
      blocks.push({
        type: "quote",
        quote: {
          rich_text: parseInlineMarkdown(quoteMatch[1]),
        },
      });
      i++;
      continue;
    }

    // Divider: --- or ***
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      blocks.push({ type: "divider", divider: {} });
      i++;
      continue;
    }

    // Bookmark: {{bookmark:url}} or {{bookmark:url|caption}}
    const bookmarkMatch = line.trim().match(/^\{\{bookmark:([^|}]+)(?:\|([^}]+))?\}\}$/);
    if (bookmarkMatch) {
      blocks.push({
        type: "bookmark",
        bookmark: {
          url: bookmarkMatch[1].trim(),
          caption: bookmarkMatch[2]
            ? [{ text: { content: bookmarkMatch[2].trim() } }]
            : [],
        },
      });
      i++;
      continue;
    }

    // Embed: {{embed:url}}
    const embedMatch = line.trim().match(/^\{\{embed:([^}]+)\}\}$/);
    if (embedMatch) {
      blocks.push({
        type: "embed",
        embed: {
          url: embedMatch[1].trim(),
        },
      });
      i++;
      continue;
    }

    // Image: ![alt](url)
    const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imageMatch) {
      blocks.push({
        type: "image",
        image: {
          type: "external",
          external: { url: imageMatch[2] },
          caption: imageMatch[1]
            ? [{ text: { content: imageMatch[1] } }]
            : [],
        },
      });
      i++;
      continue;
    }

    // Default: paragraph
    blocks.push({
      type: "paragraph",
      paragraph: {
        rich_text: parseInlineMarkdown(line),
      },
    });
    i++;
  }

  return blocks;
}

// ── Language Mapping ──────────────────────────────────────────────────────

function mapLanguage(lang: string): string {
  const map: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    rb: "ruby",
    sh: "bash",
    yml: "yaml",
    md: "markdown",
    "": "plain text",
  };
  return map[lang.toLowerCase()] || lang.toLowerCase();
}

// ── Page Title Helper ─────────────────────────────────────────────────────

export function getPageTitle(page: {
  properties: Record<string, unknown>;
}): string {
  const props = page.properties as Record<string, { type: string; title?: Array<{ plain_text: string }> }>;
  for (const [, prop] of Object.entries(props)) {
    if (prop.type === "title" && prop.title) {
      return prop.title.map((t) => t.plain_text).join("");
    }
  }
  return "Untitled";
}

// ── Property Formatting ───────────────────────────────────────────────────

export function formatProperty(prop: Record<string, unknown>): string {
  const type = prop.type as string;
  switch (type) {
    case "title": {
      const items = prop.title as Array<{ plain_text: string }> | undefined;
      return items?.map((t) => t.plain_text).join("") ?? "";
    }
    case "rich_text": {
      const items = prop.rich_text as Array<{ plain_text: string }> | undefined;
      return items?.map((t) => t.plain_text).join("") ?? "";
    }
    case "number":
      return String(prop.number ?? "");
    case "select": {
      const sel = prop.select as { name: string } | null;
      return sel?.name ?? "";
    }
    case "multi_select": {
      const items = prop.multi_select as Array<{ name: string }> | undefined;
      return items?.map((s) => s.name).join(", ") ?? "";
    }
    case "date": {
      const date = prop.date as { start: string; end?: string | null } | null;
      if (!date) return "";
      return date.end ? `${date.start} → ${date.end}` : date.start;
    }
    case "checkbox":
      return prop.checkbox ? "Yes" : "No";
    case "url":
      return (prop.url as string) ?? "";
    case "email":
      return (prop.email as string) ?? "";
    case "phone_number":
      return (prop.phone_number as string) ?? "";
    case "status": {
      const status = prop.status as { name: string } | null;
      return status?.name ?? "";
    }
    case "people": {
      const people = prop.people as Array<{ name?: string; id: string }> | undefined;
      return people?.map((p) => p.name || p.id).join(", ") ?? "";
    }
    case "relation": {
      const relations = prop.relation as Array<{ id: string }> | undefined;
      return relations?.map((r) => r.id).join(", ") ?? "";
    }
    case "formula": {
      const formula = prop.formula as Record<string, unknown> | undefined;
      if (!formula) return "";
      const fType = formula.type as string;
      return String(formula[fType] ?? "");
    }
    case "rollup": {
      const rollup = prop.rollup as Record<string, unknown> | undefined;
      if (!rollup) return "";
      const rType = rollup.type as string;
      return String(rollup[rType] ?? "");
    }
    case "created_time":
      return (prop.created_time as string) ?? "";
    case "last_edited_time":
      return (prop.last_edited_time as string) ?? "";
    case "created_by":
    case "last_edited_by": {
      const user = prop[type] as { name?: string; id: string } | undefined;
      return user?.name || user?.id || "";
    }
    case "files": {
      const files = prop.files as Array<{ name: string; type: string; file?: { url: string }; external?: { url: string } }> | undefined;
      return files?.map((f) => {
        const url = f.type === "external" ? f.external?.url : f.file?.url;
        return `[${f.name}](${url})`;
      }).join(", ") ?? "";
    }
    default:
      return `(${type})`;
  }
}
