# Notion MCP

A Markdown-native MCP server for Notion. Read, write, search, and organize your entire Notion workspace from Claude — Code, Desktop, or any MCP-compatible client.

## Why This Exists

Notion wants you to pay for their built-in AI. This MCP server gives Claude direct access to your Notion data instead. The official `@notionhq/notion-mcp-server` returns raw JSON block objects that eat context windows alive. This server converts everything to and from Markdown, making responses **5-10x more token-efficient** while being natural for LLMs to read and produce.

**What you get:** 19 tools covering full CRUD on pages, blocks, databases, comments, and users — all speaking Markdown.

## Quick Start

```bash
# Clone
git clone https://github.com/wcfcarolina13/Notion-MCP.git
cd Notion-MCP

# Install
npm install

# Configure (see Authentication below)
cp .env.example .env
# Add your NOTION_API_TOKEN to .env
```

## Authentication

You need a Notion internal integration token. Takes about 2 minutes:

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **New integration**
3. Name it whatever you want (e.g. "Claude MCP")
4. Select your workspace
5. Under **Capabilities**, enable:
   - **Read content**
   - **Update content**
   - **Insert content**
   - **Read comments**
   - **Read user information without email addresses**
6. Click **Submit** → copy the **Internal Integration Secret** (starts with `secret_`)

**Important:** You must share each page/database with the integration for it to be accessible:

> Open the page in Notion → click **...** (top-right) → **Connections** → **Connect to** → select your integration name

Share a top-level page and all child pages inherit access.

## Configuration

### Claude Code / Claude Desktop

Add to your `.mcp.json` (project-level) or Claude Desktop config:

```json
{
  "mcpServers": {
    "notion": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/Notion-MCP/src/index.ts"],
      "env": {
        "NOTION_API_TOKEN": "secret_your_token_here"
      }
    }
  }
}
```

A template is provided in `.mcp.json.example` — copy it to `.mcp.json` and fill in the absolute path and token.

### Environment Variable

Alternatively, set `NOTION_API_TOKEN` in your shell or `.env` file and the server picks it up automatically.

## Tools (18)

### Pages & Search

| Tool | Parameters | Description |
|------|-----------|-------------|
| `search` | `query`, `filter?` (page/database), `limit?` | Search workspace by title. Returns names, IDs, last-edited dates. |
| `get_page` | `page_id`, `include_properties?` | Fetch full page as Markdown — recursively walks all blocks, renders tables, toggles, code, images, everything. |
| `create_page` | `parent_id`, `parent_type`, `title`, `content?`, `icon?` | Create a page. Pass Markdown in `content` and it auto-converts to Notion blocks. |
| `update_page` | `page_id`, `title?`, `icon?`, `cover_url?` | Update page properties — title, emoji icon, or cover image URL. |
| `archive_page` | `page_id`, `archived` | Archive (`true`) or restore (`false`) a page. |

### Blocks (Content Editing)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `append_blocks` | `block_id`, `content` | Append Markdown to a page/block — headings, lists, code fences, checkboxes, quotes, images, dividers all convert correctly. |
| `insert_after_block` | `block_id`, `after`, `content` | Insert Markdown content after a specific block within a page. Like `append_blocks` but positions content at a precise location. Use `list_children_blocks` first to find the target block ID. |
| `update_block` | `block_id`, `content` | Update a specific block's text. Preserves the block type (heading stays a heading, etc.). Supports inline Markdown. |
| `delete_block` | `block_id` | Delete a block by ID. |
| `list_children_blocks` | `block_id` | List all child blocks with IDs, types, has_children flags, and content previews. Essential for programmatic page manipulation. |
| `replace_page_content` | `page_id`, `content` | Atomic rewrite — deletes all existing blocks then appends new Markdown content in one call. |
| `batch_delete_blocks` | `block_ids` (array) | Delete multiple blocks in one call. Tolerates individual failures and reports results. |

### Databases

