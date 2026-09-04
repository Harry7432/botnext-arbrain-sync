import { listarBancos } from "./integrations/arbrain/arbrain-bancos.js";

async function testarBancos(): Promise<void> {
  console.log("Consultando e validando bancos...");

  const bancos = await listarBancos();

  const idsEncontrados = new Set<number>();
  const skusEncontrados = new Set<number>();

  let idsInvalidos = 0;
  let bancosSemNome = 0;
  let skusInvalidos = 0;
  let idsDuplicados = 0;
  let skusDuplicados = 0;

  for (const banco of bancos) {
    if (!Number.isInteger(banco.id)) {
      idsInvalidos += 1;
    }

    if (!banco.nome.trim()) {
      bancosSemNome += 1;
    }

    if (!Number.isInteger(banco.sku)) {
      skusInvalidos += 1;
    }

    if (idsEncontrados.has(banco.id)) {
      idsDuplicados += 1;
    }

    if (skusEncontrados.has(banco.sku)) {
      skusDuplicados += 1;
    }

    idsEncontrados.add(banco.id);
    skusEncontrados.add(banco.sku);
  }

  console.log(`Bancos recebidos: ${bancos.length}`);
  console.log(`IDs inválidos: ${idsInvalidos}`);
  console.log(`Bancos sem nome: ${bancosSemNome}`);
  console.log(`SKUs inválidos: ${skusInvalidos}`);
  console.log(`IDs duplicados: ${idsDuplicados}`);
  console.log(`SKUs duplicados: ${skusDuplicados}`);

  console.log("Validação dos bancos concluída.");
  console.log("Nenhuma escrita foi enviada ao ArBrain.");
}

testarBancos().catch((error: unknown) => {
  const mensagem =
    error instanceof Error
      ? error.message
      : "Erro desconhecido";

  console.error(`Falha no teste: ${mensagem}`);
  process.exitCode = 1;
});