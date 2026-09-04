import "dotenv/config";

import {
  BotnextWebhookStatus,
} from "@prisma/client";

import {
  type Job,
  Worker,
} from "bullmq";

import {
  prisma,
} from "../database/prisma.js";

import {
  processarEventoBotnext,
} from "../integrations/botnext/botnext-webhook-processor.js";

import {
  type DadosJobBotnextWebhook,
  fecharFilaBotnext,
  NOME_FILA_BOTNEXT_WEBHOOK,
  NOME_JOB_PROCESSAR_EVENTO,
} from "../queue/botnext-webhook-queue.js";

import {
  recuperarEventosBotnextPendentes,
} from "../queue/botnext-webhook-recovery.js";

import {
  criarConexaoRedisWorker,
} from "../queue/redis-connection.js";

const TEMPO_REINICIO_WORKER_MS = 5_000;
const INTERVALO_LOG_FALHA_MS = 5_000;
const INTERVALO_RECUPERACAO_EVENTOS_MS = 30_000;

let workerBotnextWebhook:
  Worker<DadosJobBotnextWebhook> | null = null;

let reinicioAgendado:
  NodeJS.Timeout | null = null;

let intervaloRecuperacao:
  NodeJS.Timeout | null = null;

let recuperacaoEmAndamento:
  Promise<void> | null = null;

let fechamentoEmAndamento:
  Promise<void> | null = null;

let encerrando = false;
let reiniciando = false;
let ultimoLogFalhaEm = 0;

async function prepararNovaTentativa(
  eventoId: string,
  tentativasRealizadas: number,
): Promise<void> {
  if (tentativasRealizadas === 0) {
    return;
  }

  // FAILED indica uma tentativa que registrou falha.
  //
  // PROCESSING não é redefinido aqui: ele pode pertencer
  // a uma execução ainda ativa.
  await prisma.botnextWebhookEvent.updateMany({
    where: {
      id: eventoId,
      status: BotnextWebhookStatus.FAILED,
    },
    data: {
      status: BotnextWebhookStatus.RECEIVED,
      processedAt: null,
      errorMessage: null,
    },
  });
}

async function executarJob(
  job: Job<DadosJobBotnextWebhook>,
): Promise<void> {
  if (job.name !== NOME_JOB_PROCESSAR_EVENTO) {
    throw new Error(
      "Tipo de trabalho BotNext não reconhecido.",
    );
  }

  const eventoId = job.data.eventoId?.trim();

  if (!eventoId) {
    throw new Error(
      "Job BotNext sem eventoId.",
    );
  }

  await prepararNovaTentativa(
    eventoId,
    job.attemptsMade,
  );

  const resultado = await processarEventoBotnext(
    eventoId,
  );

  if (
    resultado.status === BotnextWebhookStatus.RECEIVED ||
    resultado.status === BotnextWebhookStatus.PROCESSING ||
    resultado.status === BotnextWebhookStatus.FAILED
  ) {
    // Não considera um evento pendente como concluído.
    throw new Error(
      "Evento BotNext ainda não foi finalizado.",
    );
  }
}

function registrarFalhaDeConexao(): void {
  const agora = Date.now();

  if (
    agora - ultimoLogFalhaEm <
    INTERVALO_LOG_FALHA_MS
  ) {
    return;
  }

  ultimoLogFalhaEm = agora;

  console.error(
    "Falha na conexão do worker BotNext. Nova conexão será tentada.",
  );
}

function cancelarReinicioAgendado(): void {
  if (!reinicioAgendado) {
    return;
  }

  clearTimeout(reinicioAgendado);
  reinicioAgendado = null;
}

async function fecharInstanciaAtual(): Promise<void> {
  // Reinício e encerramento podem solicitar o fechamento
  // ao mesmo tempo. Ambos aguardam a mesma operação.
  if (fechamentoEmAndamento) {
    return fechamentoEmAndamento;
  }

  const workerAtual = workerBotnextWebhook;

  if (!workerAtual) {
    return;
  }

  // Sem true: aguarda os trabalhos ativos finalizarem.
  const fechamento = workerAtual.close();

  fechamentoEmAndamento = fechamento;

  try {
    await fechamento;

    if (workerBotnextWebhook === workerAtual) {
      workerBotnextWebhook = null;
    }
  } finally {
    if (fechamentoEmAndamento === fechamento) {
      fechamentoEmAndamento = null;
    }
  }
}

function agendarReinicioWorker(): void {
  if (
    encerrando ||
    reiniciando ||
    reinicioAgendado
  ) {
    return;
  }

  reinicioAgendado = setTimeout(() => {
    reinicioAgendado = null;

    void reiniciarWorker().catch(() => {
      registrarFalhaDeConexao();
      agendarReinicioWorker();
    });
  }, TEMPO_REINICIO_WORKER_MS);
}

