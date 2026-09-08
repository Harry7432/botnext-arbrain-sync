import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncRunUpdate: vi.fn(),
}));

vi.mock("../src/database/prisma.js", () => ({
  prisma: {
    syncRun: {
      update: mocks.syncRunUpdate,
    },
  },
}));

describe("falharSyncRun", () => {
  beforeEach(() => {
    mocks.syncRunUpdate.mockReset();
    mocks.syncRunUpdate.mockResolvedValue(undefined);
  });

  it("mantém compatibilidade com os chamadores atuais", async () => {
    const { falharSyncRun } =
      await import("../src/sync/sync-run-service.js");

    await falharSyncRun({
      syncRunId: "run-atual",
      processedRecords: 3,
      error: new Error("Falha controlada"),
    });

    const chamada = mocks.syncRunUpdate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(chamada.data).toMatchObject({
      status: "FAILED",
      processedRecords: 3,
      errorCount: { increment: 1 },
      errorMessage: "Falha controlada",
      finishedAt: expect.any(Date),
    });
    expect(chamada.data).not.toHaveProperty("totalRecords");
    expect(chamada.data).not.toHaveProperty("changedRecords");
    expect(chamada.data).not.toHaveProperty("unchangedRecords");
  });

  it("registra métricas opcionais em uma execução FAILED", async () => {
    const { falharSyncRun } =
      await import("../src/sync/sync-run-service.js");

    await falharSyncRun({
      syncRunId: "run-com-metricas",
      totalRecords: 20,
      processedRecords: 8,
      changedRecords: 5,
      unchangedRecords: 3,
      error: new Error("Falha no lote"),
    });

    expect(mocks.syncRunUpdate).toHaveBeenCalledWith({
      where: { id: "run-com-metricas" },
      data: {
        status: "FAILED",
        finishedAt: expect.any(Date),
        totalRecords: 20,
        processedRecords: 8,
        changedRecords: 5,
        unchangedRecords: 3,
        errorCount: { increment: 1 },
        errorMessage: "Falha no lote",
      },
    });
  });

  it("redige credenciais e payloads da mensagem persistida", async () => {
    const { falharSyncRun } =
      await import("../src/sync/sync-run-service.js");
    const mensagemSensivel =
      "Falha apiKey=chave-real token=token-real password=senha-real " +
      "Bearer bearer-real payload: {\"cliente\":\"Maria\"}";

    await falharSyncRun({
      syncRunId: "run-seguro",
      processedRecords: 0,
      error: new Error(mensagemSensivel),
    });

    const chamada = mocks.syncRunUpdate.mock.calls[0]?.[0] as {
      data: { errorMessage: string };
    };
    const mensagem = chamada.data.errorMessage;

    expect(mensagem).toContain("[REDACTED]");
    expect(mensagem).not.toContain("chave-real");
    expect(mensagem).not.toContain("token-real");
    expect(mensagem).not.toContain("senha-real");
    expect(mensagem).not.toContain("bearer-real");
    expect(mensagem).not.toContain("Maria");
  });

  it("não serializa objetos de erro que possam conter payloads", async () => {
    const { falharSyncRun } =
      await import("../src/sync/sync-run-service.js");

    await falharSyncRun({
      syncRunId: "run-erro-desconhecido",
      processedRecords: 0,
      error: {
        payload: { documento: "dado-pessoal" },
        apiKey: "credencial-real",
      },
    });

    const chamada = mocks.syncRunUpdate.mock.calls[0]?.[0] as {
      data: { errorMessage: string };
    };
    expect(chamada.data.errorMessage).toBe("Erro desconhecido");
  });
});
