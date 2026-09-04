import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  BotnextConversationIntent,
  BotnextConversationMessageRole,
  BotnextConversationStatus,
  BotnextWebhookStatus,
} from "@prisma/client";

import {
  prisma,
} from "./database/prisma.js";

import {
  rotearEventoBotnext,
  VERSAO_ROTEADOR_BOTNEXT,
} from "./integrations/botnext/botnext-intent-routing-service.js";

type ClassificacaoTeste = {
  intencao:
    BotnextConversationIntent;

  confianca:
    number;

  justificativa:
    string;

  requerAtendimentoHumano:
    boolean;
};

type MensagemTeste = {
  id:
    string;

  texto:
    string;

  role:
    BotnextConversationMessageRole;

  data:
    Date;

  classificacao?:
    ClassificacaoTeste;
};

async function executarTeste():
  Promise<void> {
  console.log(
    "Testando persistência do roteamento BotNext...",
  );

  const tenantId =
    randomUUID();

  const contaId =
    randomUUID();

  const conversaId =
    randomUUID();

  const companyId =
    randomUUID();

  const sessionId =
    randomUUID();

  const slug =
    `teste-roteamento-${tenantId}`;

  const instanteBase =
    Date.now() - 60_000;

  const criarMensagem = (
    indice: number,
    texto: string,
    role:
      BotnextConversationMessageRole,
    classificacao?:
      ClassificacaoTeste,
  ): MensagemTeste => ({
    id:
      randomUUID(),

    texto,

    role,

    data:
      new Date(
        instanteBase +
        indice * 1_000,
      ),

    classificacao,
  });

  const mensagens = {
    normal:
      criarMensagem(
        0,
        "Qual é o prazo de entrega?",
        BotnextConversationMessageRole
          .CUSTOMER,
        {
          intencao:
            BotnextConversationIntent
              .DUVIDA,

          confianca:
            0.93,

          justificativa:
            "Pergunta sobre entrega.",

          requerAtendimentoHumano:
            false,
        },
      ),

    simultanea:
      criarMensagem(
        1,
        "Quero fazer um pedido.",
        BotnextConversationMessageRole
          .CUSTOMER,
        {
          intencao:
            BotnextConversationIntent
              .FAZER_PEDIDO,

          confianca:
            0.96,

          justificativa:
            "Cliente deseja fazer pedido.",

          requerAtendimentoHumano:
            false,
        },
      ),

    handoff:
      criarMensagem(
        2,
        "Meu pedido chegou errado.",
        BotnextConversationMessageRole
          .CUSTOMER,
        {
          intencao:
            BotnextConversationIntent
              .RECLAMACAO,

          confianca:
            0.91,

          justificativa:
            "Cliente relatou problema no pedido.",

          requerAtendimentoHumano:
            true,
        },
      ),

    semClassificacao:
      criarMensagem(
        3,
        "Mensagem ainda não classificada.",
        BotnextConversationMessageRole
          .CUSTOMER,
      ),

    sistema:
      criarMensagem(
        4,
        "Registro interno do sistema.",
        BotnextConversationMessageRole
          .SYSTEM,
        {
          intencao:
            BotnextConversationIntent
              .DUVIDA,

          confianca:
            0.90,

          justificativa:
            "Classificação fictícia.",

          requerAtendimentoHumano:
            false,
        },
      ),

    confiancaInvalida:
      criarMensagem(
        5,
        "Mensagem com confiança inválida.",
        BotnextConversationMessageRole
          .CUSTOMER,
        {
          intencao:
            BotnextConversationIntent
              .DUVIDA,

          confianca:
            2,

          justificativa:
            "Classificação inválida para teste.",

          requerAtendimentoHumano:
            false,
        },
      ),
  };

  const listaMensagens =
    Object.values(mensagens);

  const idsMensagens =
    listaMensagens.map(
      (mensagem) =>
        mensagem.id,
    );

  function parametros(
    eventoId: string,
  ) {
    return {
      tenantId,
      eventoId,
    };
  }

  function buscarMensagem(
    id: string,
  ) {
    return prisma
      .botnextConversationMessage
      .findUniqueOrThrow({
        where: {
          id,
        },
      });
  }

  let registrosCriados =
    false;

  try {
    await prisma.$transaction(
      async (transaction) => {
        await transaction
          .tenant
          .create({
            data: {
              id:
                tenantId,

              name:
                "Tenant temporário do teste de roteamento",

              slug,

              arbrainDataId:
                -1,

              active:
                false,
            },
          });

        await transaction
          .botnextAccount
          .create({
            data: {
              id:
                contaId,

              tenantId,

              companyId,

              name:
                "Conta fictícia do roteamento",

              active:
                false,
            },
          });

        await transaction
          .botnextConversation
          .create({
            data: {
              id:
                conversaId,

              tenantId,

              botnextAccountId:
                contaId,

              sessionId,

              status:
                BotnextConversationStatus
                  .ACTIVE,

              lastMessageAt:
                listaMensagens[
                  listaMensagens.length -
                  1
                ]?.data ??
                new Date(),
            },
          });

        await transaction
          .botnextWebhookEvent
          .createMany({
            data:
              listaMensagens.map(
                (mensagem) => ({
                  id:
                    mensagem.id,

                  tenantId,

                  botnextAccountId:
                    contaId,

                  companyId,

                  sessionId,

                  eventType:
                    "TESTE_ROTEAMENTO",

                  externalMessageId:
                    mensagem.id,

                  messageType:
                    "TEXT",

                  messageText:
                    mensagem.texto,

                  eventDate:
                    mensagem.data,

                  payload: {
                    teste:
                      true,

                    origem:
                      "test-botnext-intent-routing-persistence",
                  },

                  status:
                    BotnextWebhookStatus
                      .IGNORED,

                  processedAt:
                    new Date(),

                  errorMessage:
                    "EVENTO_FICTICIO_SEM_FILA",
                }),
              ),
          });

        await transaction
          .botnextConversationMessage
          .createMany({
            data:
              listaMensagens.map(
                (mensagem) => ({
                  id:
                    mensagem.id,

                  conversationId:
                    conversaId,

                  webhookEventId:
                    mensagem.id,

                  externalMessageId:
                    mensagem.id,

                  role:
                    mensagem.role,

                  messageType:
                    "TEXT",

                  text:
                    mensagem.texto,

                  eventDate:
                    mensagem.data,

                  ...(mensagem.classificacao
                    ? {
                        detectedIntent:
                          mensagem
                            .classificacao
                            .intencao,

                        intentConfidence:
                          mensagem
                            .classificacao
                            .confianca,

                        intentReason:
                          mensagem
                            .classificacao
                            .justificativa,

                        requiresHumanHandoff:
                          mensagem
                            .classificacao
                            .requerAtendimentoHumano,

                        classificationModel:
                          "simulado-sem-api",

                        classificationVersion:
                          "teste-classificacao-v1",

                        classifiedAt:
                          new Date(),
                      }
                    : {}),
                }),
              ),
          });
      },
    );

    registrosCriados =
      true;

    // 1. Tenant incorreto.
    await assert.rejects(
      () =>
        rotearEventoBotnext({
          tenantId:
            randomUUID(),

          eventoId:
            mensagens.normal.id,
        }),
      /tenant informado/,
    );

    assert.equal(
      (
        await buscarMensagem(
          mensagens.normal.id,
        )
      ).routedAt,
      null,
    );

    console.log(
      "OK: tenant incorreto não gravou roteamento.",
    );

    // 2. Primeiro roteamento.
    const primeiro =
      await rotearEventoBotnext(
        parametros(
          mensagens.normal.id,
        ),
      );

    assert.equal(
      primeiro.situacao,
      "ROTEADA",
    );

    assert.equal(
      primeiro.decisao.acao,
      "RESPONDER_DUVIDA",
    );

    assert.equal(
      primeiro
        .decisao
        .statusSugerido,
      BotnextConversationStatus
        .WAITING_CUSTOMER,
    );

    assert.equal(
      primeiro
        .decisao
        .requerAtendimentoHumano,
      false,
    );

    assert.equal(
      primeiro.versao,
      VERSAO_ROTEADOR_BOTNEXT,
    );

    assert.ok(
      primeiro.roteadaEm instanceof
        Date,
    );

    assert.equal(
      primeiro.statusAnterior,
      BotnextConversationStatus
        .ACTIVE,
    );

    assert.equal(
      primeiro.statusAtual,
      BotnextConversationStatus
        .WAITING_CUSTOMER,
    );

    assert.equal(
      primeiro.conversaAtualizada,
      true,
    );

    const conversaAposDuvida =
      await prisma
        .botnextConversation
        .findUniqueOrThrow({
          where: {
            id:
              conversaId,
          },
        });

    assert.equal(
      conversaAposDuvida.status,
      BotnextConversationStatus
        .WAITING_CUSTOMER,
    );

    assert.equal(
      conversaAposDuvida.closedAt,
      null,
    );

    const normalSalva =
      await buscarMensagem(
        mensagens.normal.id,
      );

    assert.equal(
      normalSalva.routingAction,
      "RESPONDER_DUVIDA",
    );

    assert.equal(
      normalSalva.routingStatus,
      BotnextConversationStatus
        .WAITING_CUSTOMER,
    );

    assert.equal(
      normalSalva.routingReason,
      primeiro.decisao.motivo,
    );

    assert.equal(
      normalSalva.routingVersion,
      VERSAO_ROTEADOR_BOTNEXT,
    );

    assert.ok(
      normalSalva.routedAt instanceof
        Date,
    );

    console.log(
      "OK: decisão foi persistida e a conversa passou para WAITING_CUSTOMER.",
    );

    // 3. Repetição idempotente.
    const repetido =
      await rotearEventoBotnext(
        parametros(
          mensagens.normal.id,
        ),
      );

    assert.equal(
      repetido.situacao,
      "JA_ROTEADA",
    );

    assert.deepEqual(
      repetido.decisao,
      primeiro.decisao,
    );

    assert.equal(
      repetido.roteadaEm.getTime(),
      primeiro.roteadaEm.getTime(),
    );

    assert.deepEqual(
      await buscarMensagem(
        mensagens.normal.id,
      ),
      normalSalva,
    );

    assert.equal(
      repetido.statusAnterior,
      BotnextConversationStatus
        .WAITING_CUSTOMER,
    );

    assert.equal(
      repetido.statusAtual,
      BotnextConversationStatus
        .WAITING_CUSTOMER,
    );

    assert.equal(
      repetido.conversaAtualizada,
      false,
    );

    console.log(
      "OK: repetição reaproveitou o roteamento persistido.",
    );

    // 4. Chamadas simultâneas.
    const resultadosSimultaneos =
      await Promise.all([
        rotearEventoBotnext(
          parametros(
            mensagens.simultanea.id,
          ),
        ),

        rotearEventoBotnext(
          parametros(
            mensagens.simultanea.id,
          ),
        ),

        rotearEventoBotnext(
          parametros(
            mensagens.simultanea.id,
          ),
        ),
      ]);

    const quantidadeNovos =
      resultadosSimultaneos.filter(
        (resultado) =>
          resultado.situacao ===
          "ROTEADA",
      ).length;

    const quantidadeReaproveitados =
      resultadosSimultaneos.filter(
        (resultado) =>
          resultado.situacao ===
          "JA_ROTEADA",
      ).length;

    assert.equal(
      quantidadeNovos,
      1,
    );

    assert.equal(
      quantidadeReaproveitados,
      2,
    );

    for (
      const resultado of
      resultadosSimultaneos
    ) {
      assert.equal(
        resultado.decisao.acao,
        "INICIAR_PEDIDO",
      );

      assert.equal(
        resultado
          .decisao
          .statusSugerido,
        BotnextConversationStatus
          .ACTIVE,
      );
    }

    const conversaAposPedido =
      await prisma
        .botnextConversation
        .findUniqueOrThrow({
          where: {
            id:
              conversaId,
          },
        });

    assert.equal(
      conversaAposPedido.status,
      BotnextConversationStatus
        .ACTIVE,
    );

    assert.equal(
      conversaAposPedido.closedAt,
      null,
    );

    assert.equal(
      resultadosSimultaneos.filter(
        (resultado) =>
          resultado.conversaAtualizada,
      ).length,
      1,
    );

    console.log(
      "OK: chamadas simultâneas salvaram uma decisão e alteraram a conversa uma vez.",
    );

    // 5. Handoff.
    const handoff =
      await rotearEventoBotnext(
        parametros(
          mensagens.handoff.id,
        ),
      );

    assert.equal(
      handoff.decisao.acao,
      "ENCAMINHAR_ATENDIMENTO_HUMANO",
    );

    assert.equal(
      handoff
        .decisao
        .statusSugerido,
      BotnextConversationStatus
        .HUMAN_HANDOFF,
    );

    assert.equal(
      handoff
        .decisao
        .requerAtendimentoHumano,
      true,
    );

    console.log(
      "OK: reclamação foi roteada para atendimento humano.",
    );

    // 6. Mensagem sem classificação.
    await assert.rejects(
      () =>
        rotearEventoBotnext(
          parametros(
            mensagens
              .semClassificacao
              .id,
          ),
        ),
      /classificação completa/,
    );

    assert.equal(
      (
        await buscarMensagem(
          mensagens
            .semClassificacao
            .id,
        )
      ).routedAt,
      null,
    );

    console.log(
      "OK: mensagem sem classificação foi rejeitada.",
    );

    // 7. Mensagem que não pertence ao cliente.
    await assert.rejects(
      () =>
        rotearEventoBotnext(
          parametros(
            mensagens.sistema.id,
          ),
        ),
      /Somente mensagens do cliente/,
    );

    assert.equal(
      (
        await buscarMensagem(
          mensagens.sistema.id,
        )
      ).routedAt,
      null,
    );

    console.log(
      "OK: mensagem de sistema não foi roteada.",
    );

    // 8. Confiança inválida.
    await assert.rejects(
      () =>
        rotearEventoBotnext(
          parametros(
            mensagens
              .confiancaInvalida
              .id,
          ),
        ),
      /entre 0 e 1/,
    );

    assert.equal(
      (
        await buscarMensagem(
          mensagens
            .confiancaInvalida
            .id,
        )
      ).routedAt,
      null,
    );

    console.log(
      "OK: confiança inválida não gerou roteamento.",
    );

    // 9. Registro de roteamento incompleto.
    await prisma
      .botnextConversationMessage
      .update({
        where: {
          id:
            mensagens.normal.id,
        },

        data: {
          routingReason:
            null,
        },
      });

    await assert.rejects(
      () =>
        rotearEventoBotnext(
          parametros(
            mensagens.normal.id,
          ),
        ),
      /incompleta ou inválida/,
    );

    console.log(
      "OK: roteamento persistido incompleto foi rejeitado.",
    );

    // 10. O handoff alterou o estado da conversa.
    const conversaFinal =
      await prisma
        .botnextConversation
        .findUniqueOrThrow({
          where: {
            id:
              conversaId,
          },
        });

    assert.equal(
      conversaFinal.status,
      BotnextConversationStatus
        .HUMAN_HANDOFF,
    );

    assert.equal(
      conversaFinal.closedAt,
      null,
    );

    assert.equal(
      handoff.statusAnterior,
      BotnextConversationStatus
        .ACTIVE,
    );

    assert.equal(
      handoff.statusAtual,
      BotnextConversationStatus
        .HUMAN_HANDOFF,
    );

    assert.equal(
      handoff.conversaAtualizada,
      true,
    );

    console.log(
      "OK: estado final da conversa é HUMAN_HANDOFF.",
    );
  } finally {
    if (registrosCriados) {
      await prisma.$transaction([
        prisma
          .botnextConversationMessage
          .deleteMany({
            where: {
              id: {
                in:
                  idsMensagens,
              },

              conversationId:
                conversaId,
            },
          }),

        prisma
          .botnextWebhookEvent
          .deleteMany({
            where: {
              id: {
                in:
                  idsMensagens,
              },

              tenantId,
            },
          }),

        prisma
          .botnextConversation
          .deleteMany({
            where: {
              id:
                conversaId,

              tenantId,

              sessionId,
            },
          }),

        prisma
          .botnextAccount
          .deleteMany({
            where: {
              id:
                contaId,

              tenantId,

              companyId,
            },
          }),

        prisma.tenant.deleteMany({
          where: {
            id:
              tenantId,

            slug,

            active:
              false,
          },
        }),
      ]);

      console.log(
        "OK: registros temporários desta execução removidos.",
      );
    }
  }

  console.log(
    "Teste de persistência do roteamento aprovado.",
  );

  console.log(
    "Sem OpenAI, Redis, envio BotNext ou escrita no ArBrain.",
  );
}

executarTeste()
  .catch((error: unknown) => {
    console.error(
      "Falha no teste:",
      error instanceof Error
        ? error.message
        : "Erro desconhecido",
    );

    process.exitCode =
      1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
