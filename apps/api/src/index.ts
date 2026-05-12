import { createServer } from 'node:http';

const port = Number(process.env.SCHEDULER_PORT ?? 4100);

const server = createServer((_req, res) => {
  res.writeHead(503, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      success: false,
      error: 'control-plane not implemented yet — see docs/architecture.md',
    }),
  );
});

server.listen(port, () => {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      msg: `control-plane stub listening on :${port}`,
    }),
  );
});

const shutdown = (signal: NodeJS.Signals) => {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      msg: `received ${signal}, shutting down`,
    }),
  );
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
