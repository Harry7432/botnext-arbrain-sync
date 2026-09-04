import "dotenv/config";

import assert from "node:assert/strict";                                                                 
import { randomUUID } from "node:crypto";                                                                
                                                                                                         
import {
  BotnextConversationStatus,
  BotnextRoutingAction,
  BotnextWebhookStatus,
} from "@prisma/client";
                                                                                                         
import {                                                                                                 
  prisma,                                                                                                
} from "./database/prisma.js";                                                                           
                                                                                                         
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

type ResultadoProcessamento = {
  status: BotnextWebhookStatus;
  clienteId: string | null;
  errorMessage: string | null;
};

function obterConfiguracao():
  ConfiguracaoTeste {
  const secret =
    process.env
      .BOTNEXT_WEBHOOK_SECRET
      ?.trim();

  const port =
    Number(
      process.env
        .BOTNEXT_WEBHOOK_PORT ??
        "3333",
    );

  const companyId =
    process.env
      .BOTNEXT_COMPANY_ID
      ?.trim();

  const numeroCanal =
    process.env
      .BOTNEXT_FROM
      ?.trim();

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
    port > 65_535
  ) {
    throw new Error(
      "BOTNEXT_WEBHOOK_PORT inválida.",
    );
  }

  if (
    !companyId ||
    !/^[0-9a-f-]{36}$/i.test(
      companyId,
    )
  ) {
    throw new Error(
      "BOTNEXT_COMPANY_ID inválido.",
    );
  }

  if (
    !numeroCanal ||
    !/^55\d{10,11}$/.test(
      numeroCanal,
    )
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

function verificarTravasDeSeguranca():
  void {
  const envioHabilitado =
    (
      process.env
        .BOTNEXT_SEND_ENABLED ??
      "false"
    )
      .trim()
      .toLowerCase();

  if (
    envioHabilitado !== "false"
  ) {
    throw new Error(
      "BOTNEXT_SEND_ENABLED deve permanecer false durante o teste.",
    );
  }

  if (
    !process.env
      .OPENAI_API_KEY
      ?.trim()
  ) {
    throw new Error(
      "OPENAI_API_KEY não está configurada.",
    );
  }
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
              not:
                null,
            },
          },
          {
            telefone: {
              not:
                null,
            },
          },
        ],
      },

      select: {
        id:
          true,

        celular:
          true,

        telefone:
          true,
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
          normalizado
            .numeroComCodigoPais,
        );
      }
    }

    for (
      const numero of
      numerosDoCliente
    ) {
      const clientesDoNumero =
        clientesPorNumero.get(
          numero,
        ) ??
        new Set<string>();

      clientesDoNumero.add(
        cliente.id,
      );

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
    if (
      clientesDoNumero.size !== 1
    ) {
      continue;
    }

    const clienteId =
      [...clientesDoNumero][0];

    if (clienteId) {
      return {
        clienteId,
        numeroComCodigoPais:
          numero,
      };
    }
  }

  throw new Error(
    "Nenhum cliente com telefone exclusivo foi encontrado.",
  );
}

