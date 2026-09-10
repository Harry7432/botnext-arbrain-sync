import "dotenv/config";

import { normalizarTelefoneBrasil } from "./visitas/telefone-service.js";

// Teste real ISOLADO do envio de texto livre BotNext (Etapa 3.2).
//
// Sobre o que este script NÃO faz (por construção):
//   - NÃO usa OpenAI/extração/rascunho/confirmação/dispatcher n8n.
//   - NÃO chama ArBrain nem POST /v1/Pedidos.
//   - NÃO chama o webhook do n8n.
//
// Regras de segurança:
//   - Único envio real: exatamente 1 POST /v1/message/send.
//   - BOTNEXT_SEND_ENABLED=true é exigido (habilitar SOMENTE para o teste).
//   - BOTNEXT_TEST_MODE=true é exigido e o destinatário DEVE ser o número
//     autorizado em BOTNEXT_TEST_TO.
//   - Timeout curto e fixo; em caso de erro ou não-2xx: NÃO há retry, o
//     payload NÃO é alterado automaticamente e o script apenas exibe o retorno.

const MENSAGEM_DE_TESTE =
  "Teste de integração BotNext — envio de texto livre. Pode ignorar esta mensagem.";

const TIMEOUT_MS = 30_000;

function exigirEnv(nome: string): string {
  const valor = process.env[nome]?.trim();
  if (!valor) {
    throw new Error(`A variável ${nome} não está configurada.`);
  }
  return valor;
}

function mascararToken(token: string): string {
  if (token.length <= 8) {
    return "(oculto)";
  }
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

async function executarTesteSender(): Promise<void> {
  if (
    process.env.BOTNEXT_SEND_ENABLED?.trim().toLowerCase() !== "true"
  ) {
    throw new Error(
      "BOTNEXT_SEND_ENABLED precisa ser true SOMENTE para este teste. " +
        "Após o teste, volte para false.",
    );
  }

  if (
    process.env.BOTNEXT_TEST_MODE?.trim().toLowerCase() !== "true"
  ) {
    throw new Error(
      "BOTNEXT_TEST_MODE precisa ser true para restringir o destinatário ao número de teste.",
    );
  }

  const baseUrl = exigirEnv("BOTNEXT_BASE_URL").replace(/\/+$/, "");
  const token = exigirEnv("BOTNEXT_API_TOKEN");
  const from = exigirEnv("BOTNEXT_FROM");
  const testeTo = exigirEnv("BOTNEXT_TEST_TO");

  const destino = normalizarTelefoneBrasil(testeTo);
  if (!destino) {
    throw new Error(
      `BOTNEXT_TEST_TO inválido: ${testeTo}. Esperado 55 + DDD + número, somente dígitos.`,
    );
  }

  const endpoint = `${baseUrl}/v1/message/send`;

  const payload = {
    from,
    to: destino.numeroComCodigoPais,
    body: { text: MENSAGEM_DE_TESTE },
    options: { forceStartSession: false },
  };

  console.log("=== TESTE REAL ISOLADO — envio de texto livre BotNext ===");
  console.log("Endpoint :", endpoint);
  console.log("Método   : POST");
  console.log(
    "Authorization: Bearer " +
      mascararToken(token) +
      "  (token mascarado: NUNCA é exibido na íntegra)",
  );
  console.log("Destinatário autorizado (BOTNEXT_TEST_TO + normalização):");
  console.log("  to =", payload.to);
  console.log("Payload efetivamente enviado (credenciais mascaradas):");
  console.log(JSON.stringify(payload, null, 2));
  console.log(
    "Máximo de 1 envio real; sem retry automático. Aguardando sua autorização explícita...",
  );
  console.log();

  // Guarda de segurança: este script envia SOMENTE se a autorização explícita
  // estiver presente. Sem ela, imprime o que seria enviado e ENCERRA sem
  // fazer o POST real. O teste em si não é disparado daqui.
  if (
    process.env.BOTNEXT_REAL_SEND_AUTHORIZED?.trim().toLowerCase() !== "true"
  ) {
    console.log(
      "AUTORIZAÇÃO AUSENTE: nenhum POST foi realizado. " +
        "Defina BOTNEXT_REAL_SEND_AUTHORIZED=true somente após revisar o payload acima.",
    );
    process.exitCode = 2;
    return;
  }

  let resposta: globalThis.Response;
  try {
    resposta = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch (erro: unknown) {
    const mensagem =
      erro instanceof Error
        ? erro.message
        : "Falha de rede desconhecida.";
    const ehTimeout =
      erro instanceof Error &&
      (erro.name === "TimeoutError" || erro.name === "AbortError");

    console.log("STATUS HTTP: sem resposta (falha antes do retorno HTTP).");
    console.log(
      ehTimeout
        ? `INDETERMINADO: timeout após ${TIMEOUT_MS}ms — não sabemos se o BotNext recebeu a requisição.`
        : `Falha de rede: ${mensagem}`,
    );
    console.log("Nenhum retry será feito. Nenhum payload foi alterado.");
    process.exitCode = 3;
    return;
  }

  console.log("STATUS HTTP:", resposta.status);

  const corpo = await resposta.text();
  console.log("BODY da resposta:", corpo || "(vazio)");

  if (resposta.status >= 200 && resposta.status <= 299) {
    console.log(
      "\nRESULTADO: 2xx. Nenhuma segunda mensagem será enviada." +
        "\nAGUARDE a confirmação MANUAL de que a mensagem chegou no WhatsApp/BotNext.",
    );
    return;
  }

  console.log(
    "\nRESULTADO: envio NÃO confirmado (status não-2xx)." +
      "\nNenhum retry automático e nenhuma alteração de payload foram feitos.",
  );
  process.exitCode = 4;
}

executarTesteSender().catch((erro: unknown) => {
  console.error(
    "Não foi possível executar o teste:",
    erro instanceof Error ? erro.message : String(erro),
  );
  process.exitCode = 1;
});