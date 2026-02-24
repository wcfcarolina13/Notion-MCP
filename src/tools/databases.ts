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

  // ── create_database ─────────────────────────────────────────────────

  server.tool(
    "create_database",
    "Create a new Notion database under a parent page. Define the schema with typed properties (title, text, number, select, multi_select, date, checkbox, url, email, phone_number, status, etc.).",
    {
      parent_id: z
        .string()
        .describe("The page ID to create the database under"),
      title: z.string().describe("Database title"),
      properties: z
        .string()
        .describe(
          'JSON object defining properties. Each key is a property name, value is the config. ' +
          'The database MUST have exactly one "title" property. ' +
          'Examples: {"Name":{"title":{}},"URL":{"url":{}},"Status":{"select":{"options":[{"name":"New"},{"name":"Done"}]}},' +
          '"Tags":{"multi_select":{"options":[{"name":"AI"},{"name":"Web"}]}},"Priority":{"number":{}},' +
          '"Due":{"date":{}},"Done":{"checkbox":{}},"Notes":{"rich_text":{}}}'
        ),
      is_inline: z
        .boolean()
        .optional()
        .describe(
          "If true, creates an inline database (embedded in the page). Default false (full-page database)."
        ),
    },
    async ({ parent_id, title, properties, is_inline }) => {
      try {
        let propsObj: Record<string, unknown>;
        try {
          propsObj = JSON.parse(properties);
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: 'Error: Invalid JSON in properties. Provide a valid JSON object. Example: {"Name":{"title":{}},"URL":{"url":{}}}',
              },
            ],
            isError: true,
          };
        }

        // Validate that exactly one title property exists
        const titleProps = Object.entries(propsObj).filter(
          ([, v]) => typeof v === "object" && v !== null && "title" in (v as Record<string, unknown>)
        );
        if (titleProps.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: 'Error: Database must have exactly one property with {"title":{}}. Example: {"Name":{"title":{}}}',
              },
            ],
            isError: true,
          };
        }

        const db = await apiCall(() =>
          notion.databases.create({
            parent: { type: "page_id", page_id: parent_id },
            title: [{ type: "text", text: { content: title } }],
            properties: propsObj as Parameters<
              typeof notion.databases.create
            >[0]["properties"],
            is_inline: is_inline ?? false,
          })
        );

        // Summarize created schema
        const createdProps = isFullDatabase(db)
          ? Object.entries(db.properties)
              .map(([name, prop]) => `  - ${name} (${(prop as { type: string }).type})`)
              .join("\n")
          : "(could not read schema)";

        return {
          content: [
            {
              type: "text" as const,
              text: `Database created: **${title}**\n\nID: ${db.id}\nParent: ${parent_id}\nInline: ${is_inline ?? false}\n\nProperties:\n${createdProps}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating database: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
