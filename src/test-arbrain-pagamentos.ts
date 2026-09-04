import { arbrainGet } from "./integrations/arbrain/arbrain-client.js";

async function testarPagamentos(): Promise<void> {
  console.log(
    "Consultando a lista resumida de pagamentos...",
  );

  const resposta = await arbrainGet<unknown>(
    "/v1/Cadastros/Pagamentos",
  );

  if (!Array.isArray(resposta)) {
    throw new Error(
      "A API respondeu, mas o formato não é uma lista.",
    );
  }

  console.log(
    `Quantidade de pagamentos retornados: ${resposta.length}`,
  );

  if (resposta.length > 0) {
    const primeiroPagamento = resposta[0];

    if (
      typeof primeiroPagamento === "object" &&
      primeiroPagamento !== null
    ) {
      const campos = Object.keys(primeiroPagamento);

      const tipos = Object.entries(primeiroPagamento)
        .map(([campo, valor]) => {
          const tipo =
            valor === null ? "null" : typeof valor;

          return `${campo}: ${tipo}`;
        })
        .join(", ");

      console.log(
        `Campos retornados: ${campos.join(", ")}`,
      );

      console.log(
        `Tipos dos campos: ${tipos}`,
      );
    }
  }

  console.log(
    "Lista resumida de pagamentos validada.",
  );

  console.log(
    "Nenhuma escrita foi enviada ao ArBrain.",
  );
}

testarPagamentos().catch((error: unknown) => {
  const mensagem =
    error instanceof Error
      ? error.message
      : "Erro desconhecido";

  console.error(`Falha no teste: ${mensagem}`);
  process.exitCode = 1;
});