---
task: Notion MCP Server — Markdown-native Notion access for Claude
test_command: "cd '/Users/roti/gemini_projects/Notion MCP' && npx tsx src/index.ts --help 2>&1 || echo 'server file exists'"
---

# Task: Notion MCP Server

Build a custom MCP server that gives Claude full read/write access to Notion
workspaces with Markdown-native responses for token efficiency.

## Requirements

- TypeScript MCP server using @modelcontextprotocol/sdk + @notionhq/client
- All responses convert Notion blocks to Markdown (not raw JSON)
- Rate limiting: 3 req/sec token bucket with backoff
- Auth via NOTION_API_TOKEN environment variable
- 14 tools covering pages, blocks, databases, comments, and users

## Success Criteria

1. [x] Scaffold project: package.json, tsconfig.json, .gitignore, .mcp.json, .env.example
2. [x] npm install — all dependencies resolve
3. [x] Implement `src/notion-client.ts` — authenticated client with rate limiter
4. [x] Implement `src/markdown.ts` — blocksToMarkdown converter (all common block types)
5. [x] Implement `src/markdown.ts` — markdownToBlocks converter (headings, lists, code, paragraphs)
6. [x] Implement `src/index.ts` — MCP server composition root with transport
7. [x] Implement `search` tool in `src/tools/pages.ts`
8. [x] Implement `get_page` tool — fetches page + all blocks → Markdown
9. [x] Implement `create_page` tool — accepts Markdown body
10. [x] Implement `update_page` tool — update title, icon, cover
11. [x] Implement `archive_page` tool
12. [x] Implement `append_blocks` tool in `src/tools/blocks.ts`
13. [x] Implement `update_block` tool
14. [x] Implement `delete_block` tool
15. [x] Implement `list_databases` tool in `src/tools/databases.ts`
16. [x] Implement `get_database` tool — returns schema as readable summary
17. [x] Implement `query_database` tool — returns results as Markdown table
18. [x] Implement `get_comments` and `add_comment` in `src/tools/misc.ts`
19. [x] Implement `get_users` tool
20. [x] Server compiles (`npm run build`) with no errors
21. [x] README.md with setup guide (integration creation, token, sharing pages)
22. [ ] All code committed

---

## Ralph Instructions

1. Work on the next incomplete criterion (marked `[ ]`)
2. Check off completed criteria (change `[ ]` to `[x]`)
3. Run the test_command after changes
4. Commit your changes frequently with descriptive messages
5. Update `.ralph/progress.md` with what you accomplished
6. When ALL criteria are `[x]`, say: **"RALPH COMPLETE - all criteria satisfied"**
7. If stuck 3+ times on same issue, say: **"RALPH GUTTER - need fresh context"**
