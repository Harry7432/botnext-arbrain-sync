import "dotenv/config";

import { randomUUID } from "node:crypto";

import {
  BotnextWebhookStatus,
} from "@prisma/client";

import { prisma } from "./database/prisma.js";

import {
  normalizarTelefoneBrasil,
} from "./visitas/telefone-service.js";

type RespostaWebhook = {
  recebido?: boolean;
  persistido?: boolean;
  duplicado?: boolean;
  enfileirado?: boolean;
  erro?: string;
};

type ConfiguracaoTeste = {
  secret: string;
  port: number;
  companyId: string;
  numeroCanal: string;
};

type ContatoTeste = {
  clienteId: string;
  numeroComCodigoPais: string;
};

function obterConfiguracao(): ConfiguracaoTeste {
  const secret =
    process.env.BOTNEXT_WEBHOOK_SECRET?.trim();

  const port = Number(
    process.env.BOTNEXT_WEBHOOK_PORT ??
      "3333",
  );

  const companyId =
    process.env.BOTNEXT_COMPANY_ID?.trim();

  const numeroCanal =
    process.env.BOTNEXT_FROM?.trim();

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
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      "BOTNEXT_WEBHOOK_PORT inválida.",
    );
  }

  if (
    !companyId ||
    !/^[0-9a-f-]{36}$/i.test(companyId)
  ) {
    throw new Error(
      "BOTNEXT_COMPANY_ID inválido.",
    );
  }

  if (
    !numeroCanal ||
    !/^55\d{10,11}$/.test(numeroCanal)
  ) {
    throw new Error(
      "BOTNEXT_FROM inválido.",
    );
  }

  return {
    secret,
    port,
    companyId,
    numeroCanal,
  };
}