async function enviarEvento(
  url: string,
  payload: Record<
    string,
    unknown
  >,
): Promise<RespostaWebhook> {
  const response =
    await fetch(url, {
      method:
        "POST",

      headers: {
        "Content-Type":
          "application/json",
      },

      body:
        JSON.stringify(payload),
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
    await prisma
      .botnextWebhookEvent
      .findUnique({
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
          id:
            true,
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
): Promise<ResultadoProcessamento> {
  // A chamada real da OpenAI pode levar
  // mais tempo que o processamento sem IA.
  const limite =
    Date.now() + 60_000;

  while (
    Date.now() < limite
  ) {
    const evento =
      await prisma
        .botnextWebhookEvent
        .findUnique({
          where: {
            id:
              eventoId,
          },

          select: {
            status:
              true,

            clienteId:
              true,

            errorMessage:
              true,
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
        setTimeout(
          resolve,
          250,
        );
      },
    );
  }

  throw new Error(
    "O worker não finalizou o evento dentro de 60 segundos.",
  );
}

function montarPayload(
  config: ConfiguracaoTeste,
  contato: ContatoTeste,
  sessionId: string,
  externalMessageId: string,
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
        "Quero falar com um atendente humano.",

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
    "Testando webhook, PostgreSQL, Redis, worker, conversa e OpenAI...",
  );

  verificarTravasDeSeguranca();

  const config =
    obterConfiguracao();

  const conta =
    await prisma
      .botnextAccount
      .findUnique({
        where: {
          companyId:
            config.companyId,
        },

        select: {
          id:
            true,

          tenantId:
            true,

          active:
            true,
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

  const externalMessageId =
    randomUUID();

  const payload =
    montarPayload(
      config,
      contato,
      sessionId,
      externalMessageId,
    );

  const url =
    `http://127.0.0.1:${config.port}` +
    `/webhooks/botnext/${config.secret}`;

  const modeloEsperado =
    process.env
      .OPENAI_MODEL
      ?.trim() ||
    "gpt-5-nano";

  let eventoId:
    string | null =
    null;

  let eventoFinalizado =
    false;

  try {
    const resposta =
      await enviarEvento(
        url,
        payload,
      );

    if (
      resposta.persistido !== true ||
      resposta.duplicado !== false ||
      resposta.enfileirado !== true
    ) {
      throw new Error(
        "A mensagem não foi persistida e enfileirada corretamente.",
      );
    }

    console.log(
      "OK: webhook persistiu e enfileirou a mensagem.",
    );

    eventoId =
      await localizarEvento(
        conta.tenantId,
        config.companyId,
        externalMessageId,
      );

    const processamento =
      await aguardarProcessamento(
        eventoId,
      );

    eventoFinalizado =
      true;

    if (
      processamento.status !==
        BotnextWebhookStatus.PROCESSED
    ) {
      throw new Error(
        `O worker finalizou o evento com status ${processamento.status}: ${
          processamento.errorMessage ??
          "sem motivo informado"
        }`,
      );
    }

    assert.equal(
      processamento.clienteId,
      contato.clienteId,
    );

    console.log(
      "OK: worker processou a mensagem e identificou o cliente.",
    );

    const conversa =
      await prisma
        .botnextConversation
        .findUnique({
          where: {
            botnextAccountId_sessionId: {
              botnextAccountId:
                conta.id,

              sessionId,
            },
          },

          include: {
            messages: {
              where: {
                webhookEventId:
                  eventoId,
              },
            },
          },
        });

    if (!conversa) {
      throw new Error(
        "A conversa não foi criada.",
      );
    }

    assert.equal(
      conversa.clienteId,
      contato.clienteId,
    );

    assert.equal(
      conversa.status,
      BotnextConversationStatus.HUMAN_HANDOFF,
    );

    assert.equal(
      conversa.closedAt,
      null,
    );

    assert.equal(
      conversa.messages.length,
      1,
    );

    const mensagem =
      conversa.messages[0];

    if (!mensagem) {
      throw new Error(
        "A mensagem da conversa não foi encontrada.",
      );
    }

    assert.equal(
      mensagem.role,
      "CUSTOMER",
    );

    assert.equal(
      mensagem.detectedIntent,
      "ATENDIMENTO_HUMANO",
    );

    assert.ok(
      mensagem.intentConfidence !==
        null &&
      mensagem.intentConfidence >= 0 &&
      mensagem.intentConfidence <= 1,
      "A confiança deve estar entre 0 e 1.",
    );

    assert.ok(
      mensagem.intentReason
        ?.trim(),
      "A justificativa não foi persistida.",
    );

    assert.equal(
      mensagem.requiresHumanHandoff,
      true,
    );

    assert.equal(
      mensagem.classificationModel,
      modeloEsperado,
    );

    assert.equal(
      mensagem.classificationVersion,
      "botnext-intent-v1",
    );

    assert.ok(
      mensagem.classifiedAt instanceof
        Date,
    );

    assert.equal(
      mensagem.routingAction,
      BotnextRoutingAction
        .ENCAMINHAR_ATENDIMENTO_HUMANO,
    );

    assert.ok(
      mensagem.routingReason
        ?.trim(),
      "O motivo do roteamento não foi persistido.",
    );

    assert.equal(
      mensagem.routingStatus,
      BotnextConversationStatus
        .HUMAN_HANDOFF,
    );

    assert.equal(
      mensagem.routingVersion,
      "botnext-routing-v1",
    );

    assert.ok(
      mensagem.routedAt instanceof
        Date,
    );

    assert.equal(
      conversa.intent,
      "ATENDIMENTO_HUMANO",
    );

    assert.equal(
      conversa.intentConfidence,
      mensagem.intentConfidence,
    );

    assert.equal(
      conversa.requiresHumanHandoff,
      true,
    );

    assert.ok(
      conversa.intentUpdatedAt instanceof
        Date,
    );

    console.log(
      "OK: OpenAI classificou como ATENDIMENTO_HUMANO.",
    );

    console.log(
      `OK: confiança ${mensagem.intentConfidence}.`,
    );

    console.log(
      "OK: classificação foi persistida na mensagem e na conversa.",
    );

    console.log(
      "OK: roteamento foi persistido e a conversa passou para HUMAN_HANDOFF.",
    );

    const mensagemAntesDaRepeticao = {
      detectedIntent:
        mensagem.detectedIntent,

      intentConfidence:
        mensagem.intentConfidence,

      intentReason:
        mensagem.intentReason,

      requiresHumanHandoff:
        mensagem.requiresHumanHandoff,

      classificationModel:
        mensagem.classificationModel,

      classificationVersion:
        mensagem.classificationVersion,

      classifiedAt:
        mensagem.classifiedAt,

      routingAction:
        mensagem.routingAction,

      routingReason:
        mensagem.routingReason,

      routingStatus:
        mensagem.routingStatus,

      routingVersion:
        mensagem.routingVersion,

      routedAt:
        mensagem.routedAt,
    };

    const respostaDuplicada =
      await enviarEvento(
        url,
        payload,
      );

    if (
      respostaDuplicada.persistido !==
        false ||
      respostaDuplicada.duplicado !==
        true ||
      respostaDuplicada.enfileirado !==
        true
    ) {
      throw new Error(
        "A repetição não foi reconhecida corretamente.",
      );
    }

    await new Promise<void>(
      (resolve) => {
        setTimeout(
          resolve,
          1_500,
        );
      },
    );

    const quantidadeEventos =
      await prisma
        .botnextWebhookEvent
        .count({
          where: {
            id:
              eventoId,
          },
        });

    const quantidadeMensagens =
      await prisma
        .botnextConversationMessage
        .count({
          where: {
            conversationId:
              conversa.id,

            webhookEventId:
              eventoId,
          },
        });

    assert.equal(
      quantidadeEventos,
      1,
    );

    assert.equal(
      quantidadeMensagens,
      1,
    );

    const mensagemDepoisDaRepeticao =
      await prisma
        .botnextConversationMessage
        .findUniqueOrThrow({
          where: {
            webhookEventId:
              eventoId,
          },

          select: {
            detectedIntent:
              true,

            intentConfidence:
              true,

            intentReason:
              true,

            requiresHumanHandoff:
              true,

            classificationModel:
              true,

            classificationVersion:
              true,

            classifiedAt:
              true,

            routingAction:
              true,

            routingReason:
              true,

            routingStatus:
              true,

            routingVersion:
              true,

            routedAt:
              true,
          },
        });

    assert.deepEqual(
      mensagemDepoisDaRepeticao,
      mensagemAntesDaRepeticao,
    );

    const conversaDepoisDaRepeticao =
      await prisma
        .botnextConversation
        .findUniqueOrThrow({
          where: {
            id:
              conversa.id,
          },

          select: {
            status:
              true,

            closedAt:
              true,
          },
        });

    assert.equal(
      conversaDepoisDaRepeticao.status,
      BotnextConversationStatus
        .HUMAN_HANDOFF,
    );

    assert.equal(
      conversaDepoisDaRepeticao.closedAt,
      null,
    );

    console.log(
      "OK: repetição não duplicou nem alterou classificação, roteamento ou estado.",
    );

    console.log(
      "Teste completo com IA real aprovado.",
    );

    console.log(
      "Nenhuma mensagem foi enviada ao BotNext ou escrita no ArBrain.",
    );
  } finally {
    if (
      eventoId &&
      eventoFinalizado
    ) {
      const conversa =
        await prisma
          .botnextConversation
          .findUnique({
            where: {
              botnextAccountId_sessionId: {
                botnextAccountId:
                  conta.id,

                sessionId,
              },
            },

            select: {
              id:
                true,
            },
          });

      if (conversa) {
        await prisma.$transaction([
          prisma
            .botnextConversationMessage
            .deleteMany({
              where: {
                conversationId:
                  conversa.id,

                webhookEventId:
                  eventoId,
              },
            }),

          prisma
            .botnextWebhookEvent
            .deleteMany({
              where: {
                id:
                  eventoId,

                tenantId:
                  conta.tenantId,
              },
            }),

          prisma
            .botnextConversation
            .deleteMany({
              where: {
                id:
                  conversa.id,

                tenantId:
                  conta.tenantId,

                sessionId,
              },
            }),
        ]);
      } else {
        await prisma
          .botnextWebhookEvent
          .deleteMany({
            where: {
              id:
                eventoId,

              tenantId:
                conta.tenantId,
            },
          });
      }

      console.log(
        "OK: registros temporários deste teste foram removidos.",
      );
    } else if (eventoId) {
      console.warn(
        "O evento não foi removido porque o worker pode ainda estar processando.",
      );

      console.warn(
        `Evento para análise: ${eventoId}`,
      );
    }
  }
}

executarTeste()
  .catch((error: unknown) => {
    console.error(
      "Falha no teste:",
      error instanceof Error
        ? error.message
        : "Erro desconhecido",
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
