import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  processor: vi.fn(),
  acompanhar: vi.fn(),
  remover: vi.fn(),
  encerrarHeartbeat: vi.fn(),
  recuperarProcessing: vi.fn(),
  recuperarReceived: vi.fn(),
  fecharFila: vi.fn(),
  disconnectPrisma: vi.fn(),
  criarConexaoRedis: vi.fn(),
  Worker: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Worker: mocks.Worker,
}));
vi.mock("../src/database/prisma.js", () => ({
  prisma: {
    $disconnect: mocks.disconnectPrisma,
  },
}));
vi.mock("../src/integrations/botnext/botnext-webhook-processor.js", () => ({
  processarEventoBotnext: mocks.processor,
}));
vi.mock("../src/queue/botnext-processing-lease-service.js", () => ({
  reivindicarEventoBotnext: mocks.claim,
}));
vi.mock("../src/queue/botnext-processing-heartbeat.js", () => ({
  criarGerenciadorHeartbeatBotnext: () => ({
    acompanhar: mocks.acompanhar,
    remover: mocks.remover,
    encerrar: mocks.encerrarHeartbeat,
  }),
}));
vi.mock("../src/queue/botnext-processing-recovery.js", () => ({
  recuperarProcessamentosBotnextAbandonados: mocks.recuperarProcessing,
}));
vi.mock("../src/queue/botnext-webhook-recovery.js", () => ({
  recuperarEventosBotnextPendentes: mocks.recuperarReceived,
}));
vi.mock("../src/queue/botnext-webhook-queue.js", () => ({
  NOME_FILA_BOTNEXT_WEBHOOK: "botnext-webhook-events",
  NOME_JOB_PROCESSAR_EVENTO: "processar-evento-botnext",
  fecharFilaBotnext: mocks.fecharFila,
}));
vi.mock("../src/queue/redis-connection.js", () => ({
  criarConexaoRedisWorker: mocks.criarConexaoRedis,
}));

function criarJob(eventoId = "evento-1") {
  return {
    name: "processar-evento-botnext",
    data: { eventoId },
    attemptsMade: 0,
  };
}

describe("worker BotNext com lease", () => {
  beforeEach(() => {
    vi.resetModules();

    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }

    mocks.claim.mockResolvedValue({
      situacao: "ADQUIRIDO",
      processingToken: "token",
      processingAttempts: 1,
    });
    mocks.acompanhar.mockReturnValue({
      eventoId: "evento-1",
      processingToken: "token",
      possuiPosse: true,
    });
    mocks.processor.mockResolvedValue({
      processado: true,
      obsoleto: false,
      status: "PROCESSED",
      clienteId: "cliente-1",
      conversaId: "conversa-1",
      motivo: null,
    });
    mocks.recuperarProcessing.mockResolvedValue({
      encontrados: 0,
      recebidos: 0,
      falhados: 0,
    });
    mocks.recuperarReceived.mockResolvedValue({
      encontrados: 0,
      enfileirados: 0,
      falhas: 0,
      falhadosPorLimite: 0,
    });
    mocks.fecharFila.mockResolvedValue(undefined);
    mocks.disconnectPrisma.mockResolvedValue(undefined);
  });

  it("faz claim, acompanha heartbeat e processa", async () => {
    const { executarJob } =
      await import("../src/workers/botnext-webhook-worker.js");

    await executarJob(criarJob() as never);

    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(mocks.acompanhar).toHaveBeenCalledOnce();
    expect(mocks.processor).toHaveBeenCalledOnce();
    expect(mocks.remover).toHaveBeenCalledOnce();
  });

  it("sem claim considera job obsoleto e não processa", async () => {
    mocks.claim.mockResolvedValue({ situacao: "NAO_ADQUIRIDO" });
    const { executarJob } =
      await import("../src/workers/botnext-webhook-worker.js");

    await executarJob(criarJob() as never);

    expect(mocks.processor).not.toHaveBeenCalled();
    expect(mocks.acompanhar).not.toHaveBeenCalled();
  });

  it("dois workers concorrentes permitem apenas um processamento", async () => {
    mocks.claim
      .mockResolvedValueOnce({
        situacao: "ADQUIRIDO",
        processingToken: "token",
        processingAttempts: 1,
      })
      .mockResolvedValueOnce({ situacao: "NAO_ADQUIRIDO" });
    const { executarJob } =
      await import("../src/workers/botnext-webhook-worker.js");

    await Promise.all([
      executarJob(criarJob() as never),
      executarJob(criarJob() as never),
    ]);

    expect(mocks.processor).toHaveBeenCalledOnce();
  });

  it("job obsoleto termina sem retry inútil", async () => {
    mocks.processor.mockResolvedValue({
      processado: false,
      obsoleto: true,
      status: "PROCESSING",
      clienteId: null,
      conversaId: null,
      motivo: "LEASE_LOST",
    });
    const { executarJob } =
      await import("../src/workers/botnext-webhook-worker.js");

    await expect(executarJob(criarJob() as never)).resolves.toBeUndefined();
    expect(mocks.remover).toHaveBeenCalledOnce();
  });

  it("ciclo periódico recupera PROCESSING antes de RECEIVED", async () => {
    const ordem: string[] = [];
    mocks.recuperarProcessing.mockImplementation(async () => {
      ordem.push("PROCESSING");
      return { encontrados: 1, recebidos: 1, falhados: 0 };
    });
    mocks.recuperarReceived.mockImplementation(async () => {
      ordem.push("RECEIVED");
      return {
        encontrados: 1,
        enfileirados: 1,
        falhas: 0,
        falhadosPorLimite: 0,
      };
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { executarCicloRecuperacaoBotnext } =
      await import("../src/workers/botnext-webhook-worker.js");

    await executarCicloRecuperacaoBotnext();

    expect(ordem).toEqual(["PROCESSING", "RECEIVED"]);
  });

  it("importação não cria Worker nem conexão e shutdown limpa heartbeat", async () => {
    const modulo =
      await import("../src/workers/botnext-webhook-worker.js");

    expect(mocks.Worker).not.toHaveBeenCalled();
    expect(mocks.criarConexaoRedis).not.toHaveBeenCalled();

    await modulo.encerrarWorker();

    expect(mocks.encerrarHeartbeat).toHaveBeenCalledOnce();
    expect(mocks.fecharFila).toHaveBeenCalledOnce();
    expect(mocks.disconnectPrisma).toHaveBeenCalledOnce();
  });
});