| Tool | Parameters | Description |
|------|-----------|-------------|
| `list_databases` | `limit?` | List all databases the integration can see. |
| `get_database` | `database_id` | Get the full schema — property names, types, and select/multi-select/status options. |
| `query_database` | `database_id`, `filter?`, `sort_property?`, `sort_direction?`, `limit?` | Query with Notion API filters. Returns results as a Markdown table. |
| `create_database` | `parent_id`, `title`, `properties` (JSON), `is_inline?` | Create a new database under a page. Define schema with typed properties (title, text, number, select, multi_select, date, checkbox, url, status, etc.). |

### Collaboration

| Tool | Parameters | Description |
|------|-----------|-------------|
| `get_comments` | `block_id` | List all comments on a page or block. |
| `add_comment` | `page_id`, `text`, `discussion_id?` | Add a comment to a page, or reply to an existing discussion thread. |
| `get_users` | — | List all workspace members (name, type, email). |

## Markdown Conversion

The core differentiator. Two-way conversion between Notion's block tree and clean Markdown.

### Notion → Markdown (reading)

Supports 20+ block types:

| Block Type | Markdown Output |
|-----------|----------------|
| Paragraph | Plain text with inline formatting |
| Heading 1/2/3 | `#` / `##` / `###` |
| Bulleted list | `- item` |
| Numbered list | `1. item` |
| To-do | `- [x] done` / `- [ ] pending` |
| Code | Fenced code blocks with language |
| Quote | `> blockquote` |
| Callout | `> emoji text` |
| Divider | `---` |
| Image | `![caption](url)` |
| Bookmark | `[caption](url)` |
| Table | Full Markdown table with headers |
| Toggle | `<details><summary>` |
| Column layout | Rendered sequentially |
| Equations | `$$expression$$` |
| Child pages/databases | Named references with IDs |
| Embeds, video, file, PDF | Link references |

Rich text annotations preserved: **bold**, *italic*, `code`, ~~strikethrough~~, [links](url).

Nested blocks (children of toggles, lists, etc.) are indented and recursively rendered.

### Markdown → Notion (writing)

Line-by-line parser handles the patterns Claude typically produces:

- `# ## ###` → Headings
- `- item` / `* item` → Bulleted lists
- `1. item` → Numbered lists
- `- [x]` / `- [ ]` → To-do checkboxes
- Fenced code blocks → Code with language detection
- `> text` → Blockquotes
- `---` → Dividers
- `![alt](url)` → Images
- Inline: `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `[link](url)`

## Architecture

```
src/
├── index.ts              # MCP server entrypoint — registers all tools, connects stdio transport
├── notion-client.ts      # Notion SDK wrapper — auth, rate limiter, pagination helpers
├── markdown.ts           # Bidirectional Notion blocks ↔ Markdown + property formatting
└── tools/
    ├── pages.ts          # search, get_page, create_page, update_page, archive_page
    ├── blocks.ts         # append_blocks, insert_after_block, update_block, delete_block, list_children_blocks, replace_page_content, batch_delete_blocks
    ├── databases.ts      # list_databases, get_database, query_database, create_database
    └── misc.ts           # get_comments, add_comment, get_users
```

### Rate Limiting

Built-in token-bucket rate limiter: **3 requests/second**, burst capacity of 3, excess requests queued automatically. Sits on top of the Notion SDK's own retry/backoff for 429 responses. You don't need to think about it.

### Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP protocol implementation |
| `@notionhq/client` | Official Notion API SDK |
| `zod` | Runtime schema validation (bundled with MCP SDK) |
| `tsx` | TypeScript execution without build step |

## Development

```bash
# Run directly (development)
npm start

# Build TypeScript
npm run build

# Watch mode
npm run dev
```

## Ralph

This project uses the [Ralph methodology](CLAUDE.md) for autonomous, iterative development with Claude Code. State persists in files and git — not in conversation context.

- `RALPH_TASK.md` — Task definition and completion criteria
- `CLAUDE.md` — Agent instructions
- `.ralph/` — Guardrails, progress, error logs
- `scripts/` — Automation (`ralph-loop.sh`, `ralph-once.sh`)

## License

MIT
