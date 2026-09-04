import "./config/env.js";

import {
  timingSafeEqual,
} from "node:crypto";

import {
  createServer,
  type ServerResponse,
} from "node:http";

import type {
  Prisma,
} from "@prisma/client";

import {
  z,
} from "zod";

import {
  verificarSaude,
} from "./health/health-service.js";

import {
  ContaBotnextNaoAutorizadaError,
  salvarEventoBotnext,
} from "./integrations/botnext/botnext-webhook-inbox.js";

import {
  enfileirarEventoBotnext,
} from "./queue/botnext-webhook-queue.js";

const configuracao = z
  .object({
    BOTNEXT_WEBHOOK_SECRET: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{64}$/),

    BOTNEXT_WEBHOOK_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .default(3333),
  })
  .safeParse(process.env);

if (!configuracao.success) {
  throw new Error(
    "Confira BOTNEXT_WEBHOOK_SECRET e BOTNEXT_WEBHOOK_PORT no .env.",
  );
}

const config =
  configuracao.data;

const LIMITE_BYTES =
  64 * 1024;

const PREFIXO_WEBHOOK =
  "/webhooks/botnext/";

const eventoSchema = z.object({
  eventType: z
    .string()
    .min(1),
});

const mensagemSchema = z.object({
  eventType: z.literal(
    "MESSAGE_RECEIVED",
  ),

  date: z
    .string()
    .min(1),

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

    type: z
      .string(),

    active: z
      .boolean(),

    text: z
      .string()
      .nullable()
      .optional(),

    direction: z
      .string(),

    details: z.object({
      from: z
        .string()
        .trim()
        .min(1),

      to: z
        .string()
        .trim()
        .min(1),
    }),
  }),
});

function responder(
  response: ServerResponse,
  status: number,
  resultado: Record<string, unknown>,
): void {
  if (
    response.destroyed ||
    response.writableEnded
  ) {
    return;
  }

  response.writeHead(
    status,
    {
      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store",

      Connection:
        "close",
    },
  );

  response.end(
    JSON.stringify(resultado),
  );
}

function segredoValido(
  valor: string,
): boolean {
  if (
    !/^[a-f0-9]{64}$/.test(valor)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(
      valor,
      "hex",
    ),

    Buffer.from(
      config.BOTNEXT_WEBHOOK_SECRET,
      "hex",
    ),
  );
}

function converterData(
  valor: string,
): Date | null {
  const data =
    new Date(valor);

  if (
    Number.isNaN(
      data.getTime(),
    )
  ) {
    return null;
  }

  return data;
}

async function validarCorpo(
  texto: string,
  response: ServerResponse,
): Promise<void> {
  let payload: unknown;

  try {
    payload =
      JSON.parse(texto);
  } catch {
    responder(
      response,
      400,
      {
        erro:
          "JSON inválido.",
      },
    );

    return;
  }

  const evento =
    eventoSchema.safeParse(
      payload,
    );

  if (!evento.success) {
    responder(
      response,
      400,
      {
        erro:
          "Evento inválido.",
      },
    );

    return;
  }

  if (
    evento.data.eventType !==
    "MESSAGE_RECEIVED"
  ) {
    responder(
      response,
      200,
      {
        ignorado: true,
        motivo:
          "evento_nao_processado",
      },
    );

    return;
  }

  const resultado =
    mensagemSchema.safeParse(
      payload,
    );

  if (!resultado.success) {
    responder(
      response,
      400,
      {
        erro:
          "Formato da mensagem inválido.",
      },
    );

    return;
  }

  const mensagem =
    resultado.data.content;

  if (!mensagem.active) {
    responder(
      response,
      200,
      {
        ignorado: true,
        motivo:
          "mensagem_inativa",
      },
    );

    return;
  }

  if (
    mensagem.type !==
    "TEXT"
  ) {
    responder(
      response,
      200,
      {
        ignorado: true,
        motivo:
          "tipo_nao_suportado",
      },
    );

    return;
  }

  if (
    mensagem.direction !==
    "FROM_HUB"
  ) {
    responder(
      response,
      200,
      {
        ignorado: true,
        motivo:
          "direcao_nao_suportada",
      },
    );

    return;
  }

  const textoMensagem =
    mensagem.text?.trim();

  if (!textoMensagem) {
    responder(
      response,
      400,
      {
        erro:
          "Mensagem de texto vazia.",
      },
    );

    return;
  }

  const dataEvento =
    converterData(
      resultado.data.date,
    );

  if (!dataEvento) {
    responder(
      response,
      400,
      {
        erro:
          "Data do evento inválida.",
      },
    );

    return;
  }

  const persistencia =
    await salvarEventoBotnext({
      eventType:
        resultado.data.eventType,

      externalMessageId:
        mensagem.id,

      companyId:
        mensagem.companyId,

      sessionId:
        mensagem.sessionId,

      messageType:
        mensagem.type,

      direction:
        mensagem.direction,

      senderPhone:
        mensagem.details.from,

      recipientPhone:
        mensagem.details.to,

      messageText:
        textoMensagem,

      eventDate:
        dataEvento,

      payload:
        payload as Prisma.InputJsonValue,
    });

  if (
    !persistencia.eventoId
  ) {
    throw new Error(
      "Evento persistido sem identificador.",
    );
  }

  await enfileirarEventoBotnext(
    persistencia.eventoId,
  );

  if (
    persistencia.duplicado
  ) {
    console.log(
      "Evento repetido reconhecido e reenfileirado com segurança.",
    );
  } else {
    console.log(
      "Evento BotNext armazenado no PostgreSQL próprio.",
    );
  }

  console.log(
    "Evento encaminhado para processamento assíncrono.",
  );

  console.log(
    "Nenhuma IA, resposta automática ou escrita no ArBrain foi executada.",
  );

  responder(
    response,
    200,
    {
      recebido: true,

      persistido:
        persistencia.persistido,

      duplicado:
        persistencia.duplicado,

      enfileirado: true,
    },
  );
}

