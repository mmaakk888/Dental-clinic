process.env.NODE_ENV = 'production';
const { startServer } = await import('../build/server.cjs');
await startServer();
