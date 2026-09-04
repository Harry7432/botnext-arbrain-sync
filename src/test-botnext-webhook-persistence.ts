import "dotenv/config";

import { randomUUID } from "node:crypto";

import { prisma } from "./database/prisma.js";

type RespostaWebhook = {
  recebido?: boolean;
  persistido?: boolean;
  duplicado?: boolean;
  erro?: string;
};

function obterConfiguracaoWebhook(): {
  secret: string;
  port: number;
} {
  const secret =
    process.env.BOTNEXT_WEBHOOK_SECRET?.trim();

  const port = Number(
    process.env.BOTNEXT_WEBHOOK_PORT ?? "3333",
  );

  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) {
    throw new Error(
      "BOTNEXT_WEBHOOK_SECRET inválido no .env.",
    );
  }

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      "BOTNEXT_WEBHOOK_PORT inválida no .env.",
    );
  }

  return {
    secret,
    port,
  };
}

async function enviarEvento(
  url: string,
  payload: Record<string, unknown>,
): Promise<RespostaWebhook> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const resultado =
    (await response.json()) as RespostaWebhook;

  if (!response.ok) {
    throw new Error(
      `Webhook respondeu HTTP ${response.status}: ${
        resultado.erro ?? "erro desconhecido"
      }`,
    );
  }

  return resultado;
}

async function executarTeste(): Promise<void> {
  console.log(
    "Testando persistência e deduplicação do webhook...",
  );

  const config = obterConfiguracaoWebhook();

  const externalMessageId = randomUUID();
  const companyId = randomUUID();
  const sessionId = randomUUID();

  const payload = {
    eventType: "MESSAGE_RECEIVED",
    date: new Date().toISOString(),

    content: {
      id: externalMessageId,
      companyId,
      sessionId,
      type: "TEXT",
      active: true,
      text: "Mensagem local de teste",
      direction: "FROM_HUB",

      details: {
        from: "+5500000000001",
        to: "+5500000000002",
      },
    },

    changeMetadata: null,
  };

  const url =
    `http://127.0.0.1:${config.port}` +
    `/webhooks/botnext/${config.secret}`;

  const primeiraResposta = await enviarEvento(
    url,
    payload,
  );

  if (
    primeiraResposta.persistido !== true ||
    primeiraResposta.duplicado !== false
  ) {
    throw new Error(
      "A primeira entrega não foi persistida como esperado.",
    );
  }

  console.log(
    "OK: primeira entrega persistida.",
  );

  const segundaResposta = await enviarEvento(
    url,
    payload,
  );

  if (
    segundaResposta.persistido !== false ||
    segundaResposta.duplicado !== true
  ) {
    throw new Error(
      "A segunda entrega não foi reconhecida como duplicada.",
    );
  }

  console.log(
    "OK: segunda entrega reconhecida como duplicada.",
  );

  const quantidadeSalva =
    await prisma.botnextWebhookEvent.count({
      where: {
        tenant: {
          slug: "lrc",
        },
        companyId,
        eventType: "MESSAGE_RECEIVED",
        externalMessageId,
      },
    });

  if (quantidadeSalva !== 1) {
    throw new Error(
      `Esperado 1 registro, mas foram encontrados ${quantidadeSalva}.`,
    );
  }

  console.log(
    "OK: apenas um registro existe no PostgreSQL.",
  );

  console.log(
    "Nenhuma IA, resposta BotNext ou escrita no ArBrain foi executada.",
  );
}

executarTeste()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido";

    console.error(`Falha no teste: ${mensagem}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });