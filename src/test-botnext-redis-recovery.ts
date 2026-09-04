import "dotenv/config";

import {
  randomUUID,
} from "node:crypto";

import {
  BotnextWebhookStatus,
} from "@prisma/client";

import {
  z,
} from "zod";

import {
  prisma,
} from "./database/prisma.js";

const MARCADOR_TESTE =
  "TESTE_RECUPERACAO_REDIS";

const payloadSchema = z.object({
  eventType: z.literal(
    "MESSAGE_RECEIVED",
  ),

  date: z.string(),

  content: z.object({
    id: z
      .string()
      .uuid(),

    companyId: z
      .string()
      .uuid(),

    sessionId: z
      .string()
      .uuid(),

    type: z.literal(
      "TEXT",
    ),

    active: z.literal(
      true,
    ),

    text: z
      .string()
      .nullable()
      .optional(),

    direction: z.literal(
      "FROM_HUB",
    ),

    details: z.object({
      from: z
        .string()
        .min(1),

      to: z
        .string()
        .min(1),
    }),
  }),
});

type RespostaWebhook = {
  recebido?: boolean;
  persistido?: boolean;
  duplicado?: boolean;
  enfileirado?: boolean;
  erro?: string;
};

function obterConfiguracao(): {
  url: string;
  companyId: string;
} {
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

  if (
    !secret ||
    !/^[a-f0-9]{64}$/.test(
      secret,
    )
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
    !/^[0-9a-f-]{36}$/i.test(
      companyId,
    )
  ) {
    throw new Error(
      "BOTNEXT_COMPANY_ID inválido.",
    );
  }

  return {
    companyId,

    url:
      `http://127.0.0.1:${port}` +
      `/webhooks/botnext/${secret}`,
  };
}

async function enviarEvento(
  url: string,
  payload: Record<string, unknown>,
): Promise<{
  status: number;
  corpo: RespostaWebhook;
}> {
  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify(
            payload,
          ),
      },
    );

  const corpo =
    await response.json() as
      RespostaWebhook;

  return {
    status:
      response.status,

    corpo,
  };
}

async function registrarEventoComRedisParado():
  Promise<void> {
  const config =
    obterConfiguracao();

  const eventoBase =
    await prisma
      .botnextWebhookEvent
      .findFirst({
        where: {
          companyId:
            config.companyId,

          status:
            BotnextWebhookStatus
              .PROCESSED,

          clienteId: {
            not: null,
          },
        },
        orderBy: {
          createdAt:
            "desc",
        },
        select: {
          tenantId:
            true,

          payload:
            true,
        },
      });

  if (!eventoBase) {
    throw new Error(
      "Nenhum evento processado foi encontrado para servir como base.",
    );
  }

  const base =
    payloadSchema.parse(
      eventoBase.payload,
    );

  const externalMessageId =
    randomUUID();

  const payload = {
    eventType:
      "MESSAGE_RECEIVED",

    date:
      new Date()
        .toISOString(),

    content: {
      id:
        externalMessageId,

      companyId:
        config.companyId,

      sessionId:
        randomUUID(),

      type:
        "TEXT",

      active:
        true,

      text:
        MARCADOR_TESTE,

      direction:
        "FROM_HUB",

      details: {
        from:
          base.content
            .details.from,

        to:
          base.content
            .details.to,
      },
    },

    changeMetadata:
      null,
  };

  const resposta =
    await enviarEvento(
      config.url,
      payload,
    );

  if (
    resposta.status !==
    500
  ) {
    throw new Error(
      `Esperado HTTP 500 com Redis parado, mas recebido HTTP ${resposta.status}.`,
    );
  }

  console.log(
    "OK: webhook informou falha enquanto o Redis estava indisponível.",
  );

  const eventoSalvo =
    await prisma
      .botnextWebhookEvent
      .findUnique({
        where: {
          tenantId_companyId_eventType_externalMessageId: {
            tenantId:
              eventoBase.tenantId,

            companyId:
              config.companyId,

            eventType:
              "MESSAGE_RECEIVED",

            externalMessageId,
          },
        },
        select: {
          status: true,
        },
      });

  if (
    !eventoSalvo ||
    eventoSalvo.status !==
      BotnextWebhookStatus.RECEIVED
  ) {
    throw new Error(
      "O evento não permaneceu seguro no PostgreSQL.",
    );
  }

  console.log(
    "OK: evento permaneceu salvo como RECEIVED no PostgreSQL.",
  );

  console.log(
    "Agora o Redis pode ser iniciado para testar a recuperação.",
  );
}

async function aguardarFinalizacao(
  eventoId: string,
): Promise<{
  status: BotnextWebhookStatus;
  clienteId: string | null;
}> {
  const limite =
    Date.now() +
    15_000;

  while (
    Date.now() <
    limite
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
          200,
        );
      },
    );
  }

  throw new Error(
    "O evento recuperado não foi finalizado dentro do prazo.",
  );
}

async function recuperarEventoDepoisDoRedis():
  Promise<void> {
  const config =
    obterConfiguracao();

  const eventoPendente =
    await prisma
      .botnextWebhookEvent
      .findFirst({
        where: {
          companyId:
            config.companyId,

          messageText:
            MARCADOR_TESTE,

          status:
            BotnextWebhookStatus
              .RECEIVED,
        },
        orderBy: {
          createdAt:
            "desc",
        },
        select: {
          id:
            true,

          payload:
            true,
        },
      });

  if (!eventoPendente) {
    throw new Error(
      "Nenhum evento pendente do teste foi encontrado.",
    );
  }

  const payload =
    payloadSchema.parse(
      eventoPendente.payload,
    );

  const resposta =
    await enviarEvento(
      config.url,
      payload,
    );

  if (
    resposta.status !==
      200 ||
    resposta.corpo
      .persistido !== false ||
    resposta.corpo
      .duplicado !== true ||
    resposta.corpo
      .enfileirado !== true
  ) {
    throw new Error(
      "O evento pendente não foi recuperado e reenfileirado corretamente.",
    );
  }

  console.log(
    "OK: reentrega recuperou e reenfileirou o evento existente.",
  );

  const resultado =
    await aguardarFinalizacao(
      eventoPendente.id,
    );

  if (
    resultado.status !==
      BotnextWebhookStatus.PROCESSED ||
    !resultado.clienteId
  ) {
    throw new Error(
      "O worker não concluiu a recuperação do evento.",
    );
  }

  console.log(
    "OK: worker processou o evento recuperado.",
  );

  console.log(
    "Teste concluído sem duplicidade, IA, resposta BotNext ou escrita no ArBrain.",
  );
}

async function executar():
  Promise<void> {
  const modo =
    process.argv[2];

  if (
    modo ===
    "falha"
  ) {
    await registrarEventoComRedisParado();
    return;
  }

  if (
    modo ===
    "recuperacao"
  ) {
    await recuperarEventoDepoisDoRedis();
    return;
  }

  throw new Error(
    "Use o modo falha ou recuperacao.",
  );
}

executar()
  .catch(
    (
      error: unknown,
    ) => {
      const mensagem =
        error instanceof Error
          ? error.message
          : "Erro desconhecido";

      console.error(
        `Falha no teste: ${mensagem}`,
      );

      process.exitCode = 1;
    },
  )
  .finally(
    async () => {
      await prisma
        .$disconnect();
    },
  );