async function escolherClienteComTelefoneUnico(
  tenantId: string,
): Promise<ContatoTeste> {
  const clientes =
    await prisma.cliente.findMany({
      where: {
        tenantId,
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

  const clientesPorNumero =
    new Map<string, Set<string>>();

  for (const cliente of clientes) {
    const numerosDoCliente =
      new Set<string>();

    for (
      const telefone of [
        cliente.celular,
        cliente.telefone,
      ]
    ) {
      const normalizado =
        normalizarTelefoneBrasil(
          telefone,
        );

      if (normalizado) {
        numerosDoCliente.add(
          normalizado.numeroComCodigoPais,
        );
      }
    }

    for (const numero of numerosDoCliente) {
      const clientesDoNumero =
        clientesPorNumero.get(numero) ??
        new Set<string>();

      clientesDoNumero.add(cliente.id);

      clientesPorNumero.set(
        numero,
        clientesDoNumero,
      );
    }
  }

  for (
    const [
      numero,
      clientesDoNumero,
    ] of clientesPorNumero
  ) {
    if (clientesDoNumero.size !== 1) {
      continue;
    }

    const clienteId =
      [...clientesDoNumero][0];

    if (clienteId) {
      return {
        clienteId,
        numeroComCodigoPais: numero,
      };
    }
  }

  throw new Error(
    "Nenhum cliente com telefone exclusivo foi encontrado.",
  );
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
    await response.json() as
      RespostaWebhook;

  if (!response.ok) {
    throw new Error(
      `Webhook respondeu HTTP ${response.status}: ${
        resultado.erro ??
        "erro desconhecido"
      }`,
    );
  }

  return resultado;
}

async function localizarEvento(
  tenantId: string,
  companyId: string,
  externalMessageId: string,
): Promise<string> {
  const evento =
    await prisma.botnextWebhookEvent.findUnique({
      where: {
        tenantId_companyId_eventType_externalMessageId: {
          tenantId,
          companyId,
          eventType:
            "MESSAGE_RECEIVED",
          externalMessageId,
        },
      },
      select: {
        id: true,
      },
    });

  if (!evento) {
    throw new Error(
      "Evento não foi encontrado no PostgreSQL.",
    );
  }

  return evento.id;
}

async function aguardarProcessamento(
  eventoId: string,
): Promise<{
  status: BotnextWebhookStatus;
  clienteId: string | null;
}> {
  const limite =
    Date.now() + 15_000;

  while (Date.now() < limite) {
    const evento =
      await prisma.botnextWebhookEvent.findUnique({
        where: {
          id: eventoId,
        },
        select: {
          status: true,
          clienteId: true,
        },
      });

    if (
      evento &&
      evento.status !==
        BotnextWebhookStatus.RECEIVED &&
      evento.status !==
        BotnextWebhookStatus.PROCESSING
    ) {
      return evento;
    }

    await new Promise<void>(
      (resolve) => {
        setTimeout(resolve, 200);
      },
    );
  }

  throw new Error(
    "O worker não finalizou o evento dentro do prazo.",
  );
}

function montarPayload(
  config: ConfiguracaoTeste,
  contato: ContatoTeste,
  sessionId: string,
  externalMessageId: string,
  texto: string,
): Record<string, unknown> {
  return {
    eventType:
      "MESSAGE_RECEIVED",

    date:
      new Date().toISOString(),

    content: {
      id:
        externalMessageId,

      companyId:
        config.companyId,

      sessionId,

      type:
        "TEXT",

      active:
        true,

      text:
        texto,

      direction:
        "FROM_HUB",

      details: {
        from:
          `+${contato.numeroComCodigoPais}`,

        to:
          `+${config.numeroCanal}`,
      },
    },

    changeMetadata:
      null,
  };
}

async function executarTeste():
  Promise<void> {
  console.log(
    "Testando webhook, PostgreSQL, Redis, worker e conversa...",
  );

  const config =
    obterConfiguracao();

  const conta =
    await prisma.botnextAccount.findUnique({
      where: {
        companyId:
          config.companyId,
      },
      select: {
        id: true,
        tenantId: true,
        active: true,
      },
    });

  if (
    !conta ||
    !conta.active
  ) {
    throw new Error(
      "Conta BotNext não encontrada ou inativa.",
    );
  }

  const contato =
    await escolherClienteComTelefoneUnico(
      conta.tenantId,
    );

  const sessionId =
    randomUUID();

  const externalMessageId1 =
    randomUUID();

  const externalMessageId2 =
    randomUUID();

  const payload1 =
    montarPayload(
      config,
      contato,
      sessionId,
      externalMessageId1,
      "Primeira mensagem do teste completo",
    );

  const payload2 =
    montarPayload(
      config,
      contato,
      sessionId,
      externalMessageId2,
      "Segunda mensagem do teste completo",
    );

  const url =
    `http://127.0.0.1:${config.port}` +
    `/webhooks/botnext/${config.secret}`;

  const primeiraResposta =
    await enviarEvento(
      url,
      payload1,
    );

  if (
    primeiraResposta.persistido !== true ||
    primeiraResposta.duplicado !== false ||
    primeiraResposta.enfileirado !== true
  ) {
    throw new Error(
      "A primeira mensagem não foi persistida e enfileirada.",
    );
  }

  const primeiroEventoId =
    await localizarEvento(
      conta.tenantId,
      config.companyId,
      externalMessageId1,
    );

  const primeiroProcessamento =
    await aguardarProcessamento(
      primeiroEventoId,
    );

  if (
    primeiroProcessamento.status !==
      BotnextWebhookStatus.PROCESSED ||
    primeiroProcessamento.clienteId !==
      contato.clienteId
  ) {
    throw new Error(
      "O worker não processou corretamente a primeira mensagem.",
    );
  }

  console.log(
    "OK: primeira mensagem processada pelo worker.",
  );

  const segundaResposta =
    await enviarEvento(
      url,
      payload2,
    );

  if (
    segundaResposta.persistido !== true ||
    segundaResposta.duplicado !== false ||
    segundaResposta.enfileirado !== true
  ) {
    throw new Error(
      "A segunda mensagem não foi persistida e enfileirada.",
    );
  }

  const segundoEventoId =
    await localizarEvento(
      conta.tenantId,
      config.companyId,
      externalMessageId2,
    );

  const segundoProcessamento =
    await aguardarProcessamento(
      segundoEventoId,
    );

  if (
    segundoProcessamento.status !==
      BotnextWebhookStatus.PROCESSED ||
    segundoProcessamento.clienteId !==
      contato.clienteId
  ) {
    throw new Error(
      "O worker não processou corretamente a segunda mensagem.",
    );
  }

  console.log(
    "OK: segunda mensagem processada pelo worker.",
  );

  const conversa =
    await prisma.botnextConversation.findUnique({
      where: {
        botnextAccountId_sessionId: {
          botnextAccountId:
            conta.id,

          sessionId,
        },
      },
      include: {
        messages: {
          orderBy: {
            eventDate:
              "asc",
          },
        },
      },
    });

  if (!conversa) {
    throw new Error(
      "A conversa não foi criada.",
    );
  }

  if (
    conversa.clienteId !==
    contato.clienteId
  ) {
    throw new Error(
      "A conversa não foi associada ao cliente correto.",
    );
  }

  if (
    conversa.messages.length !== 2
  ) {
    throw new Error(
      `Esperadas 2 mensagens, mas foram encontradas ${conversa.messages.length}.`,
    );
  }

  if (
    conversa.messages.some(
      (mensagem) =>
        mensagem.role !==
        "CUSTOMER",
    )
  ) {
    throw new Error(
      "Uma mensagem foi registrada com autoria incorreta.",
    );
  }

  console.log(
    "OK: uma conversa contém as duas mensagens do cliente.",
  );

  const respostaDuplicada =
    await enviarEvento(
      url,
      payload1,
    );

  if (
    respostaDuplicada.persistido !== false ||
    respostaDuplicada.duplicado !== true ||
    respostaDuplicada.enfileirado !== true
  ) {
    throw new Error(
      "A repetição não foi reconhecida corretamente.",
    );
  }

  await new Promise<void>(
    (resolve) => {
      setTimeout(resolve, 500);
    },
  );

  const quantidadeEventos =
    await prisma.botnextWebhookEvent.count({
      where: {
        id: {
          in: [
            primeiroEventoId,
            segundoEventoId,
          ],
        },
      },
    });

  const quantidadeMensagens =
    await prisma
      .botnextConversationMessage
      .count({
        where: {
          conversationId:
            conversa.id,
        },
      });

  if (
    quantidadeEventos !== 2 ||
    quantidadeMensagens !== 2
  ) {
    throw new Error(
      "A repetição criou evento ou mensagem duplicada.",
    );
  }

  console.log(
    "OK: repetição não duplicou evento nem mensagem.",
  );

  console.log(
    "Teste completo aprovado sem IA, envio BotNext ou escrita no ArBrain.",
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