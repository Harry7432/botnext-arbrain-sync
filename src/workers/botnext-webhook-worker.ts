import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { pathToFileURL } from "node:url";

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
  reivindicarEventoBotnext,
} from "../queue/botnext-processing-lease-service.js";

import {
  BOTNEXT_PROCESSING_HEARTBEAT_MS,
  BOTNEXT_PROCESSING_LEASE_MS,
  BOTNEXT_PROCESSING_MAX_ATTEMPTS,
} from "../queue/botnext-processing-config.js";

import {
  criarGerenciadorHeartbeatBotnext,
} from "../queue/botnext-processing-heartbeat.js";

import {
  recuperarProcessamentosBotnextAbandonados,
} from "../queue/botnext-processing-recovery.js";

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

let encerramentoEmAndamento:
  Promise<void> | null = null;

let encerrando = false;
let reiniciando = false;
let ultimoLogFalhaEm = 0;
let sinaisRegistrados = false;

const gerenciadorHeartbeat =
  criarGerenciadorHeartbeatBotnext({
    intervaloMs: BOTNEXT_PROCESSING_HEARTBEAT_MS,
    duracaoLeaseMs: BOTNEXT_PROCESSING_LEASE_MS,
  });

export async function executarJob(
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

  const processingToken = randomUUID();
  const claim = await reivindicarEventoBotnext({
    eventoId,
    processingToken,
    processingWorker: `${hostname()}:${process.pid}`,
    duracaoLeaseMs: BOTNEXT_PROCESSING_LEASE_MS,
    maximoTentativas: BOTNEXT_PROCESSING_MAX_ATTEMPTS,
  });

  if (claim.situacao === "NAO_ADQUIRIDO") {
    return;
  }

  const leaseAtiva = gerenciadorHeartbeat.acompanhar(
    eventoId,
    processingToken,
  );

  try {
    const resultado = await processarEventoBotnext(
      eventoId,
      processingToken,
      () => leaseAtiva.possuiPosse,
    );

    if (resultado.obsoleto) {
      return;
    }

    if (resultado.status === "RECEIVED") {
      throw new Error(
        "Evento BotNext aguardando nova tentativa.",
      );
    }
  } finally {
    gerenciadorHeartbeat.remover(processingToken);
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

export async function executarCicloRecuperacaoBotnext(): Promise<void> {
  try {
    const processamentos =
      await recuperarProcessamentosBotnextAbandonados();

    const resultado =
      await recuperarEventosBotnextPendentes();

    if (processamentos.recebidos > 0) {
      console.log(
        `${processamentos.recebidos} processamento(s) BotNext abandonado(s) recuperado(s).`,
      );
    }

    if (processamentos.falhados > 0) {
      console.warn(
        `${processamentos.falhados} processamento(s) BotNext atingiram o limite de tentativas.`,
      );
    }

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

  const recuperacao = executarCicloRecuperacaoBotnext();

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

function registrarSinais(): void {
  if (sinaisRegistrados) {
    return;
  }

  sinaisRegistrados = true;
  process.once("SIGINT", solicitarEncerramento);
  process.once("SIGTERM", solicitarEncerramento);
}

export function iniciarWorker(): void {
  if (
    encerrando ||
    workerBotnextWebhook
  ) {
    return;
  }

  registrarSinais();
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

async function realizarEncerramento(): Promise<void> {
  encerrando = true;

  cancelarReinicioAgendado();
  encerrarRecuperacaoPeriodica();

  console.log(
    "Encerrando worker BotNext; aguardando trabalhos ativos...",
  );

  await fecharInstanciaAtual();
  await gerenciadorHeartbeat.encerrar();

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

export function encerrarWorker(): Promise<void> {
  if (!encerramentoEmAndamento) {
    encerramentoEmAndamento = realizarEncerramento();
  }

  return encerramentoEmAndamento;
}

function solicitarEncerramento(): void {
  void encerrarWorker().catch(() => {
    console.error(
      "Falha ao encerrar o worker BotNext completamente.",
    );

    process.exitCode = 1;
  });
}

const caminhoExecutado = process.argv[1];
const arquivoExecutadoDiretamente =
  caminhoExecutado !== undefined &&
  import.meta.url === pathToFileURL(caminhoExecutado).href;

if (arquivoExecutadoDiretamente) {
  // Mesma validação central do server.ts: falha fechado (crash) antes de
  // conectar ao Redis/iniciar o worker se BOTNEXT_TEST_MODE/BOTNEXT_TEST_TO
  // (ou qualquer outra variável validada) estiver ausente ou inválida.
  await import("../config/env.js");

  try {
    iniciarWorker();
  } catch {
    registrarFalhaDeConexao();
    agendarReinicioWorker();
  }
}
