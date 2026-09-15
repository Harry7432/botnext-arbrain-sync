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
  processarRespostaDeterministica: vi.fn(),
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
  processarRespostaDeterministicaPedidoBotnext:
    mocks.processarRespostaDeterministica,
  processarFluxoPedidoBotnext: mocks.processarFluxoPedido,
}));

describe("processor BotNext com fencing", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("BOTNEXT_TEST_MODE", "false");

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
    mocks.processarRespostaDeterministica.mockResolvedValue({
      situacao: "NAO_APLICAVEL",
    });
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

  it("resposta determinística é processada antes da IA e encerra o fluxo geral", async () => {
    mocks.processarRespostaDeterministica.mockResolvedValue({
      situacao: "PROCESSADA",
      resultado: { situacao: "CANCELADO", rascunhoId: "rascunho-1" },
    });
    const { processarEventoBotnext } =
      await import("../src/integrations/botnext/botnext-webhook-processor.js");

    const resultado = await processarEventoBotnext("evento-1", "token-atual");

    expect(mocks.processarRespostaDeterministica).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      eventoId: "evento-1",
    });
    expect(mocks.classificar).not.toHaveBeenCalled();
    expect(mocks.rotear).not.toHaveBeenCalled();
    expect(mocks.processarFluxoPedido).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ status: "PROCESSED", obsoleto: false });
  });

  it("handoff encerra automação após o roteamento sem executar fluxo de pedido", async () => {
    mocks.classificar.mockResolvedValue({ situacao: "CLASSIFICADA" });
    mocks.rotear.mockResolvedValue({
      situacao: "ROTEADA",
      mensagemId: "mensagem-1",
      conversaId: "conversa-1",
      decisao: {
        acao: "ENCAMINHAR_ATENDIMENTO_HUMANO",
        statusSugerido: "HUMAN_HANDOFF",
        motivo: "CLASSIFICACAO_EXIGE_ATENDIMENTO_HUMANO",
      },
      versao: "v1",
      roteadaEm: new Date(),
      statusAnterior: "ACTIVE",
      statusAtual: "HUMAN_HANDOFF",
      conversaAtualizada: true,
    });
    const { processarEventoBotnext } =
      await import("../src/integrations/botnext/botnext-webhook-processor.js");

    const resultado = await processarEventoBotnext("evento-1", "token-atual");

    expect(mocks.rotear).toHaveBeenCalledOnce();
    expect(mocks.processarFluxoPedido).not.toHaveBeenCalled();
    expect(mocks.finalizarProcessado).toHaveBeenCalledOnce();
    expect(resultado).toMatchObject({ status: "PROCESSED", obsoleto: false });
  });

  it("conversa já em handoff termina antes de IA, pré-handler e fluxo", async () => {
    mocks.registrarMensagem.mockResolvedValue({
      conversaId: "conversa-1",
      status: "HUMAN_HANDOFF",
      mensagemCriada: true,
    });
    const { processarEventoBotnext } =
      await import("../src/integrations/botnext/botnext-webhook-processor.js");

    const resultado = await processarEventoBotnext("evento-1", "token-atual");

    expect(mocks.processarRespostaDeterministica).not.toHaveBeenCalled();
    expect(mocks.classificar).not.toHaveBeenCalled();
    expect(mocks.rotear).not.toHaveBeenCalled();
    expect(mocks.processarFluxoPedido).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({
      status: "PROCESSED",
      motivo: "CONVERSA_EM_ATENDIMENTO_HUMANO",
    });
  });

  it("evento antigo fora do escopo termina IGNORED sem IA ou fluxo de pedido", async () => {
    vi.stubEnv("BOTNEXT_TEST_MODE", "true");
    vi.stubEnv("BOTNEXT_TEST_TO", "5511988880001");
    mocks.eventoFindUnique.mockResolvedValue({
      id: "evento-1",
      tenantId: "tenant-1",
      senderPhone: "5511988880002",
    });
    const { processarEventoBotnext } =
      await import("../src/integrations/botnext/botnext-webhook-processor.js");

    const resultado = await processarEventoBotnext("evento-1", "token-atual");

    expect(resultado).toMatchObject({
      processado: true,
      obsoleto: false,
      status: "IGNORED",
      motivo: "FORA_DO_ESCOPO_DE_TESTE",
    });
    expect(mocks.finalizarIgnorado).toHaveBeenCalledWith({
      eventoId: "evento-1",
      processingToken: "token-atual",
      motivo: "FORA_DO_ESCOPO_DE_TESTE",
    });
    expect(mocks.clienteFindMany).not.toHaveBeenCalled();
    expect(mocks.registrarMensagem).not.toHaveBeenCalled();
    expect(mocks.processarRespostaDeterministica).not.toHaveBeenCalled();
    expect(mocks.classificar).not.toHaveBeenCalled();
    expect(mocks.rotear).not.toHaveBeenCalled();
    expect(mocks.processarFluxoPedido).not.toHaveBeenCalled();
    expect(mocks.finalizarProcessado).not.toHaveBeenCalled();
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
