import { prisma } from "./database/prisma.js";

import {
  listarClientesComVisitaSemanal,
  obterDiaDaSemanaArbrain,
} from "./visitas/visitas-semanais-service.js";

function extrairDigitos(
  valor: string | null,
): string {
  return valor?.replace(/\D/g, "") ?? "";
}

function classificarNumero(
  valor: string | null,
): string {
  const digitos = extrairDigitos(valor);

  if (digitos.length === 0) {
    return "VAZIO";
  }

  if (digitos.length === 10) {
    return "10_DIGITOS";
  }

  if (digitos.length === 11) {
    return "11_DIGITOS";
  }

  if (
    digitos.length === 12 &&
    digitos.startsWith("55")
  ) {
    return "12_DIGITOS_COM_55";
  }

  if (
    digitos.length === 13 &&
    digitos.startsWith("55")
  ) {
    return "13_DIGITOS_COM_55";
  }

  return `OUTRO_${digitos.length}_DIGITOS`;
}

function contarClassificacoes(
  valores: Array<string | null>,
): Record<string, number> {
  const resultado: Record<string, number> = {};

  for (const valor of valores) {
    const classificacao = classificarNumero(valor);

    resultado[classificacao] =
      (resultado[classificacao] ?? 0) + 1;
  }

  return resultado;
}

function possuiValor(
  valor: string | null,
): boolean {
  return valor !== null && valor.trim().length > 0;
}

async function testarFormatosDosTelefones(): Promise<void> {
  console.log(
    "Analisando formatos dos telefones no nosso PostgreSQL...",
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

  const contatosEscolhidos = clientes.map(
    (cliente) => {
      if (possuiValor(cliente.celular)) {
        return cliente.celular;
      }

      return cliente.telefone;
    },
  );

  const contatosNormalizados = contatosEscolhidos
    .map(extrairDigitos)
    .filter((numero) => numero.length > 0);

  const quantidadeDuplicada =
    contatosNormalizados.length -
    new Set(contatosNormalizados).size;

  console.log(
    `Dia considerado: ${obterDiaDaSemanaArbrain()}`,
  );

  console.log(
    `Clientes semanais analisados: ${clientes.length}`,
  );

  console.log("Formatos encontrados no campo celular:");

  console.table(
    contarClassificacoes(
      clientes.map((cliente) => cliente.celular),
    ),
  );

  console.log("Formatos encontrados no campo telefone:");

  console.table(
    contarClassificacoes(
      clientes.map((cliente) => cliente.telefone),
    ),
  );

  console.log("Formatos dos contatos escolhidos:");

  console.table(
    contarClassificacoes(contatosEscolhidos),
  );

  console.log(
    `Contatos preenchidos: ${contatosNormalizados.length}`,
  );

  console.log(
    `Contatos duplicados: ${quantidadeDuplicada}`,
  );

  console.log(
    "Nenhum número real foi exibido no terminal.",
  );

  console.log(
    "Nenhuma mensagem foi enviada pelo BotNext.",
  );

  console.log(
    "Nenhuma chamada ou escrita foi enviada ao ArBrain.",
  );
}

testarFormatosDosTelefones()
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