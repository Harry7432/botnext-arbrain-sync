import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  eventoFindUnique: vi.fn(),
  clienteFindMany: vi.fn(),
  finalizarProcessado: vi.fn(),
  finalizarIgnorado: vi.fn(),
  registrarFalha: vi.fn(),
  registrarMensagem: vi.fn(),
  classificar: vi.fn(),
  rotear: vi.fn(),
  processarFluxoPedido: vi.fn(),
}));

vi.mock("../src/database/prisma.js", () => ({
  prisma: {
    botnextWebhookEvent: {
      findUnique: mocks.eventoFindUnique,
    },
    cliente: {
      findMany: mocks.clienteFindMany,
    },
  },
}));
vi.mock("../src/queue/botnext-processing-lease-service.js", () => ({
  finalizarEventoBotnextProcessado: mocks.finalizarProcessado,
  finalizarEventoBotnextIgnorado: mocks.finalizarIgnorado,
  registrarFalhaEventoBotnextComPosse: mocks.registrarFalha,
}));
vi.mock("../src/integrations/botnext/botnext-conversation-service.js", () => ({
  registrarMensagemRecebidaNaConversa: mocks.registrarMensagem,
}));
vi.mock("../src/integrations/botnext/botnext-ai-service.js", () => ({
  classificarEventoBotnextSeHabilitado: mocks.classificar,
}));
vi.mock("../src/integrations/botnext/botnext-intent-routing-service.js", () => ({
  rotearEventoBotnext: mocks.rotear,
}));
vi.mock("../src/integrations/botnext/botnext-pedido-flow-service.js", () => ({
  processarFluxoPedidoBotnext: mocks.processarFluxoPedido,
}));

describe("processor BotNext com fencing", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }

    mocks.eventoFindUnique.mockResolvedValue({
      id: "evento-1",
      tenantId: "tenant-1",
      senderPhone: "5541999999999",
    });
    mocks.clienteFindMany.mockResolvedValue([{
      id: "cliente-1",
      celular: "41999999999",
      telefone: null,
    }]);
    mocks.registrarMensagem.mockResolvedValue({
      conversaId: "conversa-1",
      status: "ACTIVE",
      mensagemCriada: true,
    });
    mocks.classificar.mockResolvedValue({ situacao: "DESATIVADA" });
    mocks.rotear.mockResolvedValue({
      situacao: "ROTEADA",
      mensagemId: "mensagem-1",
      conversaId: "conversa-1",
      decisao: { acao: "ACK", statusSugerido: "ACTIVE", motivo: "rota" },
      versao: "v1",
      roteadaEm: new Date(),
      statusAnterior: "ACTIVE",
      statusAtual: "ACTIVE",
      conversaAtualizada: false,
    });
    mocks.processarFluxoPedido.mockResolvedValue({
      situacao: "SEM_PEDIDO",
      motivo: "OUTRA_INTENCAO",
    });
    mocks.finalizarProcessado.mockResolvedValue("CONCLUIDO");
    mocks.finalizarIgnorado.mockResolvedValue("CONCLUIDO");
    mocks.registrarFalha.mockResolvedValue("RECEIVED");
  });

  it("finaliza PROCESSED usando o token atual", async () => {
    const { processarEventoBotnext } =
      await import("../src/integrations/botnext/botnext-webhook-processor.js");

    const resultado = await processarEventoBotnext("evento-1", "token-atual");

    expect(mocks.finalizarProcessado).toHaveBeenCalledWith({
      eventoId: "evento-1",
      processingToken: "token-atual",
      clienteId: "cliente-1",
    });
    expect(resultado).toMatchObject({
      status: "PROCESSED",
      obsoleto: false,
    });
  });

  it("lease perdida impede PROCESSED", async () => {
    mocks.finalizarProcessado.mockResolvedValue("LEASE_LOST");
    const { processarEventoBotnext } =
      await import("../src/integrations/botnext/botnext-webhook-processor.js");

    const resultado = await processarEventoBotnext("evento-1", "token-antigo");

    expect(resultado).toMatchObject({
      obsoleto: true,
      motivo: "LEASE_LOST",
    });
    expect(mocks.registrarFalha).not.toHaveBeenCalled();
  });

  it("fluxo de pedido executado quando a IA está ativa", async () => {
    mocks.classificar.mockResolvedValue({ situacao: "CLASSIFICADA" });
    const { processarEventoBotnext } =
      await import("../src/integrations/botnext/botnext-webhook-processor.js");

    const resultado = await processarEventoBotnext("evento-1", "token-atual");

    expect(mocks.rotear).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      eventoId: "evento-1",
    });
    expect(mocks.processarFluxoPedido).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      eventoId: "evento-1",
    });
    expect(resultado).toMatchObject({
      status: "PROCESSED",
      obsoleto: false,
    });
  });

  it("fluxo de pedido não executado quando a IA está desativada", async () => {
    const { processarEventoBotnext } =
      await import("../src/integrations/botnext/botnext-webhook-processor.js");

    await processarEventoBotnext("evento-1", "token-atual");

    expect(mocks.rotear).not.toHaveBeenCalled();
    expect(mocks.processarFluxoPedido).not.toHaveBeenCalled();
  });

  it("lease perdida impede IGNORED", async () => {
    mocks.eventoFindUnique.mockResolvedValue({
      id: "evento-1",
      tenantId: "tenant-1",
      senderPhone: null,
    });
    mocks.finalizarIgnorado.mockResolvedValue("LEASE_LOST");
    const { processarEventoBotnext } =
      await import("../src/integrations/botnext/botnext-webhook-processor.js");

    const resultado = await processarEventoBotnext("evento-1", "token-antigo");

    expect(resultado.obsoleto).toBe(true);
    expect(mocks.registrarFalha).not.toHaveBeenCalled();
  });

  it("lease perdida impede registrar FAILED", async () => {
    const erro = new Error("Falha controlada");
    mocks.eventoFindUnique.mockRejectedValue(erro);
    mocks.registrarFalha.mockResolvedValue("LEASE_LOST");
    const { processarEventoBotnext } =
      await import("../src/integrations/botnext/botnext-webhook-processor.js");

    const resultado = await processarEventoBotnext("evento-1", "token-antigo");

    expect(resultado.obsoleto).toBe(true);
    expect(mocks.registrarFalha).toHaveBeenCalledWith(
      expect.objectContaining({ processingToken: "token-antigo" }),
    );
  });

  it("preserva erro original quando registrar estado também falha", async () => {
    const erroOriginal = new Error("Falha principal");
    mocks.eventoFindUnique.mockRejectedValue(erroOriginal);
    mocks.registrarFalha.mockRejectedValue(new Error("Banco indisponível"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { processarEventoBotnext } =
      await import("../src/integrations/botnext/botnext-webhook-processor.js");

    await expect(
      processarEventoBotnext("evento-1", "token-atual"),
    ).rejects.toBe(erroOriginal);
  });
});
