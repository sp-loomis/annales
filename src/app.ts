import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { type AppConfig, configFromEnv } from './config.js';
import { AppError } from './lib/errors.js';
import { Storage } from './lib/storage.js';
import { healthRoutes } from './routes/health.js';
import { worldRoutes } from './routes/worlds.js';
import { entryRoutes } from './routes/entries.js';
import { entryTypeRoutes } from './routes/entry-types.js';
import { sectionRoutes } from './routes/sections.js';
import { artifactRoutes } from './routes/artifacts.js';
import { worldConfigRoutes } from './routes/world-config.js';
import { calendarRoutes } from './routes/calendars.js';
import { dateRangeRoutes } from './routes/date-ranges.js';
import { relationRoutes } from './routes/relations.js';
import { searchRoutes } from './routes/search.js';
import { worldThemeRoutes } from './routes/world-theme.js';
import { workspaceStateRoutes } from './routes/workspace-state.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    store: Storage;
    appConfig: AppConfig;
  }
}

export async function buildApp(overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
  const config = configFromEnv(overrides);
  const app = Fastify({
    logger: false,
    ajv: { customOptions: { allowUnionTypes: true } },
  });

  const prisma = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  const store = new Storage(config);
  app.decorate('prisma', prisma);
  app.decorate('store', store);
  app.decorate('appConfig', config);
  app.addHook('onClose', async () => {
    await prisma.$disconnect();
    store.close();
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.validation || (err.statusCode && err.statusCode >= 400 && err.statusCode < 500)) {
      return reply
        .code(err.statusCode ?? 400)
        .send({ error: { code: 'VALIDATION', message: err.message, details: {} } });
    }
    req.log.error(err);
    return reply
      .code(500)
      .send({ error: { code: 'INTERNAL', message: 'internal error', details: {} } });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `route ${req.method} ${req.url} not found`, details: {} },
    })
  );

  healthRoutes(app);
  worldRoutes(app);
  entryRoutes(app);
  entryTypeRoutes(app);
  sectionRoutes(app);
  artifactRoutes(app);
  worldConfigRoutes(app);
  calendarRoutes(app);
  dateRangeRoutes(app);
  relationRoutes(app);
  searchRoutes(app);
  worldThemeRoutes(app);
  workspaceStateRoutes(app);

  return app;
}
