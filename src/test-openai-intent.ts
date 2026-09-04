import "dotenv/config";

import {
  classificarIntencaoBotnext,
  type IntencaoBotnext,
} from "./ai/botnext-intent-classifier.js";

type CasoTeste = {
  mensagem: string;
  esperada: IntencaoBotnext;
};

const casos: CasoTeste[] = [
  {
    mensagem:
      "Quero fazer um pedido de duas caixas de cerveja.",
    esperada:
      "FAZER_PEDIDO",
  },
  {
    mensagem:
      "Hoje não vou precisar de nada, obrigado.",
    esperada:
      "NAO_DESEJA_PEDIDO",
  },
  {
    mensagem:
      "Qual é o prazo de entrega?",
    esperada:
      "DUVIDA",
  },
  {
    mensagem:
      "Quero falar com o meu vendedor.",
    esperada:
      "ATENDIMENTO_HUMANO",
  },
  {
    mensagem:
      "Preciso atualizar o endereço da empresa.",
    esperada:
      "ALTERACAO_CADASTRAL",
  },
  {
    mensagem:
      "Meu último pedido chegou atrasado.",
    esperada:
      "RECLAMACAO",
  },
  {
    mensagem:
      "Bom dia",
    esperada:
      "FORA_DE_CONTEXTO",
  },
];

async function executarTeste():
  Promise<void> {
  console.log(
    "Testando classificação de intenções...",
  );

  let aprovados =
    0;

  for (const caso of casos) {
    const resultado =
      await classificarIntencaoBotnext(
        caso.mensagem,
      );

    const aprovado =
      resultado.intencao ===
      caso.esperada;

    if (aprovado) {
      aprovados +=
        1;
    }

    console.log({
      mensagem:
        caso.mensagem,

      esperada:
        caso.esperada,

      recebida:
        resultado.intencao,

      confianca:
        resultado.confianca,

      requerAtendimentoHumano:
        resultado
          .requerAtendimentoHumano,

      aprovado,
    });
  }

  console.log(
    `Resultado: ${aprovados}/${casos.length} classificações corretas.`,
  );

  if (
    aprovados !==
    casos.length
  ) {
    throw new Error(
      "Uma ou mais classificações precisam ser ajustadas.",
    );
  }

  console.log(
    "Teste de intenções aprovado.",
  );

  console.log(
    "Nenhuma mensagem BotNext ou escrita no ArBrain foi executada.",
  );
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

      process.exitCode =
        1;
    },
  );