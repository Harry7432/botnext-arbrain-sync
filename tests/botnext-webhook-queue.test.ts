import { beforeEach, describe, expect, it, vi } from "vitest";

const EVENTO_ID = "10000000-0000-4000-8000-000000000001";
const TOKEN = "20000000-0000-4000-8000-000000000002";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  getJob: vi.fn(),
  waitUntilReady: vi.fn(),
  queueOn: vi.fn(),
  redisOn: vi.fn(),
  ping: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(function () {
    return {
      add: mocks.add,
      getJob: mocks.getJob,
      waitUntilReady: mocks.waitUntilReady,
      on: mocks.queueOn,
    };
  }),
}));

vi.mock("../src/queue/redis-connection.js", () => ({
  criarConexaoRedisProdutor: () => ({
    status: "ready",
    on: mocks.redisOn,
    ping: mocks.ping,
  }),
}));

import { enfileirarEventoBotnext } from "../src/queue/botnext-webhook-queue.js";

describe("fila de webhook BotNext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.waitUntilReady.mockResolvedValue(undefined);
    mocks.ping.mockResolvedValue("PONG");
    mocks.add.mockResolvedValue({ id: EVENTO_ID });
    mocks.getJob.mockResolvedValue(null);
  });

  it.each(["waiting", "active", "delayed"])(
    "não cria recovery quando o job canônico está %s",
    async (estado) => {
      mocks.getJob.mockResolvedValue({
        getState: vi.fn().mockResolvedValue(estado),
      });

      const resultado = await enfileirarEventoBotnext(EVENTO_ID, TOKEN);

      expect(resultado).toBe("JOB_CANONICO_PROCESSAVEL");
      expect(mocks.getJob).toHaveBeenCalledWith(EVENTO_ID);
      expect(mocks.add).not.toHaveBeenCalled();
    },
  );

  it("usa o ID canônico no primeiro recovery quando ele não existe", async () => {
    const resultado = await enfileirarEventoBotnext(EVENTO_ID, TOKEN);

    expect(resultado).toBe("ENFILEIRADO");
    expect(mocks.add).toHaveBeenCalledWith(
      "processar-evento-botnext",
      { eventoId: EVENTO_ID },
      { jobId: EVENTO_ID },
    );
  });

  it("preserva histórico concluído e usa ID isolado no recovery", async () => {
    mocks.getJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue("completed"),
    });

    const resultado = await enfileirarEventoBotnext(EVENTO_ID, TOKEN);

    expect(resultado).toBe("ENFILEIRADO");
    expect(mocks.add).toHaveBeenCalledWith(
      "processar-evento-botnext",
      { eventoId: EVENTO_ID },
      { jobId: `${EVENTO_ID}-recovery-${TOKEN}` },
    );
  });
});
