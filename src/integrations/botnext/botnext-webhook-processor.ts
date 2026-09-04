import {
  BotnextWebhookStatus,
} from "@prisma/client";

import {
  prisma,
} from "../../database/prisma.js";

import {
  normalizarTelefoneBrasil,
} from "../../visitas/telefone-service.js";

import {
  registrarMensagemRecebidaNaConversa,
} from "./botnext-conversation-service.js";

import {
  classificarEventoBotnextSeHabilitado,
} from "./botnext-ai-service.js";

import {
  rotearEventoBotnext,
} from "./botnext-intent-routing-service.js";

export type ResultadoProcessamentoBotnext = {
  processado: boolean;
  status: BotnextWebhookStatus;
  clienteId: string | null;
  conversaId: string | null;
  motivo: string | null;
};

type ClienteParaIdentificacao = {
  id: string;
  celular: string | null;
  telefone: string | null;
};

function clientePossuiTelefone(
  cliente: ClienteParaIdentificacao,
  numeroRecebido: string,
): boolean {
  const telefonesDoCliente = [
    cliente.celular,
    cliente.telefone,
  ];

  return telefonesDoCliente.some((telefone) => {
    const normalizado =
      normalizarTelefoneBrasil(telefone);

    return (
      normalizado?.numeroComCodigoPais ===
      numeroRecebido
    );
  });
}

async function finalizarComoIgnorado(
  eventoId: string,
  motivo: string,
): Promise<ResultadoProcessamentoBotnext> {
  await prisma.botnextWebhookEvent.update({
    where: {
      id: eventoId,
    },
    data: {
      status:
        BotnextWebhookStatus.IGNORED,

      clienteId:
        null,

      processedAt:
        new Date(),

      errorMessage:
        motivo,
    },
  });

  return {
    processado:
      true,

    status:
      BotnextWebhookStatus.IGNORED,

    clienteId:
      null,

    conversaId:
      null,

    motivo,
  };
}

async function registrarFalha(
  eventoId: string,
  error: unknown,
): Promise<void> {
  const mensagem =
    error instanceof Error
      ? error.message.slice(0, 2_000)
      : "Falha desconhecida no processamento.";

  try {
    await prisma.botnextWebhookEvent.updateMany({
      where: {
        id:
          eventoId,

        status:
          BotnextWebhookStatus.PROCESSING,
      },
      data: {
        status:
          BotnextWebhookStatus.FAILED,

        processedAt:
          new Date(),

        errorMessage:
          mensagem,
      },
    });
  } catch {
    console.error(
      "Não foi possível registrar a falha do evento BotNext.",
    );
  }
}

export async function processarEventoBotnext(
  eventoId: string,
): Promise<ResultadoProcessamentoBotnext> {
  // Apenas uma execução consegue reivindicar
  // um evento que está como RECEIVED.
  const reivindicacao =
    await prisma.botnextWebhookEvent.updateMany({
      where: {
        id:
          eventoId,

        status:
          BotnextWebhookStatus.RECEIVED,
      },
      data: {
        status:
          BotnextWebhookStatus.PROCESSING,

        processedAt:
          null,

        errorMessage:
          null,
      },
    });

  if (reivindicacao.count !== 1) {
    const eventoAtual =
      await prisma.botnextWebhookEvent.findUnique({
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

          conversationMessage: {
            select: {
              conversationId:
                true,
            },
          },
        },
      });

    if (!eventoAtual) {
      throw new Error(
        "Evento BotNext não encontrado.",
      );
    }

    return {
      processado:
        false,

      status:
        eventoAtual.status,

      clienteId:
        eventoAtual.clienteId,

      conversaId:
        eventoAtual
          .conversationMessage
          ?.conversationId ??
        null,

      motivo:
        eventoAtual.errorMessage,
    };
  }

  try {
    const evento =
      await prisma.botnextWebhookEvent.findUnique({
        where: {
          id:
            eventoId,
        },
        select: {
          id:
            true,

          tenantId:
            true,

          senderPhone:
            true,
        },
      });

    if (!evento) {
      throw new Error(
        "Evento BotNext não encontrado após reivindicação.",
      );
    }

    const telefoneRemetente =
      normalizarTelefoneBrasil(
        evento.senderPhone,
      );

    if (!telefoneRemetente) {
      return await finalizarComoIgnorado(
        evento.id,
        "TELEFONE_REMETENTE_INVALIDO",
      );
    }

    const clientes =
      await prisma.cliente.findMany({
        where: {
          tenantId:
            evento.tenantId,

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

    const clientesEncontrados =
      clientes.filter((cliente) =>
        clientePossuiTelefone(
          cliente,
          telefoneRemetente
            .numeroComCodigoPais,
        ),
      );

    if (
      clientesEncontrados.length === 0
    ) {
      return await finalizarComoIgnorado(
        evento.id,
        "CLIENTE_NAO_ENCONTRADO",
      );
    }

    if (
      clientesEncontrados.length > 1
    ) {
      return await finalizarComoIgnorado(
        evento.id,
        "TELEFONE_ASSOCIADO_A_MULTIPLOS_CLIENTES",
      );
    }

    const clienteEncontrado =
      clientesEncontrados[0];

    if (!clienteEncontrado) {
      throw new Error(
        "Falha inesperada ao selecionar o cliente.",
      );
    }

    // 1. Registra a mensagem recebida na conversa.
    const registroConversa =
      await registrarMensagemRecebidaNaConversa({
        eventoId:
          evento.id,

        clienteId:
          clienteEncontrado.id,
      });

    // 2. Classifica a mensagem somente quando
    // BOTNEXT_AI_ENABLED estiver habilitado.
    //
    // Uma classificação já persistida é
    // reaproveitada pelo serviço.
    const resultadoClassificacao =
      await classificarEventoBotnextSeHabilitado({
        tenantId:
          evento.tenantId,

        eventoId:
          evento.id,
      });

    // 3. O roteamento só é executado quando
    // a classificação estiver habilitada.
    //
    // O serviço de roteamento lê a classificação
    // persistida, grava a decisão e atualiza o
    // estado da conversa na mesma transação.
    if (
      resultadoClassificacao.situacao !==
      "DESATIVADA"
    ) {
      await rotearEventoBotnext({
        tenantId:
          evento.tenantId,

        eventoId:
          evento.id,
      });
    }

    // 4. O evento só é finalizado depois de:
    //
    // - registrar a mensagem;
    // - classificar, quando a IA estiver ativa;
    // - rotear, quando houver classificação.
    const finalizacao =
      await prisma.botnextWebhookEvent.updateMany({
        where: {
          id:
            evento.id,

          tenantId:
            evento.tenantId,

          status:
            BotnextWebhookStatus.PROCESSING,
        },
        data: {
          status:
            BotnextWebhookStatus.PROCESSED,

          clienteId:
            clienteEncontrado.id,

          processedAt:
            new Date(),

          errorMessage:
            null,
        },
      });

    if (finalizacao.count !== 1) {
      throw new Error(
        "O evento mudou de estado antes da finalização.",
      );
    }

    return {
      processado:
        true,

      status:
        BotnextWebhookStatus.PROCESSED,

      clienteId:
        clienteEncontrado.id,

      conversaId:
        registroConversa.conversaId,

      motivo:
        null,
    };
  } catch (error: unknown) {
    await registrarFalha(
      eventoId,
      error,
    );

    throw error;
  }
}