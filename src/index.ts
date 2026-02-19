#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerPageTools } from "./tools/pages.js";
import { registerBlockTools } from "./tools/blocks.js";
import { registerDatabaseTools } from "./tools/databases.js";
import { registerMiscTools } from "./tools/misc.js";

const server = new McpServer({
  name: "notion",
  version: "1.0.0",
});

registerPageTools(server);
registerBlockTools(server);
registerDatabaseTools(server);
registerMiscTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
