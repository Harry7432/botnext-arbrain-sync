import {
  Queue,
} from "bullmq";

import type {
  Redis,
} from "ioredis";

import {
  criarConexaoRedisProdutor,
} from "./redis-connection.js";

import {
  criarJobIdEventoBotnext,
} from "./botnext-webhook-job-id.js";

import {
  BOTNEXT_PROCESSING_MAX_ATTEMPTS,
} from "./botnext-processing-config.js";

export const NOME_FILA_BOTNEXT_WEBHOOK =
  "botnext-webhook-events";

export const NOME_JOB_PROCESSAR_EVENTO =
  "processar-evento-botnext";

export type DadosJobBotnextWebhook = {
  eventoId: string;
};

export type ResultadoEnfileiramentoBotnext =
  | "ENFILEIRADO"
  | "JOB_CANONICO_PROCESSAVEL";

const ESTADOS_JOB_PROCESSAVEL = new Set([
  "waiting",
  "active",
  "delayed",
  "prioritized",
  "waiting-children",
]);

let filaBotnextWebhook:
  Queue<DadosJobBotnextWebhook> | null =
    null;

let clienteRedisProdutor:
  Redis | null =
    null;

let ultimoLogDeFalha =
  0;

function registrarFalhaDeConexao():
  void {
  const agora =
    Date.now();

  if (
    agora -
      ultimoLogDeFalha <
    5_000
  ) {
    return;
  }

  ultimoLogDeFalha =
    agora;

  console.error(
    "Fila BotNext sem conexão com o Redis.",
  );
}

function obterFilaBotnextWebhook():
  Queue<DadosJobBotnextWebhook> {
  if (filaBotnextWebhook) {
    return filaBotnextWebhook;
  }

  clienteRedisProdutor =
    criarConexaoRedisProdutor();

  clienteRedisProdutor.on(
    "error",
    registrarFalhaDeConexao,
  );

  filaBotnextWebhook =
    new Queue<DadosJobBotnextWebhook>(
      NOME_FILA_BOTNEXT_WEBHOOK,
      {
        connection:
          clienteRedisProdutor,

        defaultJobOptions: {
          attempts:
            BOTNEXT_PROCESSING_MAX_ATTEMPTS,

          backoff: {
            type:
              "exponential",

            delay:
              2_000,
          },

          removeOnComplete: {
            age:
              24 * 60 * 60,

            count:
              1_000,
          },

          removeOnFail: {
            age:
              7 * 24 * 60 * 60,

            count:
              5_000,
          },
        },
      },
    );

  filaBotnextWebhook.on(
    "error",
    registrarFalhaDeConexao,
  );

  return filaBotnextWebhook;
}

async function aguardarFilaPronta(
  fila: Queue<DadosJobBotnextWebhook>,
): Promise<void> {
  await fila.waitUntilReady();

  if (
    !clienteRedisProdutor ||
    clienteRedisProdutor.status !==
      "ready"
  ) {
    throw new Error(
      "Redis não está pronto para receber o evento.",
    );
  }

  const resposta =
    await clienteRedisProdutor.ping();

  if (
    resposta !== "PONG" ||
    clienteRedisProdutor.status !==
      "ready"
  ) {
    throw new Error(
      "Redis não confirmou disponibilidade.",
    );
  }
}

export async function verificarFilaBotnext():
  Promise<void> {
  const fila =
    obterFilaBotnextWebhook();

  await aguardarFilaPronta(
    fila,
  );
}

export async function enfileirarEventoBotnext(
  eventoId: string,
  enqueueToken?: string,
): Promise<ResultadoEnfileiramentoBotnext> {
  const fila =
    obterFilaBotnextWebhook();

  // Na primeira utilização, aguarda a conexão sair
  // do estado inicial e ficar realmente pronta.
  await aguardarFilaPronta(
    fila,
  );

  let jobId = criarJobIdEventoBotnext(eventoId);

  if (enqueueToken) {
    const jobCanonico = await fila.getJob(jobId);

    if (jobCanonico) {
      const estado = await jobCanonico.getState();

      if (ESTADOS_JOB_PROCESSAVEL.has(estado)) {
        return "JOB_CANONICO_PROCESSAVEL";
      }

      jobId = criarJobIdEventoBotnext(eventoId, enqueueToken);
    }
  }

  await fila.add(
    NOME_JOB_PROCESSAR_EVENTO,
    {
      eventoId,
    },
    {
      // O mesmo evento não cria dois trabalhos na fila.
      jobId,
    },
  );

  return "ENFILEIRADO";
}

export async function fecharFilaBotnext():
  Promise<void> {
  if (filaBotnextWebhook) {
    await filaBotnextWebhook.close();

    filaBotnextWebhook =
      null;
  }

  if (clienteRedisProdutor) {
    if (
      clienteRedisProdutor.status ===
      "ready"
    ) {
      await clienteRedisProdutor.quit();
    } else {
      clienteRedisProdutor.disconnect();
    }

    clienteRedisProdutor =
      null;
  }
}
