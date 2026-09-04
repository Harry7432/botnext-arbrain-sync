import { prisma } from "./database/prisma.js";

type ValorContavel = string | number | null;

function normalizarValor(valor: ValorContavel): string {
  if (valor === null) {
    return "NÃO INFORMADO";
  }

  const texto = String(valor).trim();

  return texto || "NÃO INFORMADO";
}

function contarValores(
  valores: ValorContavel[],
): Record<string, number> {
  const contagem: Record<string, number> = {};

  for (const valor of valores) {
    const chave = normalizarValor(valor);

    contagem[chave] = (contagem[chave] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(contagem).sort(
      ([, quantidadeA], [, quantidadeB]) =>
        quantidadeB - quantidadeA,
    ),
  );
}

async function testarClientesVisitas(): Promise<void> {
  console.log(
    "Analisando regras de visita no nosso PostgreSQL...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const clientes = await prisma.cliente.findMany({
    where: {
      tenantId: tenant.id,
    },
    select: {
      diaVisitaPrimario: true,
      diaVisitaSecundario: true,
      periodicidadeDaVisita: true,
      ordenacaoDaVisita: true,
      indexSequenciamentoVisita: true,
    },
  });

  const diasDefinidos = clientes.filter(
    (cliente) =>
      cliente.diaVisitaPrimario !== null &&
      cliente.diaVisitaPrimario !== "NAO_DEFINIDA",
  ).length;

  const indices = clientes
    .map((cliente) => cliente.indexSequenciamentoVisita)
    .filter(
      (indice): indice is number => indice !== null,
    );

  console.log(`Clientes analisados: ${clientes.length}`);
  console.log(`Com dia primário definido: ${diasDefinidos}`);

  console.log("Dias primários:");
  console.table(
    contarValores(
      clientes.map(
        (cliente) => cliente.diaVisitaPrimario,
      ),
    ),
  );

  console.log("Dias secundários:");
  console.table(
    contarValores(
      clientes.map(
        (cliente) => cliente.diaVisitaSecundario,
      ),
    ),
  );

  console.log("Periodicidades:");
  console.table(
    contarValores(
      clientes.map(
        (cliente) => cliente.periodicidadeDaVisita,
      ),
    ),
  );

  console.log("Ordenações de visita:");
  console.table(
    contarValores(
      clientes.map(
        (cliente) => cliente.ordenacaoDaVisita,
      ),
    ),
  );

  console.log(
    `Índices de sequenciamento informados: ${indices.length}`,
  );

  console.log(
    `Menor índice: ${
      indices.length > 0 ? Math.min(...indices) : "nenhum"
    }`,
  );

  console.log(
    `Maior índice: ${
      indices.length > 0 ? Math.max(...indices) : "nenhum"
    }`,
  );

  console.log(
    "Análise concluída somente no nosso PostgreSQL.",
  );

  console.log(
    "Nenhuma chamada ou escrita foi enviada ao ArBrain.",
  );
}

testarClientesVisitas()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido";

    console.error(`Falha na análise: ${mensagem}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });