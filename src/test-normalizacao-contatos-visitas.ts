import { prisma } from "./database/prisma.js";

import {
  listarClientesComVisitaSemanal,
  obterDiaDaSemanaArbrain,
} from "./visitas/visitas-semanais-service.js";

import {
  normalizarTelefoneBrasil,
} from "./visitas/telefone-service.js";

function possuiValor(
  valor: string | null,
): boolean {
  return valor !== null && valor.trim().length > 0;
}

async function testarNormalizacao(): Promise<void> {
  console.log(
    "Testando normalização dos contatos semanais...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const clientes =
    await listarClientesComVisitaSemanal(tenant.id);

  let celularesProvaveis = 0;
  let fixosOuBusiness = 0;
  let contatosInvalidos = 0;
  let clientesSemContato = 0;

  const ocorrenciasPorNumero = new Map<string, number>();

  for (const cliente of clientes) {
    const contatoEscolhido = possuiValor(cliente.celular)
      ? cliente.celular
      : cliente.telefone;

    if (!possuiValor(contatoEscolhido)) {
      clientesSemContato += 1;
      continue;
    }

    const telefoneNormalizado =
      normalizarTelefoneBrasil(contatoEscolhido);

    if (!telefoneNormalizado) {
      contatosInvalidos += 1;
      continue;
    }

    if (
      telefoneNormalizado.tipo === "CELULAR_PROVAVEL"
    ) {
      celularesProvaveis += 1;
    } else {
      fixosOuBusiness += 1;
    }

    const numero =
      telefoneNormalizado.numeroComCodigoPais;

    ocorrenciasPorNumero.set(
      numero,
      (ocorrenciasPorNumero.get(numero) ?? 0) + 1,
    );
  }

  const quantidades = Array.from(
    ocorrenciasPorNumero.values(),
  );

  const gruposDuplicados = quantidades.filter(
    (quantidade) => quantidade > 1,
  );

  const registrosEmGruposDuplicados =
    gruposDuplicados.reduce(
      (total, quantidade) => total + quantidade,
      0,
    );

  const destinosExclusivos = quantidades.filter(
    (quantidade) => quantidade === 1,
  ).length;

  const maiorQuantidadeNoMesmoNumero =
    quantidades.length > 0
      ? Math.max(...quantidades)
      : 0;

  console.log(
    `Dia considerado: ${obterDiaDaSemanaArbrain()}`,
  );

  console.log(
    `Clientes semanais analisados: ${clientes.length}`,
  );

  console.log(
    `Celulares prováveis: ${celularesProvaveis}`,
  );

  console.log(
    `Fixos ou WhatsApp Business: ${fixosOuBusiness}`,
  );

  console.log(
    `Contatos preenchidos, mas inválidos: ${contatosInvalidos}`,
  );

  console.log(
    `Clientes sem contato: ${clientesSemContato}`,
  );

  console.log(
    `Destinos normalizados únicos: ${ocorrenciasPorNumero.size}`,
  );

  console.log(
    `Destinos usados por somente um cliente: ${destinosExclusivos}`,
  );

  console.log(
    `Grupos com número duplicado: ${gruposDuplicados.length}`,
  );

  console.log(
    `Clientes envolvidos em duplicidades: ${registrosEmGruposDuplicados}`,
  );

  console.log(
    `Maior quantidade de clientes no mesmo número: ${maiorQuantidadeNoMesmoNumero}`,
  );

  console.log(
    "Nenhum telefone real foi exibido no terminal.",
  );

  console.log(
    "Nenhuma mensagem foi enviada pelo BotNext.",
  );

  console.log(
    "Nenhuma chamada ou escrita foi enviada ao ArBrain.",
  );
}

testarNormalizacao()
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