import "dotenv/config";

import {
  MODELO_OPENAI,
  openai,
} from "./ai/openai-client.js";

async function testarConexao():
  Promise<void> {
  console.log(
    "Validando acesso à API da OpenAI...",
  );

  const modelo =
    await openai.models.retrieve(
      MODELO_OPENAI,
    );

  if (
    modelo.id !==
    MODELO_OPENAI
  ) {
    throw new Error(
      "A OpenAI retornou um modelo diferente do solicitado.",
    );
  }

  console.log(
    `OK: acesso confirmado ao modelo ${modelo.id}.`,
  );

  console.log(
    "Nenhuma mensagem foi gerada e nenhum fluxo externo foi executado.",
  );
}

testarConexao()
  .catch(
    (
      error: unknown,
    ) => {
      const mensagem =
        error instanceof Error
          ? error.message
          : "Erro desconhecido";

      console.error(
        `Falha no teste OpenAI: ${mensagem}`,
      );

      process.exitCode =
        1;
    },
  );