async function recuperarERegistrarPendentes(): Promise<void> {
  try {
    const resultado =
      await recuperarEventosBotnextPendentes();

    if (resultado.enfileirados > 0) {
      console.log(
        `${resultado.enfileirados} evento(s) pendente(s) reenfileirado(s).`,
      );
    }

    if (resultado.falhas > 0) {
      console.warn(
        "Recuperação de eventos aguardando o retorno do Redis.",
      );
    }
  } catch {
    console.error(
      "Falha ao consultar eventos BotNext pendentes.",
    );
  }
}

async function executarRecuperacaoDePendentes(): Promise<void> {
  if (encerrando) {
    return;
  }

  if (recuperacaoEmAndamento) {
    return recuperacaoEmAndamento;
  }

  const recuperacao = recuperarERegistrarPendentes();

 recuperacaoEmAndamento = recuperacao;

  try {
    await recuperacao;
  } finally {
    if (recuperacaoEmAndamento === recuperacao) {
      recuperacaoEmAndamento = null;
    }
  }
}

function iniciarRecuperacaoPeriodica(): void {
  if (
    encerrando ||
    intervaloRecuperacao
  ) {
    return;
  }

  void executarRecuperacaoDePendentes();

  intervaloRecuperacao = setInterval(() => {
    void executarRecuperacaoDePendentes();
  }, INTERVALO_RECUPERACAO_EVENTOS_MS);
}

function encerrarRecuperacaoPeriodica(): void {
  if (!intervaloRecuperacao) {
    return;
  }

  clearInterval(intervaloRecuperacao);
  intervaloRecuperacao = null;
}

function criarWorker(): Worker<DadosJobBotnextWebhook> {
  const worker = new Worker<DadosJobBotnextWebhook>(
    NOME_FILA_BOTNEXT_WEBHOOK,
    executarJob,
    {
      connection: criarConexaoRedisWorker(),
      concurrency: 5,
    },
  );

  worker.on("ready", () => {
    if (
      worker !== workerBotnextWebhook ||
      encerrando
    ) {
      return;
    }

    cancelarReinicioAgendado();
    ultimoLogFalhaEm = 0;

    console.log(
      "Worker BotNext conectado ao Redis.",
    );

    console.log(
      "Aguardando eventos persistidos no PostgreSQL.",
    );

    iniciarRecuperacaoPeriodica();
  });

  worker.on("completed", (job) => {
    console.log(
      `Evento BotNext processado pelo worker: ${job.id}.`,
    );
  });

  worker.on("failed", (job) => {
    console.error(
      `Falha no job BotNext: ${job?.id ?? "desconhecido"}.`,
    );
  });

  worker.on("error", () => {
    if (
      worker !== workerBotnextWebhook ||
      encerrando ||
      fechamentoEmAndamento
    ) {
      return;
    }

    registrarFalhaDeConexao();
    agendarReinicioWorker();
  });

  return worker;
}

function iniciarWorker(): void {
  if (
    encerrando ||
    workerBotnextWebhook
  ) {
    return;
  }

  workerBotnextWebhook = criarWorker();
}

async function reiniciarWorker(): Promise<void> {
  if (
    encerrando ||
    reiniciando
  ) {
    return;
  }

  reiniciando = true;

  try {
    console.log(
      "Recriando conexão do worker BotNext...",
    );

    await fecharInstanciaAtual();

    if (!encerrando) {
      iniciarWorker();
    }
  } finally {
    reiniciando = false;
  }
}

async function encerrarWorker(): Promise<void> {
  if (encerrando) {
    return;
  }

  encerrando = true;

  cancelarReinicioAgendado();
  encerrarRecuperacaoPeriodica();

  console.log(
    "Encerrando worker BotNext; aguardando trabalhos ativos...",
  );

  await fecharInstanciaAtual();

  // Aguarda a recuperação que já estava em execução
  // antes de fechar a fila produtora.
  const recuperacaoAtual = recuperacaoEmAndamento;

  if (recuperacaoAtual) {
    await recuperacaoAtual;
  }

  await fecharFilaBotnext();
  await prisma.$disconnect();

  console.log(
    "Worker BotNext encerrado.",
  );
}

function solicitarEncerramento(): void {
  void encerrarWorker().catch(() => {
    console.error(
      "Falha ao encerrar o worker BotNext completamente.",
    );

    process.exitCode = 1;
  });
}

process.once(
  "SIGINT",
  solicitarEncerramento,
);

process.once(
  "SIGTERM",
  solicitarEncerramento,
);

try {
  iniciarWorker();
} catch {
  registrarFalhaDeConexao();
  agendarReinicioWorker();
}