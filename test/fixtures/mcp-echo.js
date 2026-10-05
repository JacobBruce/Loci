import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'loci-echo', version: '0.0.1' });

server.registerTool('echo', {
	description: 'Echo a string',
	inputSchema: { text: z.string() },
	annotations: { readOnlyHint: false }
}, async ({ text }) => ({
	content: [{ type: 'text', text: String(text) }]
}));

server.registerTool('ping', {
	description: 'Return pong',
	annotations: { readOnlyHint: true }
}, async () => ({
	content: [{ type: 'text', text: 'pong' }]
}));

const transport = new StdioServerTransport();
await server.connect(transport);
