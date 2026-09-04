import { env } from "./config/env.js";
import { enviarTemplateDeTeste } from "./integrations/botnext/botnext-client.js";

async function testarEnvio(): Promise<void> {
  if (!env.BOTNEXT_TEST_MODE) {
    throw new Error("O modo de teste precisa estar ativado.");
  }

  if (!env.BOTNEXT_SEND_ENABLED) {
    throw new Error("O envio está desabilitado.");
  }

  console.log("Enviando um template ao número de teste...");

  const resultado = await enviarTemplateDeTeste();

  console.log(`ID da mensagem: ${resultado.id}`);
  console.log(`Status retornado: ${resultado.status}`);

  if (resultado.status === "FAILED") {
    console.error("O BotNext informou falha. Confira na plataforma.");
    process.exitCode = 1;
    return;
  }

  console.log("Resposta do BotNext recebida.");
  console.log("Confira no WhatsApp se a mensagem chegou.");
  console.log("O status retornado não garante a entrega.");
}

testarEnvio().catch((error: unknown) => {
  const mensagem =
    error instanceof Error ? error.message : "Erro desconhecido";

  console.error(`Falha no teste: ${mensagem}`);
  console.error(
    "Não execute novamente antes de conferir a plataforma: " +
      "a mensagem pode ter sido aceita mesmo com erro ou timeout.",
  );

  process.exitCode = 1;
});