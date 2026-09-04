import { arbrainGet } from "./integrations/arbrain/arbrain-client.js";

interface ProdutoResumo {
  nome: string;
  id: string;
  sku: number;
}

async function testarProdutoCompleto(): Promise<void> {
  console.log(
    "Buscando a lista resumida de produtos...",
  );

  const produtos = await arbrainGet<ProdutoResumo[]>(
    "/v1/Cadastros/Produtos",
  );

  const primeiroProduto = produtos[0];

  if (!primeiroProduto) {
    throw new Error(
      "Nenhum produto foi encontrado para o teste.",
    );
  }

  console.log(
    "Consultando o cadastro completo de um produto...",
  );

  const produtoCompleto = await arbrainGet<unknown>(
    `/v1/Produtos/${encodeURIComponent(
      primeiroProduto.id,
    )}`,
  );

  if (
    typeof produtoCompleto !== "object" ||
    produtoCompleto === null ||
    Array.isArray(produtoCompleto)
  ) {
    throw new Error(
      "O produto completo não possui o formato esperado.",
    );
  }

  const campos = Object.keys(produtoCompleto);

  console.log(
    `Quantidade de campos retornados: ${campos.length}`,
  );

  console.log(
    `Campos retornados: ${campos.join(", ")}`,
  );

  const tipos = Object.entries(produtoCompleto)
    .map(([campo, valor]) => {
      const tipo = valor === null
        ? "null"
        : Array.isArray(valor)
          ? "array"
          : typeof valor;

      return `${campo}: ${tipo}`;
    })
    .join(", ");

  console.log(`Tipos dos campos: ${tipos}`);

  console.log(
    "Cadastro completo do produto validado.",
  );

  console.log(
    "Nenhuma escrita foi enviada ao ArBrain.",
  );
}

testarProdutoCompleto().catch((error: unknown) => {
  const mensagem =
    error instanceof Error
      ? error.message
      : "Erro desconhecido";

  console.error(`Falha no teste: ${mensagem}`);
  process.exitCode = 1;
});