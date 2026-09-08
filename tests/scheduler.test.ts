import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cronSchedule: vi.fn(),
  clientesResumidos: vi.fn(),
  clientesCompletos: vi.fn(),
  produtos: vi.fn(),
  cervejas: vi.fn(),
  pagamentos: vi.fn(),
  bancos: vi.fn(),
  empresas: vi.fn(),
}));

vi.mock("node-cron", () => ({
  default: {
    schedule: mocks.cronSchedule,
  },
}));

vi.mock("../src/sync/sync-clientes-resumo.js", () => ({
  sincronizarClientesResumidos: mocks.clientesResumidos,
}));
vi.mock("../src/sync/reconcile-clientes.js", () => ({
  reconciliarTodosOsClientes: mocks.clientesCompletos,
}));
vi.mock("../src/sync/sync-produtos-resumo.js", () => ({
  sincronizarProdutosResumo: mocks.produtos,
}));
vi.mock("../src/sync/sync-cervejas-resumo.js", () => ({
  sincronizarCervejasResumo: mocks.cervejas,
}));
vi.mock("../src/sync/sync-pagamentos-resumo.js", () => ({
  sincronizarPagamentosResumo: mocks.pagamentos,
}));
vi.mock("../src/sync/sync-bancos-resumo.js", () => ({
  sincronizarBancosResumo: mocks.bancos,
}));
vi.mock("../src/sync/sync-empresas-resumo.js", () => ({
  sincronizarEmpresasResumo: mocks.empresas,
}));

async function carregarScheduler() {
  return import("../src/scheduler.js");
}

describe("scheduler diário", () => {
  beforeEach(() => {
    vi.resetModules();

    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }

    mocks.cronSchedule.mockReturnValue({});
    mocks.clientesResumidos.mockResolvedValue(undefined);
    mocks.clientesCompletos.mockResolvedValue(undefined);
    mocks.produtos.mockResolvedValue(undefined);
    mocks.cervejas.mockResolvedValue(undefined);
    mocks.pagamentos.mockResolvedValue(undefined);
    mocks.bancos.mockResolvedValue(undefined);
    mocks.empresas.mockResolvedValue(undefined);

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("não inicia o cron nem sincroniza ao importar", async () => {
    await carregarScheduler();

    expect(mocks.cronSchedule).not.toHaveBeenCalled();
    expect(mocks.clientesResumidos).not.toHaveBeenCalled();
  });

  it("agenda a rotina com a configuração existente", async () => {
    const { executarSincronizacaoDiaria, iniciarAgendador } =
      await carregarScheduler();

    iniciarAgendador();

    expect(mocks.cronSchedule).toHaveBeenCalledWith(
      "0 0 * * *",
      executarSincronizacaoDiaria,
      {
        name: "sincronizacao-arbrain-diaria",
        timezone: "America/Sao_Paulo",
        noOverlap: true,
      },
    );
  });

  it("executa todas as sincronizações na ordem correta", async () => {
    const ordem: string[] = [];
    mocks.clientesResumidos.mockImplementation(async () => {
      ordem.push("clientes_resumidos");
    });
    mocks.clientesCompletos.mockImplementation(async () => {
      ordem.push("clientes_completos");
    });
    mocks.produtos.mockImplementation(async () => {
      ordem.push("produtos");
    });
    mocks.cervejas.mockImplementation(async () => {
      ordem.push("cervejas");
    });
    mocks.pagamentos.mockImplementation(async () => {
      ordem.push("pagamentos");
    });
    mocks.bancos.mockImplementation(async () => {
      ordem.push("bancos");
    });
    mocks.empresas.mockImplementation(async () => {
      ordem.push("empresas");
    });
    const { executarSincronizacaoDiaria } = await carregarScheduler();

    await executarSincronizacaoDiaria();

    expect(ordem).toEqual([
      "clientes_resumidos",
      "clientes_completos",
      "produtos",
      "cervejas",
      "pagamentos",
      "bancos",
      "empresas",
    ]);
  });

  it("interrompe as etapas seguintes quando uma sincronização falha", async () => {
    mocks.clientesCompletos.mockRejectedValue(
      new Error("Falha controlada"),
    );
    const { executarSincronizacaoDiaria } = await carregarScheduler();

    await executarSincronizacaoDiaria();

    expect(mocks.clientesResumidos).toHaveBeenCalledOnce();
    expect(mocks.clientesCompletos).toHaveBeenCalledOnce();
    expect(mocks.produtos).not.toHaveBeenCalled();
    expect(mocks.cervejas).not.toHaveBeenCalled();
    expect(mocks.pagamentos).not.toHaveBeenCalled();
    expect(mocks.bancos).not.toHaveBeenCalled();
    expect(mocks.empresas).not.toHaveBeenCalled();
  });
});
