import {
  randomUUID,
} from "node:crypto";

import {
  BotnextWebhookStatus,
  type Prisma,
} from "@prisma/client";

import {
  prisma,
} from "./database/prisma.js";

import {
  processarEventoBotnext,
} from "./integrations/botnext/botnext-webhook-processor.js";

import {
  normalizarTelefoneBrasil,
} from "./visitas/telefone-service.js";

type ClienteTeste = {
  id: string;
  celular: string | null;
  telefone: string | null;
};

type ContatoTeste = {
  clienteId: string;
  telefoneE164: string;
};

function encontrarContatoExclusivo(
  clientes: ClienteTeste[],
): ContatoTeste | null {
  const clientesPorNumero =
    new Map<string, Set<string>>();

  const formatoPorNumero =
    new Map<string, string>();

  for (const cliente of clientes) {
    const contatos = [
      cliente.celular,
      cliente.telefone,
    ];

    for (const contato of contatos) {
      const telefone =
        normalizarTelefoneBrasil(
          contato,
        );

      if (!telefone) {
        continue;
      }

      const numero =
        telefone.numeroComCodigoPais;

      const clientesDoNumero =
        clientesPorNumero.get(numero) ??
        new Set<string>();

      clientesDoNumero.add(
        cliente.id,
      );

      clientesPorNumero.set(
        numero,
        clientesDoNumero,
      );

      formatoPorNumero.set(
        numero,
        telefone.formatoE164,
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

    const telefoneE164 =
      formatoPorNumero.get(numero);

    if (
      clienteId &&
      telefoneE164
    ) {
      return {
        clienteId,
        telefoneE164,
      };
    }
  }

  return null;
}

async function executarTeste():
  Promise<void> {
  console.log(
    "Testando criação e reutilização de conversa BotNext...",
  );

  const conta =
    await prisma.botnextAccount.findFirst({
      where: {
        active:
          true,

        tenant: {
          active:
            true,
        },
      },
      select: {
        id:
          true,

        tenantId:
          true,

        companyId:
          true,

        channelPhone:
          true,
      },
    });

  if (!conta) {
    throw new Error(
      "Nenhuma conta BotNext ativa foi encontrada.",
    );
  }

  const clientes =
    await prisma.cliente.findMany({
      where: {
        tenantId:
          conta.tenantId,

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

  const contato =
    encontrarContatoExclusivo(
      clientes,
    );

  if (!contato) {
    throw new Error(
      "Nenhum telefone exclusivo de cliente foi encontrado para o teste.",
    );
  }

  const sessionId =
    randomUUID();

  const externalMessageId1 =
    randomUUID();

  const externalMessageId2 =
    randomUUID();

  const eventosCriados:
    string[] = [];

  try {
    const criarEvento = async (
      externalMessageId: string,
      texto: string,
      dataEvento: Date,
    ): Promise<string> => {
      const payload: Prisma.InputJsonValue = {
        teste:
          true,

        tipo:
          "TESTE_CONVERSA_BOTNEXT",

        externalMessageId,

        sessionId,
      };

      const evento =
        await prisma.botnextWebhookEvent.create({
          data: {
            tenantId:
              conta.tenantId,

            botnextAccountId:
              conta.id,

            eventType:
              "MESSAGE_RECEIVED",

            externalMessageId,

            companyId:
              conta.companyId,

            sessionId,

            messageType:
              "TEXT",

            direction:
              "FROM_HUB",

            senderPhone:
              contato.telefoneE164,

            recipientPhone:
              conta.channelPhone ??
              "+5541000000000",

            messageText:
              texto,

            eventDate:
              dataEvento,

            payload,

            status:
              BotnextWebhookStatus.RECEIVED,
          },
          select: {
            id:
              true,
          },
        });

      eventosCriados.push(
        evento.id,
      );

      return evento.id;
    };

    const primeiroEventoId =
      await criarEvento(
        externalMessageId1,
        "Primeira mensagem do teste",
        new Date(),
      );

    const primeiroResultado =
      await processarEventoBotnext(
        primeiroEventoId,
      );

    if (
      primeiroResultado.status !==
        BotnextWebhookStatus.PROCESSED ||
      primeiroResultado.clienteId !==
        contato.clienteId ||
      !primeiroResultado.conversaId
    ) {
      throw new Error(
        "A primeira mensagem não criou a conversa corretamente.",
      );
    }

    console.log(
      "OK: primeira mensagem criou a conversa.",
    );

    const segundaData =
      new Date(
        Date.now() + 1_000,
      );

    const segundoEventoId =
      await criarEvento(
        externalMessageId2,
        "Segunda mensagem do teste",
        segundaData,
      );

    const segundoResultado =
      await processarEventoBotnext(
        segundoEventoId,
      );

    if (
      segundoResultado.status !==
        BotnextWebhookStatus.PROCESSED ||
      segundoResultado.conversaId !==
        primeiroResultado.conversaId
    ) {
      throw new Error(
        "A segunda mensagem não reutilizou a conversa.",
      );
    }

    console.log(
      "OK: segunda mensagem reutilizou a mesma conversa.",
    );

    const conversa =
      await prisma.botnextConversation.findUnique({
        where: {
          id:
            primeiroResultado.conversaId,
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
        "A conversa criada não foi encontrada.",
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
        "As mensagens não foram registradas como CUSTOMER.",
      );
    }

    console.log(
      "OK: existe uma conversa com duas mensagens do cliente.",
    );

    const repeticao =
      await processarEventoBotnext(
        primeiroEventoId,
      );

    if (
      repeticao.status !==
        BotnextWebhookStatus.PROCESSED ||
      repeticao.conversaId !==
        conversa.id
    ) {
      throw new Error(
        "A repetição do processamento não foi reconhecida corretamente.",
      );
    }

    const quantidadeDepoisDaRepeticao =
      await prisma
        .botnextConversationMessage
        .count({
          where: {
            conversationId:
              conversa.id,
          },
        });

    if (
      quantidadeDepoisDaRepeticao !== 2
    ) {
      throw new Error(
        "A repetição criou uma mensagem duplicada.",
      );
    }

    console.log(
      "OK: repetição não duplicou a mensagem.",
    );

    console.log(
      "Teste concluído sem IA, envio BotNext ou escrita no ArBrain.",
    );
  } finally {
    await prisma.botnextConversation.deleteMany({
      where: {
        botnextAccountId:
          conta.id,

        sessionId,
      },
    });

    if (eventosCriados.length > 0) {
      await prisma.botnextWebhookEvent.deleteMany({
        where: {
          id: {
            in:
              eventosCriados,
          },
        },
      });
    }
  }
}

executarTeste()
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
      await prisma.$disconnect();
    },
  );