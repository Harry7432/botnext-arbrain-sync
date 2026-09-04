import assert from "node:assert/strict";

import {
  BotnextConversationStatus,
} from "@prisma/client";

import {
  rotearIntencaoBotnext,
} from "./integrations/botnext/botnext-intent-router.js";

import type {
  IntencaoBotnext,
} from "./ai/botnext-intent-classifier.js";

import type {
  AcaoRoteamentoBotnext,
} from "./integrations/botnext/botnext-intent-router.js";

type CenarioRoteamento = {
  intencao: IntencaoBotnext;
  confianca: number;
  requerAtendimentoHumano: boolean;
  acaoEsperada: AcaoRoteamentoBotnext;
  statusEsperado: BotnextConversationStatus;
  handoffEsperado: boolean;
};

function executarTeste(): void {
  console.log(
    "Testando roteamento das intenções BotNext...",
  );

  const cenarios:
    CenarioRoteamento[] = [
      {
        intencao:
          "FAZER_PEDIDO",

        confianca:
          0.95,

        requerAtendimentoHumano:
          false,

        acaoEsperada:
          "INICIAR_PEDIDO",

        statusEsperado:
          BotnextConversationStatus.ACTIVE,

        handoffEsperado:
          false,
      },
      {
        intencao:
          "NAO_DESEJA_PEDIDO",

        confianca:
          0.96,

        requerAtendimentoHumano:
          false,

        acaoEsperada:
          "ENCERRAR_SEM_PEDIDO",

        statusEsperado:
          BotnextConversationStatus.COMPLETED,

        handoffEsperado:
          false,
      },
      {
        intencao:
          "DUVIDA",

        confianca:
          0.92,

        requerAtendimentoHumano:
          false,

        acaoEsperada:
          "RESPONDER_DUVIDA",

        statusEsperado:
          BotnextConversationStatus.WAITING_CUSTOMER,

        handoffEsperado:
          false,
      },
      {
        intencao:
          "ATENDIMENTO_HUMANO",

        confianca:
          0.99,

        // Mesmo se o provedor retornar false,
        // o roteador deve proteger o fluxo.
        requerAtendimentoHumano:
          false,

        acaoEsperada:
          "ENCAMINHAR_ATENDIMENTO_HUMANO",

        statusEsperado:
          BotnextConversationStatus.HUMAN_HANDOFF,

        handoffEsperado:
          true,
      },
      {
        intencao:
          "ALTERACAO_CADASTRAL",

        confianca:
          0.91,

        requerAtendimentoHumano:
          false,

        acaoEsperada:
          "ENCAMINHAR_ATENDIMENTO_HUMANO",

        statusEsperado:
          BotnextConversationStatus.HUMAN_HANDOFF,

        handoffEsperado:
          true,
      },
      {
        intencao:
          "RECLAMACAO",

        confianca:
          0.89,

        requerAtendimentoHumano:
          false,

        acaoEsperada:
          "ENCAMINHAR_ATENDIMENTO_HUMANO",

        statusEsperado:
          BotnextConversationStatus.HUMAN_HANDOFF,

        handoffEsperado:
          true,
      },
      {
        intencao:
          "FORA_DE_CONTEXTO",

        confianca:
          0.40,

        requerAtendimentoHumano:
          false,

        acaoEsperada:
          "SOLICITAR_MAIS_CONTEXTO",

        statusEsperado:
          BotnextConversationStatus.WAITING_CUSTOMER,

        handoffEsperado:
          false,
      },
    ];

  assert.equal(
    cenarios.length,
    7,
  );

  for (
    const cenario of cenarios
  ) {
    const decisao =
      rotearIntencaoBotnext({
        intencao:
          cenario.intencao,

        confianca:
          cenario.confianca,

        requerAtendimentoHumano:
          cenario
            .requerAtendimentoHumano,
      });

    assert.equal(
      decisao.acao,
      cenario.acaoEsperada,
      `Ação incorreta para ${cenario.intencao}.`,
    );

    assert.equal(
      decisao.statusSugerido,
      cenario.statusEsperado,
      `Status incorreto para ${cenario.intencao}.`,
    );

    assert.equal(
      decisao
        .requerAtendimentoHumano,
      cenario.handoffEsperado,
      `Handoff incorreto para ${cenario.intencao}.`,
    );

    assert.ok(
      decisao.motivo.trim().length > 0,
      `Motivo vazio para ${cenario.intencao}.`,
    );

    console.log(
      `OK: ${cenario.intencao} -> ${decisao.acao}.`,
    );
  }

  const baixaConfianca =
    rotearIntencaoBotnext({
      intencao:
        "DUVIDA",

      confianca:
        0.45,

      requerAtendimentoHumano:
        true,
    });

  assert.equal(
    baixaConfianca.acao,
    "ENCAMINHAR_ATENDIMENTO_HUMANO",
  );

  assert.equal(
    baixaConfianca.statusSugerido,
    BotnextConversationStatus.HUMAN_HANDOFF,
  );

  assert.equal(
    baixaConfianca
      .requerAtendimentoHumano,
    true,
  );

  assert.equal(
    baixaConfianca.motivo,
    "CLASSIFICACAO_EXIGE_ATENDIMENTO_HUMANO",
  );

  console.log(
    "OK: baixa confiança recebeu prioridade de handoff.",
  );

  for (
    const confiancaInvalida of [
      -0.01,
      1.01,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]
  ) {
    assert.throws(
      () =>
        rotearIntencaoBotnext({
          intencao:
            "DUVIDA",

          confianca:
            confiancaInvalida,

          requerAtendimentoHumano:
            false,
        }),
      /entre 0 e 1/,
    );
  }

  console.log(
    "OK: valores inválidos de confiança foram rejeitados.",
  );

  console.log(
    "Teste do roteador de intenções aprovado.",
  );

  console.log(
    "Sem OpenAI, PostgreSQL, Redis, BotNext ou ArBrain.",
  );
}

try {
  executarTeste();
} catch (error: unknown) {
  console.error(
    "Falha no teste:",
    error instanceof Error
      ? error.message
      : "Erro desconhecido",
  );

  process.exitCode = 1;
}