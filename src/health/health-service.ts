import {
  Redis,
} from "ioredis";

import {
  env,
} from "../config/env.js";

import {
  prisma,
} from "../database/prisma.js";

type EstadoDependencia = {
  status: "ok" | "erro";
  latenciaMs: number;
};

export type ResultadoSaude = {
  status: "ok" | "degradado";
  postgres: EstadoDependencia;
  redis: EstadoDependencia;
};

async function verificarPostgres():
  Promise<EstadoDependencia> {
  const inicio = Date.now();

  try {
    await prisma.$queryRaw`
      SELECT 1
    `;

    return {
      status: "ok",
      latenciaMs:
        Date.now() - inicio,
    };
  } catch {
    return {
      status: "erro",
      latenciaMs:
        Date.now() - inicio,
    };
  }
}

async function verificarRedis():
  Promise<EstadoDependencia> {
  const inicio = Date.now();

  const cliente = new Redis(
    env.REDIS_URL,
    {
      lazyConnect: true,
      connectTimeout: 2_000,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,

      retryStrategy: () => null,
    },
  );

  try {
    await cliente.connect();

    const resposta =
      await cliente.ping();

    return {
      status:
        resposta === "PONG"
          ? "ok"
          : "erro",

      latenciaMs:
        Date.now() - inicio,
    };
  } catch {
    return {
      status: "erro",
      latenciaMs:
        Date.now() - inicio,
    };
  } finally {
    cliente.disconnect();
  }
}

export async function verificarSaude():
  Promise<ResultadoSaude> {
  const [
    postgres,
    redis,
  ] = await Promise.all([
    verificarPostgres(),
    verificarRedis(),
  ]);

  return {
    status:
      postgres.status === "ok" &&
      redis.status === "ok"
        ? "ok"
        : "degradado",

    postgres,
    redis,
  };
}