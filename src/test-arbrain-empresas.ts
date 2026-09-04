import { arbrainGet } from "./integrations/arbrain/arbrain-client.js";

type ArbrainEmpresaResumo = {
  nome: unknown;
  id: unknown;
  sku: unknown;
};

async function testarEmpresas(): Promise<void> {
  console.log("Consultando e validando empresas...");

  const resposta = await arbrainGet<unknown>(
    "/v1/Cadastros/Empresas",
  );

  if (!Array.isArray(resposta)) {
    throw new Error(
      "A resposta de empresas não é uma lista.",
    );
  }

  const empresas = resposta as ArbrainEmpresaResumo[];

  const idsEncontrados = new Set<string>();
  const skusEncontrados = new Set<number>();

  let idsInvalidos = 0;
  let empresasSemNome = 0;
  let skusInvalidos = 0;
  let idsDuplicados = 0;
  let skusDuplicados = 0;

  for (const empresa of empresas) {
    if (
      typeof empresa.id !== "string" ||
      empresa.id.trim().length === 0
    ) {
      idsInvalidos += 1;
    } else {
      const idNormalizado = empresa.id.trim();

      if (idsEncontrados.has(idNormalizado)) {
        idsDuplicados += 1;
      } else {
        idsEncontrados.add(idNormalizado);
      }
    }

    if (
      typeof empresa.nome !== "string" ||
      empresa.nome.trim().length === 0
    ) {
      empresasSemNome += 1;
    }

    if (
      typeof empresa.sku !== "number" ||
      !Number.isInteger(empresa.sku)
    ) {
      skusInvalidos += 1;
    } else if (skusEncontrados.has(empresa.sku)) {
      skusDuplicados += 1;
    } else {
      skusEncontrados.add(empresa.sku);
    }
  }

  console.log(`Empresas recebidas: ${empresas.length}`);
  console.log(`IDs inválidos: ${idsInvalidos}`);
  console.log(`Empresas sem nome: ${empresasSemNome}`);
  console.log(`SKUs inválidos: ${skusInvalidos}`);
  console.log(`IDs duplicados: ${idsDuplicados}`);
  console.log(`SKUs duplicados: ${skusDuplicados}`);

  console.log("Validação das empresas concluída.");
  console.log("Nenhuma escrita foi enviada ao ArBrain.");
}

testarEmpresas().catch((error: unknown) => {
  const mensagem =
    error instanceof Error
      ? error.message
      : "Erro desconhecido";

  console.error(`Falha no teste: ${mensagem}`);
  process.exitCode = 1;
});