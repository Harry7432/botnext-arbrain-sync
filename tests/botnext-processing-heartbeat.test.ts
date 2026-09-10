import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const EVENTO_ID = "10000000-0000-4000-8000-000000000001";
const TOKEN = "20000000-0000-4000-8000-000000000002";

describe("gerenciador de heartbeat BotNext", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renova leases com um timer único", async () => {
    vi.useFakeTimers();
    const renovarLease = vi.fn().mockResolvedValue("RENOVADA");
    const { criarGerenciadorHeartbeatBotnext } =
      await import("../src/queue/botnext-processing-heartbeat.js");
    const gerenciador = criarGerenciadorHeartbeatBotnext({
      intervaloMs: 1_000,
      duracaoLeaseMs: 60_000,
      renovarLease,
    });

    gerenciador.acompanhar(EVENTO_ID, TOKEN);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(renovarLease).toHaveBeenCalledWith({
      eventoId: EVENTO_ID,
      processingToken: TOKEN,
      duracaoLeaseMs: 60_000,
    });
    await gerenciador.encerrar();
  });

  it("marca posse perdida e remove a lease local", async () => {
    const renovarLease = vi.fn().mockResolvedValue("LEASE_LOST");
    const { criarGerenciadorHeartbeatBotnext } =
      await import("../src/queue/botnext-processing-heartbeat.js");
    const gerenciador = criarGerenciadorHeartbeatBotnext({
      intervaloMs: 1_000,
      duracaoLeaseMs: 60_000,
      renovarLease,
    });
    const lease = gerenciador.acompanhar(EVENTO_ID, TOKEN);

    await gerenciador.executarHeartbeat();

    expect(lease.possuiPosse).toBe(false);
    expect(gerenciador.quantidadeAtiva()).toBe(0);
    await gerenciador.encerrar();
  });

  it("mantém a lease após erro temporário e tenta novamente", async () => {
    const registrarErro = vi.fn();
    const renovarLease = vi.fn()
      .mockRejectedValueOnce(new Error("PostgreSQL indisponível"))
      .mockResolvedValueOnce("RENOVADA");
    const { criarGerenciadorHeartbeatBotnext } =
      await import("../src/queue/botnext-processing-heartbeat.js");
    const gerenciador = criarGerenciadorHeartbeatBotnext({
      intervaloMs: 1_000,
      duracaoLeaseMs: 60_000,
      renovarLease,
      registrarErro,
    });
    const lease = gerenciador.acompanhar(EVENTO_ID, TOKEN);

    await gerenciador.executarHeartbeat();
    await gerenciador.executarHeartbeat();

    expect(registrarErro).toHaveBeenCalledOnce();
    expect(renovarLease).toHaveBeenCalledTimes(2);
    expect(lease.possuiPosse).toBe(true);
    await gerenciador.encerrar();
  });

  it("shutdown limpa timer, leases e impede novos heartbeats", async () => {
    vi.useFakeTimers();
    const renovarLease = vi.fn().mockResolvedValue("RENOVADA");
    const { criarGerenciadorHeartbeatBotnext } =
      await import("../src/queue/botnext-processing-heartbeat.js");
    const gerenciador = criarGerenciadorHeartbeatBotnext({
      intervaloMs: 1_000,
      duracaoLeaseMs: 60_000,
      renovarLease,
    });
    const lease = gerenciador.acompanhar(EVENTO_ID, TOKEN);

    await gerenciador.encerrar();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(lease.possuiPosse).toBe(false);
    expect(gerenciador.quantidadeAtiva()).toBe(0);
    expect(renovarLease).not.toHaveBeenCalled();
  });

  it("shutdown aguarda heartbeat que já estava em andamento", async () => {
    let concluirRenovacao: (() => void) | undefined;
    const renovarLease = vi.fn(() => new Promise<"RENOVADA">((resolve) => {
      concluirRenovacao = () => resolve("RENOVADA");
    }));
    const { criarGerenciadorHeartbeatBotnext } =
      await import("../src/queue/botnext-processing-heartbeat.js");
    const gerenciador = criarGerenciadorHeartbeatBotnext({
      intervaloMs: 1_000,
      duracaoLeaseMs: 60_000,
      renovarLease,
    });
    gerenciador.acompanhar(EVENTO_ID, TOKEN);
    const heartbeat = gerenciador.executarHeartbeat();
    let encerrado = false;
    const encerramento = gerenciador.encerrar().then(() => {
      encerrado = true;
    });

    await Promise.resolve();
    expect(encerrado).toBe(false);

    concluirRenovacao?.();
    await heartbeat;
    await encerramento;

    expect(encerrado).toBe(true);
    expect(gerenciador.quantidadeAtiva()).toBe(0);
  });
});
