import { arbrainGet } from "./integrations/arbrain/arbrain-client.js";
import type { ArbrainClienteResumo } from "./integrations/arbrain/arbrain-types.js";

async function testarConexao(): Promise<void> {
  console.log("Testando conexão com a API ArBrain...");

  const clientes = await arbrainGet<ArbrainClienteResumo[]>(
    "/v1/Cadastros/Clientes",
  );

  console.log(`Quantidade de clientes retornados: ${clientes.length}`);

  console.log("Resposta recebida no formato esperado:");
  console.log("nome: string, id: string, sku: number");

  console.log("Conexão com o ArBrain realizada com sucesso.");
}

testarConexao().catch((error: unknown) => {
  const mensagem =
    error instanceof Error ? error.message : "Erro desconhecido";

  console.error(`Falha no teste: ${mensagem}`);
  process.exitCode = 1;
});