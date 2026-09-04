import { env } from "./config/env.js";

import { randomUUID } from "node:crypto";

import { prisma } from "./database/prisma.js";

import {
  normalizarTelefoneBrasil,
} from "./visitas/telefone-service.js";

type RespostaWebhook = {
  recebido?: boolean;
  persistido?: boolean;
  duplicado?: boolean;
  processado?: boolean;
  status?: string;
  clienteIdentificado?: boolean;
  erro?: string;
};

type ClienteDoTeste = {
  id: string;
  celular: string | null;
  telefone: string | null;
};

function obterConfiguracao(): {
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

function localizarContatoExclusivo(
  clientes: ClienteDoTeste[],
): {
  clienteId: string;
  telefone: string;
} | null {
  const clientesPorTelefone =
    new Map<string, Set<string>>();

  for (const cliente of clientes) {
    const numerosDoCliente =
      new Set<string>();

    const celular =
      normalizarTelefoneBrasil(
        cliente.celular,
      );

    const telefone =
      normalizarTelefoneBrasil(
        cliente.telefone,
      );

    if (celular) {
      numerosDoCliente.add(
        celular.numeroComCodigoPais,
      );
    }

    if (telefone) {
      numerosDoCliente.add(
        telefone.numeroComCodigoPais,
      );
    }

    for (
      const numero of numerosDoCliente
    ) {
      const clientesDoNumero =
        clientesPorTelefone.get(numero) ??
        new Set<string>();

      clientesDoNumero.add(cliente.id);

      clientesPorTelefone.set(
        numero,
        clientesDoNumero,
      );
    }
  }

  for (
    const [
      telefone,
      clientesDoNumero,
    ] of clientesPorTelefone
  ) {
    if (clientesDoNumero.size !== 1) {
      continue;
    }

    const clienteId =
      clientesDoNumero
        .values()
        .next()
        .value;

    if (clienteId) {
      return {
        clienteId,
        telefone,
      };
    }
  }

  return null;
}

async function enviarEvento(
  url: string,
  payload: Record<string, unknown>,
): Promise<RespostaWebhook> {
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

  if (!response.ok) {
    throw new Error(
      `Webhook respondeu HTTP ${
        response.status
      }: ${
        resultado.erro ??
        "erro desconhecido"
      }`,
    );
  }

  return resultado;
}

async function executarTeste(): Promise<void> {
  console.log(
    "Testando identificação local do cliente...",
  );

  const tenant =
    await prisma.tenant.findUnique({
      where: {
        slug: "lrc",
      },
      select: {
        id: true,
        active: true,
      },
    });

  if (!tenant) {
    throw new Error(
      "Tenant LRC não encontrado.",
    );
  }

  if (!tenant.active) {
    throw new Error(
      "Tenant LRC está inativo.",
    );
  }

  const clientes =
    await prisma.cliente.findMany({
      where: {
        tenantId: tenant.id,
        OR: [
          {
            celular: {
              not: null,
            },
          },
          {
            telefone: {
              not: null,
            },
          },
        ],
      },
      select: {
        id: true,
        celular: true,
        telefone: true,
      },
    });

  const contato =
    localizarContatoExclusivo(clientes);

  if (!contato) {
    throw new Error(
      "Nenhum telefone exclusivo foi encontrado para o teste.",
    );
  }

  const config =
    obterConfiguracao();

  const externalMessageId =
    randomUUID();

  const companyId =
    env.BOTNEXT_COMPANY_ID;

  const payload = {
    eventType: "MESSAGE_RECEIVED",
    date: new Date().toISOString(),

    content: {
      id: externalMessageId,
      companyId,
      sessionId: randomUUID(),
      type: "TEXT",
      active: true,
      text:
        "Mensagem local para teste de identificação",
      direction: "FROM_HUB",

      details: {
        from: `+${contato.telefone}`,
        to: "+5541000000000",
      },
    },

    changeMetadata: null,
  };

  const url =
    `http://127.0.0.1:${config.port}` +
    `/webhooks/botnext/${config.secret}`;

  const primeiraResposta =
    await enviarEvento(
      url,
      payload,
    );

  if (
    primeiraResposta.persistido !==
      true ||
    primeiraResposta.duplicado !==
      false ||
    primeiraResposta.processado !==
      true ||
    primeiraResposta.status !==
      "PROCESSED" ||
    primeiraResposta
      .clienteIdentificado !== true
  ) {
    throw new Error(
      "A primeira entrega não identificou o cliente como esperado.",
    );
  }

  console.log(
    "OK: mensagem persistida e cliente identificado.",
  );

  const eventoSalvo =
    await prisma.botnextWebhookEvent.findFirst({
      where: {
        tenantId: tenant.id,
        companyId,
        eventType:
          "MESSAGE_RECEIVED",
        externalMessageId,
      },
      select: {
        status: true,
        clienteId: true,
        processedAt: true,
        errorMessage: true,
      },
    });

  if (!eventoSalvo) {
    throw new Error(
      "Evento não encontrado no PostgreSQL.",
    );
  }

  if (
    eventoSalvo.status !==
      "PROCESSED" ||
    eventoSalvo.clienteId !==
      contato.clienteId ||
    eventoSalvo.processedAt ===
      null ||
    eventoSalvo.errorMessage !==
      null
  ) {
    throw new Error(
      "O evento salvo não possui a associação esperada.",
    );
  }

  console.log(
    "OK: evento associado ao cliente correto no PostgreSQL.",
  );

  const segundaResposta =
    await enviarEvento(
      url,
      payload,
    );

  if (
    segundaResposta.persistido !==
      false ||
    segundaResposta.duplicado !==
      true
  ) {
    throw new Error(
      "A repetição não foi reconhecida como duplicada.",
    );
  }

  console.log(
    "OK: repetição reconhecida sem duplicar o registro.",
  );

  const quantidade =
    await prisma.botnextWebhookEvent.count({
      where: {
        tenantId: tenant.id,
        companyId,
        eventType:
          "MESSAGE_RECEIVED",
        externalMessageId,
      },
    });

  if (quantidade !== 1) {
    throw new Error(
      `Esperado 1 evento, encontrados ${quantidade}.`,
    );
  }

  console.log(
    "OK: existe somente um evento no banco.",
  );

  console.log(
    "Teste concluído sem IA, resposta BotNext ou escrita no ArBrain.",
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