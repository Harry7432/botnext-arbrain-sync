import { env } from "../../config/env.js";

// Formato da mensagem conforme a documentação recebida.
export type BotNextTemplatePayload = {
  from: string;
  to: string;
  body: {
    templateId: string;
    parameters?: Record<string, string | null>;
  };
  options: {
    forceStartSession: boolean;
  };
};

// Apenas prepara os dados. Não realiza chamadas HTTP.
export function montarTemplateDeTeste(): BotNextTemplatePayload {
  if (!env.BOTNEXT_TEST_MODE) {
    throw new Error(
      "Esta funcao exige BOTNEXT_TEST_MODE=true.",
    );
  }

  const parametros = env.BOTNEXT_TEMPLATE_PARAMETERS_JSON;

  return {
    from: env.BOTNEXT_FROM,

    // O destinatário é exclusivamente o número de teste.
    to: env.BOTNEXT_TEST_TO,

    body: {
      templateId: env.BOTNEXT_TEMPLATE_ID,

      // Inclui parâmetros somente quando houver algum.
      ...(Object.keys(parametros).length > 0
        ? { parameters: parametros }
        : {}),
    },

    options: {
      // Não força o encerramento de um atendimento existente.
      forceStartSession: false,
    },
  };
}