import { arbrainGet } from "./integrations/arbrain/arbrain-client.js";
import { ArbrainApiError } from "./integrations/arbrain/arbrain-error.js";

async function testarErroHttp(): Promise<void> {
  console.log("Testando tratamento de erro HTTP...");

  try {
    await arbrainGet<unknown>(
      "/v1/endpoint-inexistente-para-teste",
    );

    throw new Error(
      "O endpoint inexistente respondeu como sucesso inesperadamente.",
    );
  } catch (error: unknown) {
    if (!(error instanceof ArbrainApiError)) {
      throw error;
    }

    console.log(`Nome do erro: ${error.name}`);
    console.log(`Código interno: ${error.code}`);
    console.log(`Status HTTP: ${error.statusCode ?? "não informado"}`);

    if (error.code !== "HTTP_ERROR") {
      throw new Error(
        `Era esperado HTTP_ERROR, mas recebemos ${error.code}.`,
      );
    }

    console.log("Erro HTTP tratado corretamente.");
  }
}

testarErroHttp().catch((error: unknown) => {
  const mensagem =
    error instanceof Error ? error.message : "Erro desconhecido";

  console.error(`Falha no teste: ${mensagem}`);
  process.exitCode = 1;
});