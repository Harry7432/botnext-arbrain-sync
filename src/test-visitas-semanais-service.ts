import { prisma } from "./database/prisma.js";

import {
  listarClientesComVisitaSemanal,
  obterDiaDaSemanaArbrain,
  TIMEZONE_VISITAS,
} from "./visitas/visitas-semanais-service.js";

function possuiValor(
  valor: string | null,
): boolean {
  return valor !== null && valor.trim().length > 0;
}

async function testarServicoDeVisitas(): Promise<void> {
  console.log(
    "Testando o serviço reutilizável de visitas semanais...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const diaAtual = obterDiaDaSemanaArbrain();

  const clientes =
    await listarClientesComVisitaSemanal(tenant.id);

  const comCelular = clientes.filter(
    (cliente) => possuiValor(cliente.celular),
  ).length;

  const somenteTelefone = clientes.filter(
    (cliente) =>
      !possuiValor(cliente.celular) &&
      possuiValor(cliente.telefone),
  ).length;

  const semContato = clientes.filter(
    (cliente) =>
      !possuiValor(cliente.celular) &&
      !possuiValor(cliente.telefone),
  ).length;

  console.log(`Dia considerado: ${diaAtual}`);
  console.log(`Fuso horário: ${TIMEZONE_VISITAS}`);

  console.log(
    `Clientes semanais elegíveis: ${clientes.length}`,
  );

  console.log(`Com celular: ${comCelular}`);
  console.log(`Somente com telefone: ${somenteTelefone}`);
  console.log(`Sem telefone ou celular: ${semContato}`);

  console.log(
    "Nenhum dado pessoal foi exibido no terminal.",
  );

  console.log(
    "Nenhuma mensagem foi enviada pelo BotNext.",
  );

  console.log(
    "Nenhuma chamada ou escrita foi enviada ao ArBrain.",
  );
}

testarServicoDeVisitas()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido";

    console.error(`Falha no teste: ${mensagem}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });