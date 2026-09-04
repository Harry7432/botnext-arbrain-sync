import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  BotnextConversationStatus,
  BotnextWebhookStatus,
} from "@prisma/client";

import { prisma } from "./database/prisma.js";

import {
  salvarClassificacaoBotnext,
} from "./integrations/botnext/botnext-intent-persistence.js";

import type {
  SalvarClassificacaoBotnextParams,
} from "./integrations/botnext/botnext-intent-persistence.js";

type Classificacao =
  SalvarClassificacaoBotnextParams["classificacao"];

type MensagemTeste = {
  id: string;
  texto: string;
  data: Date;
};

async function executarTeste(): Promise<void> {
  console.log(
    "Testando persistência com classificações simuladas...",
  );

  const tenantId = randomUUID();
  const contaId = randomUUID();
  const conversaId = randomUUID();
  const companyId = randomUUID();
  const sessionId = randomUUID();
  const slug = `teste-intencao-${tenantId}`;

  const modelo = "simulado-sem-api";
  const versao = "teste-v1";
  const instanteBase = Date.now() - 60_000;

  const mensagens = {
    antiga: {
      id: randomUUID(),
      texto: "Meu pedido anterior chegou errado.",
      data: new Date(instanteBase),
    },
    inicial: {
      id: randomUUID(),
      texto: "Qual é o prazo de entrega?",
      data: new Date(instanteBase + 1_000),
    },
    recente: {
      id: randomUUID(),
      texto: "Quero falar com um atendente.",
      data: new Date(instanteBase + 2_000),
    },
    empatada: {
      id: randomUUID(),
      texto: "Não quero comprar agora.",
      data: new Date(instanteBase + 2_000),
    },
    concorrente: {
      id: randomUUID(),
      texto: "Gostaria de informações sobre um pedido.",
      data: new Date(instanteBase + 3_000),
    },
  } satisfies Record<string, MensagemTeste>;

  const listaMensagens = Object.values(mensagens);
  const idsMensagens = listaMensagens.map(
    (mensagem) => mensagem.id,
  );

    const duvida: Classificacao = {
    intencao: "DUVIDA",
    confianca: 0.92,
    justificativa: "Pergunta sobre prazo de entrega.",
    requerAtendimentoHumano: false,
  };

  const pedido: Classificacao = {
    intencao: "FAZER_PEDIDO",
    confianca: 0.96,
    justificativa: "Solicitação de pedido.",
    requerAtendimentoHumano: false,
  };

  const reclamacao: Classificacao = {
    intencao: "RECLAMACAO",
    confianca: 0.94,
    justificativa: "Relato de problema no pedido.",
    requerAtendimentoHumano: true,
  };

  const atendimento: Classificacao = {
    intencao: "ATENDIMENTO_HUMANO",
    confianca: 0.99,
    justificativa: "Solicitação explícita de atendente.",
    requerAtendimentoHumano: true,
  };

  const naoDeseja: Classificacao = {
    intencao: "NAO_DESEJA_PEDIDO",
    confianca: 0.95,
    justificativa: "Cliente não deseja comprar agora.",
    requerAtendimentoHumano: false,
  };

  function salvar(
    mensagem: MensagemTeste,
    classificacao: Classificacao,
  ) {
    return salvarClassificacaoBotnext({
      tenantId,
      eventoId: mensagem.id,
      classificacao,
      modelo,
      versao,
    });
  }

  function buscarMensagem(mensagem: MensagemTeste) {
    return prisma.botnextConversationMessage.findUniqueOrThrow({
      where: {
        id: mensagem.id,
      },
    });
  }

  function buscarConversa() {
    return prisma.botnextConversation.findUniqueOrThrow({
      where: {
        id: conversaId,
      },
    });
  }

  let registrosCriados = false;

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.tenant.create({
        data: {
          id: tenantId,
          name: "Tenant temporário de teste de intenção",
          slug,
          arbrainDataId: -1,
          active: false,
        },
      });

      await transaction.botnextAccount.create({
        data: {
          id: contaId,
          tenantId,
          companyId,
          name: "Conta fictícia de teste",
          active: false,
        },
      });

      await transaction.botnextConversation.create({
        data: {
          id: conversaId,
          tenantId,
          botnextAccountId: contaId,
          sessionId,
          status: BotnextConversationStatus.ACTIVE,
          lastMessageAt: mensagens.concorrente.data,
        },
      });

      await transaction.botnextWebhookEvent.createMany({
        data: listaMensagens.map((mensagem) => ({
          id: mensagem.id,
          tenantId,
          botnextAccountId: contaId,
          companyId,
          sessionId,
          eventType: "TESTE_PERSISTENCIA_INTENCAO",
          externalMessageId: mensagem.id,
          messageType: "TEXT",
          messageText: mensagem.texto,
          eventDate: mensagem.data,
          payload: {
            teste: true,
            origem: "test-botnext-intent-persistence",
          },

          // Fora dos estados recuperados pelo worker.
          status: BotnextWebhookStatus.IGNORED,
          processedAt: new Date(),
          errorMessage: "EVENTO_FICTICIO_SEM_FILA",
        })),
      });

      await transaction.botnextConversationMessage.createMany({
        data: listaMensagens.map((mensagem) => ({
          id: mensagem.id,
          conversationId: conversaId,
          webhookEventId: mensagem.id,
          externalMessageId: mensagem.id,
          role: "CUSTOMER",
          messageType: "TEXT",
          text: mensagem.texto,
          eventDate: mensagem.data,
        })),
      });
    });

    registrosCriados = true;

    // 1. Primeira classificação.
    const primeira = await salvar(
      mensagens.inicial,
      duvida,
    );

    assert.equal(primeira.classificacaoSalva, true);
    assert.equal(primeira.conversaAtualizada, true);
    assert.equal(primeira.conversaId, conversaId);

    const mensagemInicial =
      await buscarMensagem(mensagens.inicial);

    assert.equal(mensagemInicial.detectedIntent, "DUVIDA");
    assert.equal(mensagemInicial.intentConfidence, 0.92);
    assert.equal(
      mensagemInicial.intentReason,
      duvida.justificativa,
    );
    assert.equal(
      mensagemInicial.requiresHumanHandoff,
      false,
    );
    assert.equal(mensagemInicial.classificationModel, modelo);
    assert.equal(mensagemInicial.classificationVersion, versao);
    assert.ok(mensagemInicial.classifiedAt instanceof Date);

    const conversaInicial = await buscarConversa();

    assert.equal(conversaInicial.intent, "DUVIDA");
    assert.equal(conversaInicial.intentConfidence, 0.92);
    assert.equal(
      conversaInicial.intentUpdatedAt?.getTime(),
      mensagens.inicial.data.getTime(),
    );

    console.log(
      "OK: classificação e metadados foram persistidos.",
    );

    // 2. Repetir com outro resultado não sobrescreve.
    const repeticao = await salvar(
      mensagens.inicial,
      pedido,
    );

    assert.equal(repeticao.classificacaoSalva, false);
    assert.equal(repeticao.conversaAtualizada, false);

    assert.deepEqual(
      await buscarMensagem(mensagens.inicial),
      mensagemInicial,
    );

    assert.deepEqual(
      await buscarConversa(),
      conversaInicial,
    );

    console.log(
      "OK: repetição não sobrescreveu mensagem nem conversa.",
    );

    // 3. Mensagem antiga fica no histórico, sem regredir
    // a intenção atual da conversa.
    const antiga = await salvar(
      mensagens.antiga,
      reclamacao,
    );

    assert.equal(antiga.classificacaoSalva, true);
    assert.equal(antiga.conversaAtualizada, false);

    const mensagemAntiga =
      await buscarMensagem(mensagens.antiga);

    assert.equal(
      mensagemAntiga.detectedIntent,
      "RECLAMACAO",
    );

    assert.equal(
      mensagemAntiga.requiresHumanHandoff,
      true,
    );

    assert.deepEqual(
      await buscarConversa(),
      conversaInicial,
    );

    console.log(
      "OK: mensagem antiga não substituiu a intenção atual.",
    );

    // 4. Mensagem mais recente atualiza o resumo.
    const recente = await salvar(
      mensagens.recente,
      atendimento,
    );

    assert.equal(recente.classificacaoSalva, true);
    assert.equal(recente.conversaAtualizada, true);

    const conversaRecente = await buscarConversa();

    assert.equal(
      conversaRecente.intent,
      "ATENDIMENTO_HUMANO",
    );

    assert.equal(
      conversaRecente.requiresHumanHandoff,
      true,
    );

    assert.equal(
      conversaRecente.intentUpdatedAt?.getTime(),
      mensagens.recente.data.getTime(),
    );

    // O indicador não executa uma transferência.
    assert.equal(
      conversaRecente.status,
      BotnextConversationStatus.ACTIVE,
    );

    assert.equal(conversaRecente.closedAt, null);

    console.log(
      "OK: mensagem recente atualizou a intenção sem alterar o estado.",
    );

    // 5. Em datas iguais, preserva o resumo já salvo.
    const empate = await salvar(
      mensagens.empatada,
      naoDeseja,
    );

    assert.equal(empate.classificacaoSalva, true);
    assert.equal(empate.conversaAtualizada, false);

    assert.deepEqual(
      await buscarConversa(),
      conversaRecente,
    );

    console.log(
      "OK: empate de datas preservou a intenção existente.",
    );

    // 6. Tenant incorreto não acessa a mensagem.
    await assert.rejects(
      () => salvarClassificacaoBotnext({
        tenantId: randomUUID(),
        eventoId: mensagens.concorrente.id,
        classificacao: duvida,
        modelo,
        versao,
      }),
      /tenant informado/,
    );

    assert.equal(
      (await buscarMensagem(mensagens.concorrente)).classifiedAt,
      null,
    );

    console.log(
      "OK: tenant incorreto foi bloqueado sem gravar a classificação.",
    );

    // 7. Confiança inválida não gera gravação.
    await assert.rejects(
      () => salvar(mensagens.concorrente, {
        ...duvida,
        confianca: 1.5,
      }),
      /confiança/,
    );

    assert.equal(
      (await buscarMensagem(mensagens.concorrente)).classifiedAt,
      null,
    );

    console.log(
      "OK: confiança inválida foi rejeitada.",
    );

    // 8. Duas chamadas simultâneas para a mesma mensagem.
    const resultados = await Promise.all([
      salvar(mensagens.concorrente, duvida),
      salvar(mensagens.concorrente, pedido),
    ]);

    assert.equal(
      resultados.filter(
        (resultado) => resultado.classificacaoSalva,
      ).length,
      1,
    );

    assert.equal(
      resultados.filter(
        (resultado) => resultado.conversaAtualizada,
      ).length,
      1,
    );

    const vencedora =
      resultados[0].classificacaoSalva
        ? duvida
        : pedido;

    const mensagemFinal =
      await buscarMensagem(mensagens.concorrente);

    const conversaFinal = await buscarConversa();

    assert.equal(
      mensagemFinal.detectedIntent,
      vencedora.intencao,
    );

    assert.equal(
      mensagemFinal.intentConfidence,
      vencedora.confianca,
    );

    assert.equal(
      mensagemFinal.intentReason,
      vencedora.justificativa,
    );

    assert.equal(
      conversaFinal.intent,
      vencedora.intencao,
    );

    assert.equal(
      conversaFinal.intentConfidence,
      vencedora.confianca,
    );

    assert.equal(
      conversaFinal.requiresHumanHandoff,
      vencedora.requerAtendimentoHumano,
    );

    assert.equal(
      conversaFinal.intentUpdatedAt?.getTime(),
      mensagens.concorrente.data.getTime(),
    );

    assert.equal(
      conversaFinal.status,
      BotnextConversationStatus.ACTIVE,
    );

    assert.equal(conversaFinal.closedAt, null);

    console.log(
      "OK: apenas uma classificação venceu as chamadas simultâneas.",
    );
  } finally {
    if (registrosCriados) {
      // Remove somente os registros com IDs gerados
      // por esta execução, respeitando as relações.
      await prisma.$transaction([
        prisma.botnextConversationMessage.deleteMany({
          where: {
            id: { in: idsMensagens },
            conversationId: conversaId,
          },
        }),

        prisma.botnextWebhookEvent.deleteMany({
          where: {
            id: { in: idsMensagens },
            tenantId,
          },
        }),

        prisma.botnextConversation.deleteMany({
          where: {
            id: conversaId,
            tenantId,
            sessionId,
          },
        }),

        prisma.botnextAccount.deleteMany({
          where: {
            id: contaId,
            tenantId,
            companyId,
          },
        }),

        prisma.tenant.deleteMany({
          where: {
            id: tenantId,
            slug,
            active: false,
          },
        }),
      ]);

      console.log(
        "OK: registros temporários desta execução removidos.",
      );
    }
  }

  console.log("Teste de persistência aprovado.");
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

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });