import "./config/env.js";

import { randomUUID } from "node:crypto";

import {
  prisma,
} from "./database/prisma.js";

type RespostaWebhook = {
  erro?: string;
};

function obterConfiguracaoWebhook(): {
  secret: string;
  port: number;
} {
  const secret =
    process.env.BOTNEXT_WEBHOOK_SECRET?.trim();

  const port = Number(
    process.env.BOTNEXT_WEBHOOK_PORT ??
      "3333",
  );

  if (
    !secret ||
    !/^[a-f0-9]{64}$/.test(secret)
  ) {
    throw new Error(
      "BOTNEXT_WEBHOOK_SECRET inválido.",
    );
  }

  if (
    !Number.isInteger(port) ||
    port <= 0
  ) {
    throw new Error(
      "BOTNEXT_WEBHOOK_PORT inválida.",
    );
  }

  return {
    secret,
    port,
  };
}

async function executarTeste(): Promise<void> {
  console.log(
    "Testando bloqueio de companyId desconhecido...",
  );

  const config =
    obterConfiguracaoWebhook();

  const companyIdDesconhecido =
    randomUUID();

  const externalMessageId =
    randomUUID();

  const payload = {
    eventType: "MESSAGE_RECEIVED",
    date: new Date().toISOString(),

    content: {
      id: externalMessageId,
      companyId:
        companyIdDesconhecido,
      sessionId: randomUUID(),
      type: "TEXT",
      active: true,
      text:
        "Teste local de conta desconhecida",
      direction: "FROM_HUB",

      details: {
        from: "+5541999999999",
        to: "+5541888888888",
      },
    },

    changeMetadata: null,
  };

  const url =
    `http://127.0.0.1:${config.port}` +
    `/webhooks/botnext/${config.secret}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type":
        "application/json",
    },
    body: JSON.stringify(payload),
  });

  const resultado =
    (await response.json()) as RespostaWebhook;

  if (response.status !== 403) {
    throw new Error(
      `Esperado HTTP 403, recebido HTTP ${response.status}.`,
    );
  }

  if (
    resultado.erro !==
    "Acesso negado."
  ) {
    throw new Error(
      "Resposta de acesso negado fora do formato esperado.",
    );
  }

  console.log(
    "OK: conta desconhecida recebeu HTTP 403.",
  );

  const quantidadeSalva =
    await prisma.botnextWebhookEvent.count({
      where: {
        companyId:
          companyIdDesconhecido,
        externalMessageId,
      },
    });

  if (quantidadeSalva !== 0) {
    throw new Error(
      "Um evento não autorizado foi salvo no banco.",
    );
  }

  console.log(
    "OK: nenhum evento não autorizado foi salvo.",
  );

  console.log(
    "Teste concluído sem envio ao BotNext ou escrita no ArBrain.",
  );
}

executarTeste()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido";

    console.error(
      `Falha no teste: ${mensagem}`,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });