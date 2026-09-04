import { prisma } from "./database/prisma.js";

const TIMEZONE = "America/Sao_Paulo";

const DIAS_DA_SEMANA: Record<string, string> = {
  Sunday: "DOMINGO",
  Monday: "SEGUNDA_FEIRA",
  Tuesday: "TERCA_FEIRA",
  Wednesday: "QUARTA_FEIRA",
  Thursday: "QUINTA_FEIRA",
  Friday: "SEXTA_FEIRA",
  Saturday: "SABADO",
};

function obterDiaAtual(): string {
  const diaEmIngles = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: TIMEZONE,
  }).format(new Date());

  const diaArbrain = DIAS_DA_SEMANA[diaEmIngles];

  if (!diaArbrain) {
    throw new Error(
      `Não foi possível converter o dia: ${diaEmIngles}`,
    );
  }

  return diaArbrain;
}

async function testarVisitasSemanaisHoje(): Promise<void> {
  console.log(
    "Consultando visitas semanais no nosso PostgreSQL...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const diaAtual = obterDiaAtual();

  console.log(`Dia considerado: ${diaAtual}`);
  console.log(`Fuso horário: ${TIMEZONE}`);

  const filtroDoDia = {
    tenantId: tenant.id,
    periodicidadeDaVisita: "SEMANAL",
    OR: [
      {
        diaVisitaPrimario: diaAtual,
      },
      {
        diaVisitaSecundario: diaAtual,
      },
    ],
  };

  const totalAgendado = await prisma.cliente.count({
    where: filtroDoDia,
  });

  const ativosEDesbloqueados = await prisma.cliente.count({
    where: {
      ...filtroDoDia,
      clienteAtivo: true,
      clienteBloqueado: false,
    },
  });

  const inativosOuBloqueados =
    totalAgendado - ativosEDesbloqueados;

  console.log(
    `Clientes semanais agendados: ${totalAgendado}`,
  );

  console.log(
    `Ativos e desbloqueados: ${ativosEDesbloqueados}`,
  );

  console.log(
    `Inativos ou bloqueados: ${inativosOuBloqueados}`,
  );

  console.log(
    "Clientes quinzenais e mensais foram ignorados neste teste.",
  );

  console.log(
    "Nenhuma mensagem foi enviada pelo BotNext.",
  );

  console.log(
    "Nenhuma chamada ou escrita foi enviada ao ArBrain.",
  );
}

testarVisitasSemanaisHoje()
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