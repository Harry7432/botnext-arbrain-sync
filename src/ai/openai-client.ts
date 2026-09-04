import OpenAI from "openai";

type ConfiguracaoOpenAI = {
  apiKey: string;
  model: string;
};

function obterConfiguracaoOpenAI():
  ConfiguracaoOpenAI {
  const apiKey =
    process.env.OPENAI_API_KEY?.trim();

  const model =
    process.env.OPENAI_MODEL?.trim();

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY não foi configurada.",
    );
  }

  if (!model) {
    throw new Error(
      "OPENAI_MODEL não foi configurado.",
    );
  }

  return {
    apiKey,
    model,
  };
}

const configuracao =
  obterConfiguracaoOpenAI();

export const MODELO_OPENAI =
  configuracao.model;

export const openai =
  new OpenAI({
    apiKey:
      configuracao.apiKey,

    timeout:
      30_000,

    maxRetries:
      2,
  });