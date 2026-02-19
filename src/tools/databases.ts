import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { notion, apiCall, isFullPage, isFullDatabase } from "../notion-client.js";
import { getPageTitle, formatProperty } from "../markdown.js";

export function registerDatabaseTools(server: McpServer) {
  // ── list_databases ────────────────────────────────────────────────────

  server.tool(
    "list_databases",
    "List all databases the integration can access in the workspace.",
    {
      limit: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results (default 20)"),
    },
    async ({ limit }) => {
      try {
        const response = await apiCall(() =>
          notion.search({
            filter: { property: "object", value: "database" },
            page_size: limit ?? 20,
            sort: { timestamp: "last_edited_time", direction: "descending" },
          })
        );

        const lines: string[] = [];
        for (const result of response.results) {
          if (isFullDatabase(result)) {
            const title =
              result.title.map((t) => t.plain_text).join("") || "Untitled";
            const propCount = Object.keys(result.properties).length;
            const edited = result.last_edited_time.slice(0, 10);
            lines.push(
              `- **${title}** (id: ${result.id}, ${propCount} properties, edited: ${edited})`
            );
          }
        }

        if (lines.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No databases found. Make sure you've shared databases with the integration.",
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `## Databases\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Error listing databases: ${error}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ── get_database ──────────────────────────────────────────────────────

  server.tool(
    "get_database",
    "Get a database's schema — property names, types, and options.",
    {
      database_id: z.string().describe("The database ID"),
    },
    async ({ database_id }) => {
      try {
        const db = await apiCall(() =>
          notion.databases.retrieve({ database_id })
        );

        if (!isFullDatabase(db)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Could not retrieve full database info",
              },
            ],
            isError: true,
          };
        }

        const title =
          db.title.map((t) => t.plain_text).join("") || "Untitled";
        const lines: string[] = [`## Database: ${title}\n`, `ID: ${db.id}\n`];

        lines.push("### Properties\n");
        for (const [name, prop] of Object.entries(db.properties)) {
          const p = prop as { type: string; [key: string]: unknown };
          let detail = `**${name}** (${p.type})`;

          // Show select/multi-select options
          if (p.type === "select" && p.select) {
            const opts = (p.select as { options: Array<{ name: string }> })
              .options;
            if (opts?.length > 0) {
              detail += `: ${opts.map((o) => o.name).join(", ")}`;
            }
          }
          if (p.type === "multi_select" && p.multi_select) {
            const opts = (
              p.multi_select as { options: Array<{ name: string }> }
            ).options;
            if (opts?.length > 0) {
              detail += `: ${opts.map((o) => o.name).join(", ")}`;
            }
          }
          if (p.type === "status" && p.status) {
            const opts = (p.status as { options: Array<{ name: string }> })
              .options;
            if (opts?.length > 0) {
              detail += `: ${opts.map((o) => o.name).join(", ")}`;
            }
          }

          lines.push(`- ${detail}`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting database: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── query_database ────────────────────────────────────────────────────

  server.tool(
    "query_database",
    "Query a Notion database with optional filter and sort. Returns results as a Markdown table.",
    {
      database_id: z.string().describe("The database ID to query"),
      filter: z
        .string()
        .optional()
        .describe(
          "JSON filter object (Notion API format). Example: {\"property\": \"Status\", \"select\": {\"equals\": \"Done\"}}"
        ),
      sort_property: z
        .string()
        .optional()
        .describe("Property name to sort by"),
      sort_direction: z
        .enum(["ascending", "descending"])
        .optional()
        .describe("Sort direction (default descending)"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results (default 20)"),
    },
    async ({ database_id, filter, sort_property, sort_direction, limit }) => {
      try {
        const params: Record<string, unknown> = {
          database_id,
          page_size: limit ?? 20,
        };

        if (filter) {
          try {
            params.filter = JSON.parse(filter);
          } catch {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: Invalid JSON filter. Provide a valid Notion API filter object.",
                },
              ],
              isError: true,
            };
          }
        }

        if (sort_property) {
          params.sorts = [
            {
              property: sort_property,
              direction: sort_direction ?? "descending",
            },
          ];
        }

        const response = await apiCall(() =>
          notion.databases.query(
            params as Parameters<typeof notion.databases.query>[0]
          )
        );

        if (response.results.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No results found." },
            ],
          };
        }

        // Collect all property names from first result
        const firstResult = response.results[0];
        if (!isFullPage(firstResult)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Could not read database results.",
              },
            ],
            isError: true,
          };
        }

        const propNames = Object.keys(firstResult.properties);

        // Build Markdown table
        const header = `| ${propNames.join(" | ")} |`;
        const separator = `| ${propNames.map(() => "---").join(" | ")} |`;

        const rows: string[] = [];
        for (const result of response.results) {
          if (!isFullPage(result)) continue;
          const props = result.properties as Record<
            string,
            Record<string, unknown>
          >;
          const cells = propNames.map((name) => {
            const prop = props[name];
            if (!prop) return "";
            return formatProperty(prop).replace(/\|/g, "\\|").replace(/\n/g, " ");
          });
          rows.push(`| ${cells.join(" | ")} |`);
        }

        const table = [header, separator, ...rows].join("\n");
        const summary = `${response.results.length} result(s)${response.has_more ? " (more available)" : ""}`;

        return {
          content: [
            {
              type: "text" as const,
              text: `## Query Results (${summary})\n\n${table}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error querying database: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
