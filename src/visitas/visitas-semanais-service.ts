import { prisma } from "../database/prisma.js";

export const TIMEZONE_VISITAS = "America/Sao_Paulo";

const DIAS_DA_SEMANA: Record<string, string> = {
  Sunday: "DOMINGO",
  Monday: "SEGUNDA_FEIRA",
  Tuesday: "TERCA_FEIRA",
  Wednesday: "QUARTA_FEIRA",
  Thursday: "QUINTA_FEIRA",
  Friday: "SEXTA_FEIRA",
  Saturday: "SABADO",
};

export function obterDiaDaSemanaArbrain(
  data: Date = new Date(),
): string {
  const diaEmIngles = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: TIMEZONE_VISITAS,
  }).format(data);

  const diaArbrain = DIAS_DA_SEMANA[diaEmIngles];

  if (!diaArbrain) {
    throw new Error(
      `Não foi possível converter o dia: ${diaEmIngles}`,
    );
  }

  return diaArbrain;
}

export async function listarClientesComVisitaSemanal(
  tenantId: string,
  data: Date = new Date(),
) {
  const diaAtual = obterDiaDaSemanaArbrain(data);

  return prisma.cliente.findMany({
    where: {
      tenantId,
      periodicidadeDaVisita: "SEMANAL",
      clienteAtivo: true,
      clienteBloqueado: false,
      OR: [
        {
          diaVisitaPrimario: diaAtual,
        },
        {
          diaVisitaSecundario: diaAtual,
        },
      ],
    },
    orderBy: [
      {
        indexSequenciamentoVisita: "asc",
      },
      {
        sku: "asc",
      },
    ],
    select: {
      id: true,
      arbrainId: true,
      sku: true,
      nomeFantasia: true,
      razaoSocial: true,
      telefone: true,
      celular: true,
      diaVisitaPrimario: true,
      diaVisitaSecundario: true,
      periodicidadeDaVisita: true,
    },
  });
}