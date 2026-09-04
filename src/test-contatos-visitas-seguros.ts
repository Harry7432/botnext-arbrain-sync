import { prisma } from "./database/prisma.js";

import {
  obterDiaDaSemanaArbrain,
} from "./visitas/visitas-semanais-service.js";

import {
  prepararContatosDeVisitasSemanais,
} from "./visitas/contatos-visitas-service.js";

async function testarContatosSeguros(): Promise<void> {
  console.log(
    "Testando a preparação segura dos contatos...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const resultado =
    await prepararContatosDeVisitasSemanais(
      tenant.id,
    );

  const totalClassificado =
    resultado.contatosProntos.length +
    resultado.contatosDuplicados.length +
    resultado.clientesSemContato +
    resultado.contatosInvalidos;

  if (
    totalClassificado !==
    resultado.clientesAnalisados
  ) {
    throw new Error(
      "A soma das classificações não corresponde ao total analisado.",
    );
  }

  const numerosProntos = resultado.contatosProntos.map(
    (contato) =>
      contato.telefone.numeroComCodigoPais,
  );

  const destinosProntosUnicos =
    new Set(numerosProntos).size;

  if (
    destinosProntosUnicos !==
    resultado.contatosProntos.length
  ) {
    throw new Error(
      "A lista de contatos prontos ainda possui duplicidades.",
    );
  }

  console.log(
    `Dia considerado: ${obterDiaDaSemanaArbrain()}`,
  );

  console.log(
    `Clientes analisados: ${resultado.clientesAnalisados}`,
  );

  console.log(
    `Contatos seguros e exclusivos: ${resultado.contatosProntos.length}`,
  );

  console.log(
    `Clientes com contato duplicado: ${resultado.contatosDuplicados.length}`,
  );

  console.log(
    `Clientes sem contato: ${resultado.clientesSemContato}`,
  );

  console.log(
    `Contatos preenchidos, mas inválidos: ${resultado.contatosInvalidos}`,
  );

  console.log(
    `Total classificado: ${totalClassificado}`,
  );

  console.log(
    "Lista segura validada sem números duplicados.",
  );

  console.log(
    "Nenhum telefone ou dado pessoal foi exibido.",
  );

  console.log(
    "Nenhuma mensagem foi enviada pelo BotNext.",
  );

  console.log(
    "Nenhuma chamada ou escrita foi enviada ao ArBrain.",
  );
}

testarContatosSeguros()
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