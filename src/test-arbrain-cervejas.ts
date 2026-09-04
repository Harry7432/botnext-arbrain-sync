import { arbrainGet } from "./integrations/arbrain/arbrain-client.js";

async function testarCervejas(): Promise<void> {
  console.log(
    "Consultando a lista resumida de cervejas...",
  );

  const resposta = await arbrainGet<unknown>(
    "/v1/Cadastros/Cervejas",
  );

  if (!Array.isArray(resposta)) {
    throw new Error(
      "A resposta de cervejas não é uma lista.",
    );
  }

  console.log(
    `Quantidade de cervejas retornadas: ${resposta.length}`,
  );

  const primeiraCerveja = resposta[0];

  if (
    typeof primeiraCerveja !== "object" ||
    primeiraCerveja === null
  ) {
    throw new Error(
      "Nenhuma cerveja válida foi encontrada.",
    );
  }

  const campos = Object.keys(primeiraCerveja);

  console.log(
    `Campos retornados: ${campos.join(", ")}`,
  );

  const tipos = Object.entries(primeiraCerveja)
    .map(([campo, valor]) => {
      const tipo =
        valor === null
          ? "null"
          : Array.isArray(valor)
            ? "array"
            : typeof valor;

      return `${campo}: ${tipo}`;
    })
    .join(", ");

  console.log(`Tipos dos campos: ${tipos}`);

  console.log(
    "Lista resumida de cervejas validada.",
  );

  console.log(
    "Nenhuma escrita foi enviada ao ArBrain.",
  );
}

testarCervejas().catch((error: unknown) => {
  const mensagem =
    error instanceof Error
      ? error.message
      : "Erro desconhecido";

  console.error(`Falha no teste: ${mensagem}`);
  process.exitCode = 1;
});