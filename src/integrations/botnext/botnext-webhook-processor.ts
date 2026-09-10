import {
  BotnextWebhookStatus,
} from "@prisma/client";

import {
  prisma,
} from "../../database/prisma.js";

import {
  finalizarEventoBotnextIgnorado,
  finalizarEventoBotnextProcessado,
  registrarFalhaEventoBotnextComPosse,
} from "../../queue/botnext-processing-lease-service.js";

import {
  BOTNEXT_PROCESSING_MAX_ATTEMPTS,
} from "../../queue/botnext-processing-config.js";

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

import {
  processarFluxoPedidoBotnext,
} from "./botnext-pedido-flow-service.js";

export type ResultadoProcessamentoBotnext = {
  processado: boolean;
  obsoleto: boolean;
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
  processingToken: string,
  motivo: string,
): Promise<ResultadoProcessamentoBotnext> {
  const resultado = await finalizarEventoBotnextIgnorado({
    eventoId,
    processingToken,
    motivo,
  });

  if (resultado === "LEASE_LOST") {
    return resultadoObsoleto();
  }

  return {
    processado:
      true,

    obsoleto:
      false,

    status:
      BotnextWebhookStatus.IGNORED,

    clienteId:
      null,

    conversaId:
      null,

    motivo,
  };
}

function resultadoObsoleto(): ResultadoProcessamentoBotnext {
  return {
    processado: false,
    obsoleto: true,
    status: BotnextWebhookStatus.PROCESSING,
    clienteId: null,
    conversaId: null,
    motivo: "LEASE_LOST",
  };
}

export async function processarEventoBotnext(
  eventoId: string,
  processingToken: string,
  possuiPosse: () => boolean = () => true,
): Promise<ResultadoProcessamentoBotnext> {
  if (!possuiPosse()) {
    return resultadoObsoleto();
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
        processingToken,
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
        processingToken,
        "CLIENTE_NAO_ENCONTRADO",
      );
    }

    if (
      clientesEncontrados.length > 1
    ) {
      return await finalizarComoIgnorado(
        evento.id,
        processingToken,
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

    if (!possuiPosse()) {
      return resultadoObsoleto();
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
    if (!possuiPosse()) {
      return resultadoObsoleto();
    }

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
      if (!possuiPosse()) {
        return resultadoObsoleto();
      }

await rotearEventoBotnext({
        tenantId:
          evento.tenantId,

        eventoId:
          evento.id,
      });
    }

    // 4. Fluxo de pedido (Etapa 3.2): extração → rascunho → confirmação →
    // cancelamento → dispatch ao webhook n8n → resposta ao cliente.
    //
    // Ponto ÚNICO de delegação: o processor não conhece a máquina de estados
    // do pedido. Com a IA desligada, processarFluxoPedidoBotnext retorna
    // SEM_PEDIDO sem tocar em nada externo. O fluxo nunca cria pedido na API
    // do cliente — termina no webhook do n8n (PEDIDO_CONFIRMADO_V1).
    if (!possuiPosse()) {
      return resultadoObsoleto();
    }

    if (
      resultadoClassificacao.situacao !==
      "DESATIVADA"
    ) {
      await processarFluxoPedidoBotnext({
        tenantId:
          evento.tenantId,

        eventoId:
          evento.id,
      });
    }

    // 5. O evento só é finalizado depois de:
    //
    // - registrar a mensagem;
    // - classificar, quando a IA estiver ativa;
    // - rotear, quando houver classificação.
    if (!possuiPosse()) {
      return resultadoObsoleto();
    }

    const finalizacao =
      await finalizarEventoBotnextProcessado({
        eventoId: evento.id,
        processingToken,
        clienteId: clienteEncontrado.id,
      });

    if (finalizacao === "LEASE_LOST") {
      return resultadoObsoleto();
    }

    return {
      processado:
        true,

      obsoleto:
        false,

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
    if (!possuiPosse()) {
      return resultadoObsoleto();
    }

    let resultadoFalha:
      | "RECEIVED"
      | "FAILED"
      | "LEASE_LOST";

    try {
      resultadoFalha =
        await registrarFalhaEventoBotnextComPosse({
          eventoId,
          processingToken,
          error,
          maximoTentativas:
            BOTNEXT_PROCESSING_MAX_ATTEMPTS,
        });
    } catch {
      console.error(
        "Não foi possível registrar a falha do evento BotNext; o erro original será preservado.",
      );

      throw error;
    }

    if (resultadoFalha === "LEASE_LOST") {
      return resultadoObsoleto();
    }

    if (resultadoFalha === "FAILED") {
      return {
        processado: false,
        obsoleto: false,
        status: BotnextWebhookStatus.FAILED,
        clienteId: null,
        conversaId: null,
        motivo: error instanceof Error
          ? error.message.slice(0, 2_000)
          : "Falha desconhecida no processamento.",
      };
    }

    throw error;
  }
}
