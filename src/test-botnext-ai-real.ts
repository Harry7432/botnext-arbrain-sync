import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  BotnextConversationMessageRole,
  BotnextConversationStatus,
  BotnextWebhookStatus,
} from "@prisma/client";

import {
  prisma,
} from "./database/prisma.js";

import {
  classificarEventoBotnextSeHabilitado,
} from "./integrations/botnext/botnext-ai-service.js";

async function executarTeste(): Promise<void> {
  console.log(
    "Testando classificação real e isolada com a OpenAI...",
  );

  const configuracaoOriginal =
    process.env.BOTNEXT_AI_ENABLED;

  const tenantId = randomUUID();
  const contaId = randomUUID();
  const conversaId = randomUUID();
  const eventoId = randomUUID();
  const companyId = randomUUID();
  const sessionId = randomUUID();

  const slug =
    `teste-openai-real-${tenantId}`;

  const texto =
    "Quero falar com um atendente humano.";

  const dataMensagem =
    new Date();

  const modeloEsperado =
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-5-nano";

  let registrosCriados = false;

  try {
    if (
      !process.env.OPENAI_API_KEY?.trim()
    ) {
      throw new Error(
        "OPENAI_API_KEY não está configurada.",
      );
    }

    // Ativa a IA somente neste processo de teste.
    // O arquivo .env continua com a IA desativada.
    process.env.BOTNEXT_AI_ENABLED =
      "true";

    await prisma.$transaction(
      async (transaction) => {
        await transaction.tenant.create({
          data: {
            id:
              tenantId,

            name:
              "Tenant temporário do teste real OpenAI",

            slug,

            arbrainDataId:
              -1,

            active:
              false,
          },
        });

        await transaction.botnextAccount.create({
          data: {
            id:
              contaId,

            tenantId,

            companyId,

            name:
              "Conta fictícia do teste real OpenAI",

            active:
              false,
          },
        });

        await transaction.botnextConversation.create({
          data: {
            id:
              conversaId,

            tenantId,

            botnextAccountId:
              contaId,

            sessionId,

            status:
              BotnextConversationStatus.ACTIVE,

            lastMessageAt:
              dataMensagem,
          },
        });

        await transaction.botnextWebhookEvent.create({
          data: {
            id:
              eventoId,

            tenantId,

            botnextAccountId:
              contaId,

            companyId,

            sessionId,

            eventType:
              "TESTE_OPENAI_REAL",

            externalMessageId:
              eventoId,

            messageType:
              "TEXT",

            messageText:
              texto,

            eventDate:
              dataMensagem,

            payload: {
              teste:
                true,

              origem:
                "test-botnext-ai-real",
            },

            // O evento não entra na fila do worker.
            status:
              BotnextWebhookStatus.IGNORED,

            processedAt:
              new Date(),

            errorMessage:
              "EVENTO_FICTICIO_SEM_FILA",
          },
        });

        await transaction
          .botnextConversationMessage
          .create({
            data: {
              id:
                eventoId,

              conversationId:
                conversaId,

              webhookEventId:
                eventoId,

              externalMessageId:
                eventoId,

              role:
                BotnextConversationMessageRole.CUSTOMER,

              messageType:
                "TEXT",

              text:
                texto,

              eventDate:
                dataMensagem,
            },
          });
      },
    );

    registrosCriados = true;

    console.log(
      `Executando uma classificação com ${modeloEsperado}...`,
    );

    const primeira =
      await classificarEventoBotnextSeHabilitado({
        tenantId,
        eventoId,
      });

    assert.ok(
      primeira,
      "A classificação não deveria ser ignorada com a IA habilitada.",
    );

    assert.equal(
      primeira.situacao,
      "CLASSIFICADA",
    );

    assert.equal(
      primeira.classificacao.intencao,
      "ATENDIMENTO_HUMANO",
    );

    assert.equal(
      primeira.classificacao
        .requerAtendimentoHumano,
      true,
    );

    assert.ok(
      primeira.classificacao.confianca >= 0 &&
      primeira.classificacao.confianca <= 1,
      "A confiança deve estar entre 0 e 1.",
    );

    assert.ok(
      primeira.classificacao
        .justificativa
        .trim()
        .length > 0,
      "A justificativa não pode estar vazia.",
    );

    assert.equal(
      primeira.modelo,
      modeloEsperado,
    );

    assert.equal(
      primeira.versao,
      "botnext-intent-v1",
    );

    assert.ok(
      primeira.classificadaEm instanceof Date,
    );

    const mensagemSalva =
      await prisma
        .botnextConversationMessage
        .findUniqueOrThrow({
          where: {
            id:
              eventoId,
          },
        });

    assert.equal(
      mensagemSalva.detectedIntent,
      "ATENDIMENTO_HUMANO",
    );

    assert.equal(
      mensagemSalva.intentConfidence,
      primeira.classificacao.confianca,
    );

    assert.equal(
      mensagemSalva.intentReason,
      primeira.classificacao.justificativa,
    );

    assert.equal(
      mensagemSalva.requiresHumanHandoff,
      true,
    );

    assert.equal(
      mensagemSalva.classificationModel,
      modeloEsperado,
    );

    assert.equal(
      mensagemSalva.classificationVersion,
      "botnext-intent-v1",
    );

    assert.ok(
      mensagemSalva.classifiedAt instanceof Date,
    );

    const conversaSalva =
      await prisma
        .botnextConversation
        .findUniqueOrThrow({
          where: {
            id:
              conversaId,
          },
        });

    assert.equal(
      conversaSalva.intent,
      "ATENDIMENTO_HUMANO",
    );

    assert.equal(
      conversaSalva.intentConfidence,
      primeira.classificacao.confianca,
    );

    assert.equal(
      conversaSalva.requiresHumanHandoff,
      true,
    );

    assert.ok(
      conversaSalva.intentUpdatedAt instanceof Date,
    );

    assert.equal(
      conversaSalva.status,
      BotnextConversationStatus.ACTIVE,
    );

    assert.equal(
      conversaSalva.closedAt,
      null,
    );

    console.log(
      "OK: a OpenAI classificou a mensagem corretamente.",
    );

    console.log(
      "OK: classificação e metadados foram persistidos.",
    );

    console.log(
      `Intenção: ${primeira.classificacao.intencao}`,
    );

    console.log(
      `Confiança: ${primeira.classificacao.confianca}`,
    );

    console.log(
      `Atendimento humano: ${primeira.classificacao.requerAtendimentoHumano}`,
    );

    // A segunda execução deve ler a classificação
    // já salva, sem classificar novamente.
    const repetida =
      await classificarEventoBotnextSeHabilitado({
        tenantId,
        eventoId,
      });

    assert.ok(repetida);

    assert.equal(
      repetida.situacao,
      "JA_CLASSIFICADA",
    );

    assert.deepEqual(
      repetida.classificacao,
      primeira.classificacao,
    );

    assert.equal(
      repetida.modelo,
      primeira.modelo,
    );

    assert.equal(
      repetida.versao,
      primeira.versao,
    );

    assert.equal(
      repetida.classificadaEm.getTime(),
      primeira.classificadaEm.getTime(),
    );

    assert.deepEqual(
      await prisma
        .botnextConversationMessage
        .findUniqueOrThrow({
          where: {
            id:
              eventoId,
          },
        }),
      mensagemSalva,
    );

    console.log(
      "OK: repetição reaproveitou a classificação persistida.",
    );

    console.log(
      "Teste real da OpenAI aprovado.",
    );

    console.log(
      "Nenhuma mensagem foi enviada ao BotNext ou ao ArBrain.",
    );
  } finally {
    if (
      configuracaoOriginal === undefined
    ) {
      delete process.env
        .BOTNEXT_AI_ENABLED;
    } else {
      process.env.BOTNEXT_AI_ENABLED =
        configuracaoOriginal;
    }

    if (registrosCriados) {
      await prisma.$transaction([
        prisma
          .botnextConversationMessage
          .deleteMany({
            where: {
              id:
                eventoId,

              conversationId:
                conversaId,
            },
          }),

        prisma.botnextWebhookEvent.deleteMany({
          where: {
            id:
              eventoId,

            tenantId,
          },
        }),

        prisma.botnextConversation.deleteMany({
          where: {
            id:
              conversaId,

            tenantId,

            sessionId,
          },
        }),

        prisma.botnextAccount.deleteMany({
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
        "OK: registros temporários do teste foram removidos.",
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