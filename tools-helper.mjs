// Docket's tools for one Claude session, as their own small program (an MCP server on stdio).
// It knows nothing about the tools themselves: it asks the Docket app for the list and passes
// every call to the app. So adding or changing a tool never needs a change here, and while the
// app is restarting a call waits for it to come back instead of failing.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const APP = process.env.DOCKET_URL;
const SESSION = process.env.DOCKET_SESSION;
const TOKEN = process.env.DOCKET_TOKEN;
const WAIT_FOR_APP_MS = 3 * 60 * 1000;

// Ask the app; if it is not answering (restarting), keep trying for a while.
async function ask(pathname, body) {
  const until = Date.now() + WAIT_FOR_APP_MS;
  for (;;) {
    try {
      const r = await fetch(APP + pathname, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', 'x-docket-token': TOKEN },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json();
      if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { final: true });
      return j;
    } catch (e) {
      if (e.final || Date.now() > until) throw e;
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
}

const server = new Server({ name: 'portal', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await ask(`/api/tools?session=${encodeURIComponent(SESSION)}`) }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try { return await ask('/api/tools/call', { session: SESSION, name: req.params.name, args: req.params.arguments || {} }); }
  catch (e) { return { content: [{ type: 'text', text: `Docket could not run ${req.params.name}: ${e.message}` }], isError: true }; }
});
await server.connect(new StdioServerTransport());
