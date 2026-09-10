import http from 'node:http';
import { loadConfig } from './config.js';
import { runAgentWithRetry, type AgentEvent } from './agent.js';

const config = loadConfig({}, { skipApiKey: true });
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';
const API_SECRET = process.env.AGENT_API_SECRET;
const MAX_BODY = 1 * 1024 * 1024; // 1 MB

if (!API_SECRET) {
  console.warn(
    'WARNING: AGENT_API_SECRET is not set. All requests will be rejected with 401.\n' +
    'Set AGENT_API_SECRET=<secret> and send `Authorization: Bearer <secret>` on every request.'
  );
}

function corsHeaders(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const server = http.createServer(async (req, res) => {
  corsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url ?? '', `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/chat') {
    if (API_SECRET && req.headers.authorization !== `Bearer ${API_SECRET}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    let bodyString = '';
    req.setEncoding('utf-8');
    
    const bodyPromise = new Promise<{ prompt?: string; messages?: any[]; stream?: boolean }>((resolve, reject) => {
      req.on('data', (chunk) => {
        bodyString += chunk;
        if (bodyString.length > MAX_BODY) {
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(bodyString || '{}'));
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', (err) => {
        reject(err);
      });
    });

    let body;
    try {
      body = await bodyPromise;
    } catch (err: any) {
      res.writeHead(err.message === 'Payload too large' ? 413 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }

    const { prompt, messages = [], stream = false } = body;
    const input = messages.length > 0 ? messages : prompt;

    if (!input) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Provide "prompt" (string) or "messages" (array)' }));
      return;
    }

    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      try {
        const result = await runAgentWithRetry(config, input, {
          onEvent: (event: AgentEvent) => {
            if (event.type === 'text') {
              const data = JSON.stringify({ type: 'text', content: event.delta });
              res.write(`data: ${data}\n\n`);
            }
          },
        });
        const done = JSON.stringify({ type: 'done', usage: result.usage });
        res.write(`data: ${done}\n\n`);
      } catch (err: any) {
        const error = JSON.stringify({ type: 'error', message: err.message });
        res.write(`data: ${error}\n\n`);
      } finally {
        res.end();
      }
      return;
    }

    // Non-streaming request
    try {
      const result = await runAgentWithRetry(config, input);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: result.text, usage: result.usage }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Agent server listening on http://localhost:${PORT}`);
});
