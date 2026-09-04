import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  prisma,
} from "./database/prisma.js";

async function executarTeste(): Promise<void> {
  const configuracaoOriginal = {
    BOTNEXT_AI_ENABLED:
      process.env.BOTNEXT_AI_ENABLED,

    OPENAI_API_KEY:
      process.env.OPENAI_API_KEY,
  };

  const fetchOriginal = globalThis.fetch;
  let chamadasHTTP = 0;

  // Bloqueia chamadas HTTP feitas por fetch neste processo.
  globalThis.fetch = async () => {
    chamadasHTTP += 1;

    throw new Error(
      "Chamada HTTP proibida neste teste.",
    );
  };

  try {
    // Remove a chave somente da memória deste teste.
    // O arquivo .env não é alterado.
    delete process.env.OPENAI_API_KEY;

    const {
      iaBotnextHabilitada,
      classificarEventoBotnextSeHabilitado,
    } = await import(
      "./integrations/botnext/botnext-ai-service.js"
    );

    assert.equal(
      iaBotnextHabilitada(),
      false,
      "Mantenha BOTNEXT_AI_ENABLED=false antes de continuar.",
    );

    console.log(
      "OK: configuração atual mantém a IA desativada.",
    );

    const parametros = {
      tenantId: randomUUID(),
      eventoId: randomUUID(),
    };

    const resultadoAtual =
      await classificarEventoBotnextSeHabilitado(
        parametros,
      );

    assert.deepEqual(resultadoAtual, {
      situacao: "DESATIVADA",
    });

    console.log(
      "OK: integração desativada funciona sem chave OpenAI.",
    );

    // Sem a variável, o padrão também deve ser desligado.
    delete process.env.BOTNEXT_AI_ENABLED;

    assert.equal(iaBotnextHabilitada(), false);

    assert.deepEqual(
      await classificarEventoBotnextSeHabilitado(
        parametros,
      ),
      { situacao: "DESATIVADA" },
    );

    console.log(
      "OK: variável ausente mantém a IA desativada.",
    );

    process.env.BOTNEXT_AI_ENABLED = "false";

    assert.deepEqual(
      await classificarEventoBotnextSeHabilitado(
        parametros,
      ),
      { situacao: "DESATIVADA" },
    );

    console.log(
      "OK: false explícito bloqueia a classificação.",
    );

    // Configuração inválida deve falhar, nunca ativar a IA.
    process.env.BOTNEXT_AI_ENABLED = "talvez";

    await assert.rejects(
      () => classificarEventoBotnextSeHabilitado(
        parametros,
      ),
      /BOTNEXT_AI_ENABLED deve ser true ou false/,
    );

    console.log(
      "OK: configuração inválida foi rejeitada.",
    );

    assert.equal(chamadasHTTP, 0);

    console.log(
      "OK: nenhuma chamada HTTP foi tentada.",
    );
  } finally {
    globalThis.fetch = fetchOriginal;

    for (
      const [nome, valor]
      of Object.entries(configuracaoOriginal)
    ) {
      if (valor === undefined) {
        delete process.env[nome];
      } else {
        process.env[nome] = valor;
      }
    }
  }

  console.log(
    "Teste da integração desativada aprovado.",
  );

  console.log(
    "Nenhum registro de teste foi criado e o arquivo .env não foi alterado.",
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