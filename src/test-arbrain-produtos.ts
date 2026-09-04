import { arbrainGet } from "./integrations/arbrain/arbrain-client.js";

async function testarProdutos(): Promise<void> {
  console.log(
    "Consultando a lista resumida de produtos...",
  );

  const resposta = await arbrainGet<unknown>(
    "/v1/Cadastros/Produtos",
  );

  if (!Array.isArray(resposta)) {
    throw new Error(
      "A resposta de produtos não é uma lista.",
    );
  }

  console.log(
    `Quantidade de produtos retornados: ${resposta.length}`,
  );

  const primeiroProduto = resposta[0];

  if (
    typeof primeiroProduto !== "object" ||
    primeiroProduto === null
  ) {
    throw new Error(
      "Nenhum produto válido foi encontrado.",
    );
  }

  const campos = Object.keys(primeiroProduto);

  console.log(
    `Campos retornados: ${campos.join(", ")}`,
  );

  const tipos = Object.entries(primeiroProduto)
    .map(([campo, valor]) => {
      const tipo = valor === null
        ? "null"
        : typeof valor;

      return `${campo}: ${tipo}`;
    })
    .join(", ");

  console.log(`Tipos dos campos: ${tipos}`);

  console.log(
    "Lista resumida de produtos validada.",
  );

  console.log(
    "Nenhuma escrita foi enviada ao ArBrain.",
  );
}

testarProdutos().catch((error: unknown) => {
  const mensagem =
    error instanceof Error
      ? error.message
      : "Erro desconhecido";

  console.error(`Falha no teste: ${mensagem}`);
  process.exitCode = 1;
});