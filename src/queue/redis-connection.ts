import type {
  ConnectionOptions,
} from "bullmq";

import {
  Redis,
} from "ioredis";

function obterRedisUrl(): string {
  const valor = process.env.REDIS_URL?.trim();

  if (!valor) {
    throw new Error("REDIS_URL não configurada.");
  }

  const url = new URL(valor);

  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL deve usar redis:// ou rediss://.");
  }

  return valor;
}

function obterBancoRedis(url: URL): number {
  const caminho = url.pathname.replace(/^\/+/, "");

  if (!caminho) {
    return 0;
  }

  const banco = Number(caminho);

  return Number.isInteger(banco) && banco >= 0
    ? banco
    : 0;
}

// O servidor usa esta conexão para produzir trabalhos.
// A fila deve falhar rapidamente quando o Redis estiver indisponível.
export function criarConexaoRedisProdutor(): Redis {
  return new Redis(
    obterRedisUrl(),
    {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    },
  );
}

// O BullMQ será proprietário da conexão do worker.
// Assim, ele poderá recriá-la automaticamente após uma queda do Redis.
export function criarConexaoRedisWorker():
  ConnectionOptions {
  const url = new URL(obterRedisUrl());

  const porta = url.port
    ? Number(url.port)
    : 6379;

  const usuario = url.username
    ? decodeURIComponent(url.username)
    : null;

  const senha = url.password
    ? decodeURIComponent(url.password)
    : null;

  return {
    host: url.hostname,
    port: porta,
    db: obterBancoRedis(url),

    ...(usuario
      ? {
          username: usuario,
        }
      : {}),

    ...(senha
      ? {
          password: senha,
        }
      : {}),

    ...(url.protocol === "rediss:"
      ? {
          tls: {},
        }
      : {}),

    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
}
