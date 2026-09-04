import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  BotnextConversationMessageRole,
  BotnextConversationStatus,
  BotnextWebhookStatus,
} from "@prisma/client";

import { prisma } from "./database/prisma.js";

import {
  criarServicoClassificacaoBotnext,
} from "./integrations/botnext/botnext-message-classification-service.js";

import type {
  ResultadoClassificacaoIntencao,
} from "./ai/botnext-intent-classifier.js";

async function executarTeste(): Promise<void> {
  console.log(
    "Testando classificação com provedor simulado...",
  );

  const tenantId = randomUUID();
  const contaId = randomUUID();
  const conversaId = randomUUID();
  const companyId = randomUUID();
  const sessionId = randomUUID();
  const slug = `teste-servico-intencao-${tenantId}`;

  const mensagens = {
    normal: {
      id: randomUUID(),
      texto: "Qual é o prazo de entrega?",
      role: BotnextConversationMessageRole.CUSTOMER,
    },
    simultanea: {
      id: randomUUID(),
      texto: "Quais são as formas de pagamento?",
      role: BotnextConversationMessageRole.CUSTOMER,
    },
    tentativa: {
      id: randomUUID(),
      texto: "Vocês entregam aos sábados?",
      role: BotnextConversationMessageRole.CUSTOMER,
    },
    vazia: {
      id: randomUUID(),
      texto: "   ",
      role: BotnextConversationMessageRole.CUSTOMER,
    },
    sistema: {
      id: randomUUID(),
      texto: "Registro interno do sistema.",
      role: BotnextConversationMessageRole.SYSTEM,
    },
  };

  const instanteBase = Date.now() - 60_000;

  const listaMensagens = Object.values(mensagens).map(
    (mensagem, indice) => ({
      ...mensagem,
      data: new Date(instanteBase + indice * 1_000),
    }),
  );

  const idsMensagens = listaMensagens.map(
    (mensagem) => mensagem.id,
  );

  const classificacao: ResultadoClassificacaoIntencao = {
    intencao: "DUVIDA",
    confianca: 0.93,
    justificativa: "Pergunta sobre condições de atendimento.",
    requerAtendimentoHumano: false,
  };

  let chamadas = 0;
  const textosRecebidos: string[] = [];

  // Uma única instância compartilhada pelas chamadas.
  const classificarMensagem =
    criarServicoClassificacaoBotnext({
      modelo: "simulado-sem-api",
      versao: "teste-v1",

      classificar: async (texto) => {
        chamadas += 1;
        textosRecebidos.push(texto);

        return { ...classificacao };
      },
    });

  function parametros(eventoId: string) {
    return {
      tenantId,
      eventoId,
    };
  }

  function buscarMensagem(id: string) {
    return prisma.botnextConversationMessage.findUniqueOrThrow({
      where: { id },
    });
  }

  function buscarConversa() {
    return prisma.botnextConversation.findUniqueOrThrow({
      where: { id: conversaId },
    });
  }

  let registrosCriados = false;

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.tenant.create({
        data: {
          id: tenantId,
          name: "Tenant temporário de teste do classificador",
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
          lastMessageAt: new Date(
            instanteBase + (listaMensagens.length - 1) * 1_000,
          ),
        },
      });

      await transaction.botnextWebhookEvent.createMany({
        data: listaMensagens.map((mensagem) => ({
          id: mensagem.id,
          tenantId,
          botnextAccountId: contaId,
          companyId,
          sessionId,
          eventType: "TESTE_SERVICO_CLASSIFICACAO",
          externalMessageId: mensagem.id,
          messageType: "TEXT",
          messageText: mensagem.texto,
          eventDate: mensagem.data,
          payload: {
            teste: true,
            origem: "test-botnext-message-classification",
          },

          // Não coloca eventos na fila nem nos estados
          // que o worker recupera para processamento.
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
          role: mensagem.role,
          messageType: "TEXT",
          text: mensagem.texto,
          eventDate: mensagem.data,
        })),
      });
    });

    registrosCriados = true;

    // 1. Tenant incorreto: rejeita antes de chamar o provedor.
    await assert.rejects(
      () => classificarMensagem({
        tenantId: randomUUID(),
        eventoId: mensagens.normal.id,
      }),
      /tenant informado/,
    );

    assert.equal(chamadas, 0);

    assert.equal(
      (await buscarMensagem(mensagens.normal.id)).classifiedAt,
      null,
    );

    console.log(
      "OK: tenant incorreto não acionou o classificador.",
    );

    // 2. Primeira chamada: classifica e persiste.
    const primeira = await classificarMensagem(
      parametros(mensagens.normal.id),
    );

    assert.equal(primeira.situacao, "CLASSIFICADA");
    assert.equal(chamadas, 1);

    assert.deepEqual(
      primeira.classificacao,
      classificacao,
    );

    assert.equal(primeira.modelo, "simulado-sem-api");
    assert.equal(primeira.versao, "teste-v1");
    assert.ok(primeira.classificadaEm instanceof Date);

    assert.deepEqual(
      textosRecebidos,
      [mensagens.normal.texto],
    );

    const normalSalva =
      await buscarMensagem(mensagens.normal.id);

    assert.equal(normalSalva.detectedIntent, "DUVIDA");
    assert.ok(normalSalva.classifiedAt instanceof Date);

    console.log(
      "OK: primeira chamada executou o provedor uma vez e salvou.",
    );

    // 3. Repetição: reaproveita o banco.
    const repetida = await classificarMensagem(
      parametros(mensagens.normal.id),
    );

    assert.equal(chamadas, 1);

    assert.deepEqual(repetida, {
      ...primeira,
      situacao: "JA_CLASSIFICADA",
    });

    assert.deepEqual(
      await buscarMensagem(mensagens.normal.id),
      normalSalva,
    );

    console.log(
      "OK: repetição retornou a classificação salva sem nova chamada.",
    );

    // 4. Nova instância: também reaproveita a persistência.
    let chamadasNovaInstancia = 0;

    const novaInstancia =
      criarServicoClassificacaoBotnext({
        modelo: "modelo-que-nao-deve-ser-usado",
        versao: "outra-versao",

        classificar: async () => {
          chamadasNovaInstancia += 1;

          throw new Error(
            "O provedor não deveria ser chamado neste cenário.",
          );
        },
      });

    const reaproveitada = await novaInstancia(
      parametros(mensagens.normal.id),
    );

    assert.equal(chamadasNovaInstancia, 0);
    assert.deepEqual(reaproveitada, repetida);

    console.log(
      "OK: nova instância reaproveitou o resultado persistido.",
    );

    // 5. Três chamadas simultâneas na mesma instância.
    const [simultanea1, simultanea2, simultanea3] =
      await Promise.all([
        classificarMensagem(
          parametros(mensagens.simultanea.id),
        ),
        classificarMensagem(
          parametros(mensagens.simultanea.id),
        ),
        classificarMensagem(
          parametros(mensagens.simultanea.id),
        ),
      ]);

    // Uma chamada anterior + uma para a nova mensagem.
    assert.equal(chamadas, 2);
    assert.equal(simultanea1.situacao, "CLASSIFICADA");
    assert.deepEqual(simultanea1, simultanea2);
    assert.deepEqual(simultanea1, simultanea3);

    assert.deepEqual(textosRecebidos, [
      mensagens.normal.texto,
      mensagens.simultanea.texto,
    ]);

    console.log(
      "OK: três chamadas simultâneas executaram o provedor uma única vez.",
    );

    // 6. Mensagens sem texto ou de sistema são ignoradas.
    const vazia = await classificarMensagem(
      parametros(mensagens.vazia.id),
    );

    assert.equal(vazia.situacao, "IGNORADA");
    assert.ok(vazia.situacao === "IGNORADA");
    assert.equal(vazia.motivo, "MENSAGEM_SEM_TEXTO");

    const sistema = await classificarMensagem(
      parametros(mensagens.sistema.id),
    );

    assert.equal(sistema.situacao, "IGNORADA");
    assert.ok(sistema.situacao === "IGNORADA");
    assert.equal(sistema.motivo, "MENSAGEM_NAO_CLIENTE");

    assert.equal(chamadas, 2);

    for (const mensagem of [
      mensagens.vazia,
      mensagens.sistema,
    ]) {
      assert.equal(
        (await buscarMensagem(mensagem.id)).classifiedAt,
        null,
      );
    }

    console.log(
      "OK: mensagens sem texto e de sistema não acionaram o provedor.",
    );

    // 7. Falha simulada não deixa classificação parcial.
    let tentativas = 0;

    const servicoComFalha =
      criarServicoClassificacaoBotnext({
        modelo: "simulado-com-falha",
        versao: "teste-v1",

        classificar: async () => {
          tentativas += 1;

          if (tentativas === 1) {
            throw new Error("FALHA_SIMULADA");
          }

          return { ...classificacao };
        },
      });

    const mensagemAntesDaFalha =
      await buscarMensagem(mensagens.tentativa.id);

    const conversaAntesDaFalha =
      await buscarConversa();

    await assert.rejects(
      () => servicoComFalha(
        parametros(mensagens.tentativa.id),
      ),
      /FALHA_SIMULADA/,
    );

    assert.equal(tentativas, 1);

    assert.deepEqual(
      await buscarMensagem(mensagens.tentativa.id),
      mensagemAntesDaFalha,
    );

    assert.deepEqual(
      await buscarConversa(),
      conversaAntesDaFalha,
    );

    console.log(
      "OK: falha do provedor não deixou gravação parcial.",
    );

    // 8. Após falhar, a mesma instância permite tentar novamente.
    const novaTentativa = await servicoComFalha(
      parametros(mensagens.tentativa.id),
    );

    assert.equal(novaTentativa.situacao, "CLASSIFICADA");
    assert.equal(tentativas, 2);

    const repeticaoDaTentativa = await servicoComFalha(
      parametros(mensagens.tentativa.id),
    );

    assert.equal(
      repeticaoDaTentativa.situacao,
      "JA_CLASSIFICADA",
    );

    assert.equal(tentativas, 2);

    console.log(
      "OK: nova tentativa funcionou; a repetição não chamou o provedor.",
    );

    // 9. Registro inconsistente gera erro, não uma nova chamada.
    // A alteração abaixo afeta apenas a mensagem fictícia do teste.
    await prisma.botnextConversationMessage.update({
      where: {
        id: mensagens.normal.id,
      },
      data: {
        intentReason: null,
      },
    });

    await assert.rejects(
      () => classificarMensagem(
        parametros(mensagens.normal.id),
      ),
      /incompleta ou inválida/,
    );

    assert.equal(chamadas, 2);

    console.log(
      "OK: classificação persistida incompleta foi rejeitada sem chamar o provedor.",
    );

    const conversaFinal = await buscarConversa();

    assert.equal(
      conversaFinal.status,
      BotnextConversationStatus.ACTIVE,
    );

    assert.equal(conversaFinal.closedAt, null);
  } finally {
    if (registrosCriados) {
      // Remove apenas os registros identificados pelos
      // UUIDs criados nesta execução.
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

  console.log("Teste do serviço de classificação aprovado.");
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