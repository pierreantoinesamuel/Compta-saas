import 'dotenv/config';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '../server/index.js';

type FastifyApp = ReturnType<typeof buildApp>;

let instance: FastifyApp | null = null;

async function getApp(): Promise<FastifyApp> {
  if (!instance) {
    instance = buildApp();
    await instance.ready();
  }
  return instance;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  app.server.emit('request', req, res);
}
