import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  concluirSyncRun: vi.fn(),
  disconnect: vi.fn(),
  falharSyncRun: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  iniciarSyncRun: vi.fn(),
  listarClientes: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("../src/database/prisma.js", () => ({
  prisma: {
    tenant: {
      findUnique: mocks.findUnique,
    },
    cliente: {
      findMany: mocks.findMany,
      update: mocks.update,
      upsert: mocks.upsert,
    },
    $transaction: mocks.transaction,
    $disconnect: mocks.disconnect,
  },
}));

vi.mock("../src/integrations/arbrain/arbrain-clientes.js", () => ({
  listarClientes: mocks.listarClientes,
}));

vi.mock("../src/sync/sync-run-service.js", () => ({
  concluirSyncRun: mocks.concluirSyncRun,
  falharSyncRun: mocks.falharSyncRun,
  iniciarSyncRun: mocks.iniciarSyncRun,
}));

interface ClienteLocalDeTeste {
  arbrainId: string;
  sku: number;
  nomeFantasia: string | null;
  payloadHash?: string | null;
  syncedAt?: Date;
  lastSeenAt?: Date;
}

async function carregarSincronizador() {
  return import("../src/sync/sync-clientes-resumo.js");
}

describe("sincronização de clientes resumidos", () => {
  beforeEach(() => {
    vi.resetModules();

    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }

    mocks.findUnique.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      slug: "lrc",
    });
    mocks.findMany.mockResolvedValue([]);
    mocks.iniciarSyncRun.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000002",
      status: "RUNNING",
    });
    mocks.concluirSyncRun.mockResolvedValue(undefined);
    mocks.falharSyncRun.mockResolvedValue(undefined);
    mocks.update.mockImplementation(async (args: unknown) => args);
    mocks.upsert.mockImplementation(async (args: unknown) => args);
    mocks.transaction.mockResolvedValue([]);

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("não executa a sincronização ao importar o módulo", async () => {
    await carregarSincronizador();

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.listarClientes).not.toHaveBeenCalled();
    expect(mocks.iniciarSyncRun).not.toHaveBeenCalled();
  });

  it("cria cliente novo com payloadHash nulo", async () => {
    mocks.listarClientes.mockResolvedValue([
      { id: " cliente-1 ", nome: " Cliente Um ", sku: 10 },
    ]);
    const { sincronizarClientesResumidos } =
      await carregarSincronizador();

    await sincronizarClientesResumidos();

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          arbrainId: "cliente-1",
          nomeFantasia: "Cliente Um",
          sku: 10,
          payloadHash: null,
          syncedAt: expect.any(Date),
          lastSeenAt: expect.any(Date),
        }),
      }),
    );
    expect(mocks.concluirSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        totalRecords: 1,
        processedRecords: 1,
        changedRecords: 1,
        unchangedRecords: 0,
      }),
    );
  });

  it("preserva o payloadHash completo de cliente existente", async () => {
    const clienteLocal: ClienteLocalDeTeste = {
      arbrainId: "cliente-1",
      nomeFantasia: "Nome Antigo",
      sku: 10,
      payloadHash: "hash-completo-existente",
    };
    mocks.findMany.mockResolvedValue([clienteLocal]);
    mocks.listarClientes.mockResolvedValue([
      { id: "cliente-1", nome: "Nome Novo", sku: 10 },
    ]);
    mocks.upsert.mockImplementation(async (args: {
      update: Partial<ClienteLocalDeTeste>;
    }) => {
      Object.assign(clienteLocal, args.update);
      return args;
    });
    const { sincronizarClientesResumidos } =
      await carregarSincronizador();

    await sincronizarClientesResumidos();

    const chamada = mocks.upsert.mock.calls[0]?.[0] as {
      update: Record<string, unknown>;
    };
    expect(chamada.update).not.toHaveProperty("payloadHash");
    expect(clienteLocal.payloadHash).toBe("hash-completo-existente");
  });

  it("atualiza somente lastSeenAt quando não há alteração", async () => {
    mocks.findMany.mockResolvedValue([
      {
        arbrainId: "cliente-1",
        nomeFantasia: "Cliente Um",
        sku: 10,
      },
    ]);
    mocks.listarClientes.mockResolvedValue([
      { id: "cliente-1", nome: "Cliente Um", sku: 10 },
    ]);
    const { sincronizarClientesResumidos } =
      await carregarSincronizador();

    await sincronizarClientesResumidos();

    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledOnce();
    const chamada = mocks.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(Object.keys(chamada.data)).toEqual(["lastSeenAt"]);
    expect(chamada.data.lastSeenAt).toBeInstanceOf(Date);
    expect(mocks.concluirSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        changedRecords: 0,
        unchangedRecords: 1,
      }),
    );
  });

  it.each([
    {
      descricao: "SKU",
      local: { nomeFantasia: "Cliente Um", sku: 10 },
      remoto: { nome: "Cliente Um", sku: 11 },
    },
    {
      descricao: "nome",
      local: { nomeFantasia: "Nome Antigo", sku: 10 },
      remoto: { nome: "Nome Novo", sku: 10 },
    },
  ])(
    "atualiza dados e datas quando o $descricao muda",
    async ({ local, remoto }) => {
      mocks.findMany.mockResolvedValue([
        { arbrainId: "cliente-1", ...local },
      ]);
      mocks.listarClientes.mockResolvedValue([
        { id: "cliente-1", ...remoto },
      ]);
      const { sincronizarClientesResumidos } =
        await carregarSincronizador();

      await sincronizarClientesResumidos();

      const chamada = mocks.upsert.mock.calls[0]?.[0] as {
        update: Record<string, unknown>;
      };
      expect(chamada.update).toEqual({
        sku: remoto.sku,
        nomeFantasia: remoto.nome,
        syncedAt: expect.any(Date),
        lastSeenAt: expect.any(Date),
      });
      expect(chamada.update).not.toHaveProperty("payloadHash");
    },
  );

  it("rejeita IDs duplicados depois da normalização", async () => {
    mocks.listarClientes.mockResolvedValue([
      { id: "cliente-1", nome: "Um", sku: 10 },
      { id: " cliente-1 ", nome: "Dois", sku: 11 },
    ]);
    const { sincronizarClientesResumidos } =
      await carregarSincronizador();

    await expect(sincronizarClientesResumidos()).rejects.toThrow(
      "ID de cliente duplicado",
    );

    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.falharSyncRun).toHaveBeenCalledOnce();
  });

  it.each([
    {
      descricao: "ID vazio",
      cliente: { id: "   ", nome: "Cliente", sku: 10 },
      erro: "sem ID válido",
    },
    {
      descricao: "nome vazio",
      cliente: { id: "cliente-1", nome: "   ", sku: 10 },
      erro: "sem nome válido",
    },
    {
      descricao: "SKU não inteiro",
      cliente: { id: "cliente-1", nome: "Cliente", sku: 10.5 },
      erro: "SKU inválido",
    },
  ])(
    "rejeita $descricao antes das escritas",
    async ({ cliente, erro }) => {
      mocks.listarClientes.mockResolvedValue([cliente]);
      const { sincronizarClientesResumidos } =
        await carregarSincronizador();

      await expect(sincronizarClientesResumidos()).rejects.toThrow(
        erro,
      );

      expect(mocks.findMany).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.falharSyncRun).toHaveBeenCalledOnce();
    },
  );

  it("rejeita SKUs duplicados na resposta", async () => {
    mocks.listarClientes.mockResolvedValue([
      { id: "cliente-1", nome: "Um", sku: 10 },
      { id: "cliente-2", nome: "Dois", sku: 10 },
    ]);
    const { sincronizarClientesResumidos } =
      await carregarSincronizador();

    await expect(sincronizarClientesResumidos()).rejects.toThrow(
      "SKU de cliente duplicado",
    );

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.falharSyncRun).toHaveBeenCalledOnce();
  });

  it("rejeita SKU pertencente a outro cliente local", async () => {
    mocks.findMany.mockResolvedValue([
      {
        arbrainId: "proprietario-do-sku",
        nomeFantasia: "Proprietário",
        sku: 10,
      },
      {
        arbrainId: "cliente-atualizado",
        nomeFantasia: "Cliente Atualizado",
        sku: 20,
      },
    ]);
    mocks.listarClientes.mockResolvedValue([
      {
        id: "cliente-atualizado",
        nome: "Cliente Atualizado",
        sku: 10,
      },
    ]);
    const { sincronizarClientesResumidos } =
      await carregarSincronizador();

    await expect(sincronizarClientesResumidos()).rejects.toThrow(
      "Conflito de SKU 10",
    );

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.falharSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        totalRecords: 1,
        processedRecords: 0,
        changedRecords: 0,
        unchangedRecords: 0,
      }),
    );
  });

  it("não reutiliza em cliente novo um SKU mantido por registro antigo", async () => {
    mocks.findMany.mockResolvedValue([
      {
        arbrainId: "cliente-ausente-na-listagem",
        nomeFantasia: "Cliente Antigo",
        sku: 30,
      },
    ]);
    mocks.listarClientes.mockResolvedValue([
      { id: "cliente-novo", nome: "Cliente Novo", sku: 30 },
    ]);
    const { sincronizarClientesResumidos } =
      await carregarSincronizador();

    await expect(sincronizarClientesResumidos()).rejects.toThrow(
      "Conflito de SKU 30",
    );

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.falharSyncRun).toHaveBeenCalledOnce();
  });

  it("registra falha da API e não deixa a auditoria em RUNNING", async () => {
    mocks.listarClientes.mockRejectedValue(
      new Error("Não foi possível conectar à API ArBrain."),
    );
    const { sincronizarClientesResumidos } =
      await carregarSincronizador();

    await expect(sincronizarClientesResumidos()).rejects.toThrow(
      "Não foi possível conectar",
    );

    expect(mocks.iniciarSyncRun).toHaveBeenCalledWith({
      tenantId: "00000000-0000-0000-0000-000000000001",
      entity: "clientes_resumo",
      totalRecords: 0,
    });
    expect(
      mocks.iniciarSyncRun.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.listarClientes.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.falharSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        totalRecords: 0,
        processedRecords: 0,
        changedRecords: 0,
        unchangedRecords: 0,
      }),
    );
    expect(mocks.concluirSyncRun).not.toHaveBeenCalled();
  });

  it("registra total e progresso quando um lote posterior falha", async () => {
    const clientes = Array.from({ length: 101 }, (_, indice) => ({
      id: `cliente-${indice}`,
      nome: `Cliente ${indice}`,
      sku: indice + 1,
    }));
    mocks.listarClientes.mockResolvedValue(clientes);
    mocks.transaction
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Falha controlada no lote"));
    const { sincronizarClientesResumidos } =
      await carregarSincronizador();

    await expect(sincronizarClientesResumidos()).rejects.toThrow(
      "Falha controlada no lote",
    );

    expect(mocks.falharSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        totalRecords: 101,
        processedRecords: 100,
        changedRecords: 100,
        unchangedRecords: 0,
      }),
    );
    expect(mocks.concluirSyncRun).not.toHaveBeenCalled();
  });
});
