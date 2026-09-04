import {
  buscarClientePorId,
  listarClientes,
} from "./integrations/arbrain/arbrain-clientes.js";

async function testarFuncoesDeClientes(): Promise<void> {
  console.log("Testando listarClientes()...");

  const clientes = await listarClientes();

  console.log(`Clientes encontrados: ${clientes.length}`);

  const primeiroCliente = clientes[0];

  if (!primeiroCliente) {
    throw new Error("Nenhum cliente foi retornado pela API.");
  }

  console.log("Testando buscarClientePorId()...");

  const clienteCompleto = await buscarClientePorId(
    primeiroCliente.id,
  );

  console.log(
    `Quantidade de campos do cliente: ${
      Object.keys(clienteCompleto).length
    }`,
  );

  console.log("Funções de clientes testadas com sucesso.");
}

testarFuncoesDeClientes().catch((error: unknown) => {
  const mensagem =
    error instanceof Error ? error.message : "Erro desconhecido";

  console.error(`Falha no teste: ${mensagem}`);
  process.exitCode = 1;
});