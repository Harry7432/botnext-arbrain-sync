import { z } from "zod";

import { env } from "../../config/env.js";
import { montarTemplateDeTeste } from "./botnext-template.js";

const TIMEOUT_MS = 30_000;

// Valida os campos essenciais da resposta da plataforma.
const respostaEnvioSchema = z.object({
  id: z.string().uuid(),
  status: z.enum([
    "PROCESSING",
    "SAVED",
    "QUEUED",
    "SENT",
    "DELIVERED",
    "READ",
    "FAILED",
    "DELETED",
    "WAIT_REPLY",
  ]),
});

export type BotNextRespostaEnvio = z.infer<
  typeof respostaEnvioSchema
>;

// Esta função é exclusiva para testes.
// Criar ou importar o arquivo não executa o envio.
export async function enviarTemplateDeTeste(): Promise<BotNextRespostaEnvio> {
  // Os bloqueios são verificados antes de qualquer chamada HTTP.
  if (!env.BOTNEXT_SEND_ENABLED) {
    throw new Error(
      "Envio bloqueado: BOTNEXT_SEND_ENABLED=false.",
    );
  }

  if (!env.BOTNEXT_TEST_MODE) {
    throw new Error(
      "Esta funcao permite somente envios em modo de teste.",
    );
  }

  const mensagem = montarTemplateDeTeste();

  if (mensagem.to !== env.BOTNEXT_TEST_TO) {
    throw new Error(
      "Envio bloqueado: destinatario diferente do numero de teste.",
    );
  }

  const baseUrl = env.BOTNEXT_BASE_URL.replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/v1/message/send`);

  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.BOTNEXT_API_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(mensagem),
      signal: AbortSignal.timeout(TIMEOUT_MS),

      // Não encaminha o envio para outro endereço por redirecionamento.
      redirect: "error",
    });
  } catch {
    // Um timeout não prova que a plataforma deixou de receber.
    throw new Error(
      "Envio sem confirmacao por falha de rede ou timeout. " +
      "Confira a plataforma antes de tentar novamente. " +
      "Nenhuma repeticao automatica foi realizada.",
    );
  }

  if (!response.ok) {
    // Não imprime o corpo da resposta, que pode conter dados sensíveis.
    throw new Error(
      `BotNext respondeu HTTP ${response.status}. ` +
      "Confira a plataforma antes de repetir o envio.",
    );
  }

  let dados: unknown;

  try {
    dados = await response.json();
  } catch {
    throw new Error(
      "Resposta do envio nao pode ser lida como JSON. " +
      "A mensagem pode ter sido recebida. Nao repita sem conferir.",
    );
  }

  const resultado = respostaEnvioSchema.safeParse(dados);

  if (!resultado.success) {
    throw new Error(
      "Resposta do envio fora do formato esperado. " +
      "A mensagem pode ter sido recebida. Nao repita sem conferir.",
    );
  }

  // Retorna ID e status. Aceitação na fila não significa entrega.
  return resultado.data;
}