import assert from "node:assert/strict";

import { env } from "./config/env.js";
import { enviarTemplateDeTeste } from "./integrations/botnext/botnext-client.js";

async function testarBloqueio(): Promise<void> {
  const fetchOriginal = globalThis.fetch;
  let chamadasHttp = 0;

  // Substitui o fetch somente durante este teste.
  // Não realiza nenhuma conexão de rede.
  globalThis.fetch = async () => {
    chamadasHttp += 1;
    throw new Error("HTTP interceptado pelo teste.");
  };

  try {
    assert.equal(
      env.BOTNEXT_TEST_MODE,
      true,
      "Mantenha BOTNEXT_TEST_MODE=true.",
    );

    assert.equal(
      env.BOTNEXT_SEND_ENABLED,
      false,
      "Mantenha BOTNEXT_SEND_ENABLED=false.",
    );

    // A função deve recusar o envio antes de acessar o fetch.
    await assert.rejects(
      () => enviarTemplateDeTeste(),
      /Envio bloqueado: BOTNEXT_SEND_ENABLED=false/,
    );

    assert.equal(
      chamadasHttp,
      0,
      "O cliente tentou chamar HTTP com envio desabilitado.",
    );

    console.log("Bloqueio de envio validado.");
    console.log("Tentativas de chamada HTTP: 0.");
    console.log("Nenhuma mensagem enviada.");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}

testarBloqueio().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Falha no teste.",
  );
  process.exitCode = 1;
});