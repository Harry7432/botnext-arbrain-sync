import { listarClientes } from "./integrations/arbrain/arbrain-clientes.js";

async function validarClientes(): Promise<void> {
  console.log("Buscando clientes para validação...");

  const clientes = await listarClientes();

  const idsEncontrados = new Set<string>();
  const skusEncontrados = new Set<number>();

  const idsDuplicados = new Set<string>();
  const skusDuplicados = new Set<number>();

  let clientesSemId = 0;
  let clientesSemNome = 0;
  let clientesComSkuInvalido = 0;

  for (const cliente of clientes) {
    const idNormalizado = cliente.id.trim();
    const nomeNormalizado = cliente.nome.trim();

    if (!idNormalizado) {
      clientesSemId += 1;
    } else if (idsEncontrados.has(idNormalizado)) {
      idsDuplicados.add(idNormalizado);
    } else {
      idsEncontrados.add(idNormalizado);
    }

    if (!nomeNormalizado) {
      clientesSemNome += 1;
    }

    if (!Number.isInteger(cliente.sku)) {
      clientesComSkuInvalido += 1;
    } else if (skusEncontrados.has(cliente.sku)) {
      skusDuplicados.add(cliente.sku);
    } else {
      skusEncontrados.add(cliente.sku);
    }
  }

  console.log(`Total recebido: ${clientes.length}`);
  console.log(`Clientes sem ID: ${clientesSemId}`);
  console.log(`Clientes sem nome: ${clientesSemNome}`);
  console.log(`Clientes com SKU inválido: ${clientesComSkuInvalido}`);
  console.log(`IDs duplicados: ${idsDuplicados.size}`);
  console.log(`SKUs duplicados: ${skusDuplicados.size}`);

  const possuiProblemas =
    clientesSemId > 0 ||
    clientesComSkuInvalido > 0 ||
    idsDuplicados.size > 0 ||
    skusDuplicados.size > 0;

  if (possuiProblemas) {
    throw new Error(
      "A lista possui problemas que impedem a sincronização segura.",
    );
  }

  console.log("Lista aprovada para sincronização.");
}

validarClientes().catch((error: unknown) => {
  const mensagem =
    error instanceof Error ? error.message : "Erro desconhecido";

  console.error(`Falha na validação: ${mensagem}`);
  process.exitCode = 1;
});