const server =
  createServer(
    (
      request,
      response,
    ) => {
      const caminho =
        (
          request.url ??
          ""
        )
          .split("?")[0] ??
        "";

      if (
        request.method ===
          "GET" &&
        caminho ===
          "/health"
      ) {
        void verificarSaude()
          .then((saude) => {
            responder(
              response,
              saude.status === "ok"
                ? 200
                : 503,
              {
                ...saude,

                modo:
                  "persistencia_e_fila",
              },
            );
          })
          .catch(() => {
            responder(
              response,
              503,
              {
                status:
                  "degradado",

                modo:
                  "persistencia_e_fila",

                erro:
                  "Falha ao verificar dependências.",
              },
            );
          });

        return;
      }

      if (
        !caminho.startsWith(
          PREFIXO_WEBHOOK,
        )
      ) {
        responder(
          response,
          404,
          {
            erro:
              "Rota não encontrada.",
          },
        );

        return;
      }

      const segredoRecebido =
        caminho.slice(
          PREFIXO_WEBHOOK.length,
        );

      if (
        !segredoValido(
          segredoRecebido,
        )
      ) {
        responder(
          response,
          403,
          {
            erro:
              "Acesso negado.",
          },
        );

        return;
      }

      if (
        request.method !==
        "POST"
      ) {
        response.setHeader(
          "Allow",
          "POST",
        );

        responder(
          response,
          405,
          {
            erro:
              "Use POST.",
          },
        );

        return;
      }

      const contentType =
        request.headers[
          "content-type"
        ]
          ?.split(";")[0]
          ?.trim()
          .toLowerCase();

      if (
        contentType !==
        "application/json"
      ) {
        responder(
          response,
          415,
          {
            erro:
              "Use application/json.",
          },
        );

        return;
      }

      const partes:
        Buffer[] = [];

      let tamanho = 0;

      let excedeuLimite =
        false;

      request.on(
        "data",
        (
          parte: Buffer,
        ) => {
          if (
            excedeuLimite
          ) {
            return;
          }

          tamanho +=
            parte.length;

          if (
            tamanho >
            LIMITE_BYTES
          ) {
            excedeuLimite =
              true;

            partes.length =
              0;

            responder(
              response,
              413,
              {
                erro:
                  "Corpo muito grande.",
              },
            );

            return;
          }

          partes.push(
            parte,
          );
        },
      );

      request.on(
        "end",
        async () => {
          if (
            excedeuLimite
          ) {
            return;
          }

          try {
            const texto =
              Buffer.concat(
                partes,
              ).toString(
                "utf8",
              );

            await validarCorpo(
              texto,
              response,
            );
          } catch (
            error: unknown
          ) {
            if (
              error instanceof
              ContaBotnextNaoAutorizadaError
            ) {
              console.warn(
                "Evento rejeitado: conta BotNext não autorizada.",
              );

              responder(
                response,
                403,
                {
                  erro:
                    "Acesso negado.",
                },
              );

              return;
            }

            console.error(
              "Falha interna ao persistir ou enfileirar o evento BotNext.",
            );

            responder(
              response,
              500,
              {
                erro:
                  "Falha interna.",
              },
            );
          }
        },
      );

      request.on(
        "error",
        () => {
          responder(
            response,
            400,
            {
              erro:
                "Falha ao receber a requisição.",
            },
          );
        },
      );
    },
  );

server.requestTimeout =
  15_000;

server.headersTimeout =
  10_000;

server.on(
  "error",
  () => {
    console.error(
      "Não foi possível iniciar o servidor. Confira se a porta está ocupada.",
    );

    process.exitCode = 1;
  },
);

server.listen(
  config.BOTNEXT_WEBHOOK_PORT,
  "127.0.0.1",
  () => {
    console.log(
      `Receptor local iniciado na porta ${config.BOTNEXT_WEBHOOK_PORT}.`,
    );

    console.log(
      "Persistência PostgreSQL e fila Redis habilitadas.",
    );

    console.log(
      "Identificação de cliente executada pelo worker separado.",
    );

    console.log(
      "Health check detalhado de PostgreSQL e Redis habilitado.",
    );

    console.log(
      "IA, resposta automática e escrita no ArBrain permanecem desabilitadas.",
    );
  },
);