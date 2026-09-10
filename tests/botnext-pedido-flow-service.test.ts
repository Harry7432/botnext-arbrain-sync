import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DependenciasFluxoPedido,
} from "../src/integrations/botnext/botnext-pedido-flow-service.js";

const mocks = vi.hoisted(() => ({
  messageFindFirst: vi.fn(),
  rascunhoFindFirst: vi.fn(),
}));

vi.mock("../src/database/prisma.js", () => ({
  prisma: {
    botnextConversationMessage: { findFirst: mocks.messageFindFirst },
    botnextPedidoRascunho: { findFirst: mocks.rascunhoFindFirst },
  },
}));

import {
  criarServicoFluxoPedido,
  processarFluxoPedidoBotnext,
} from "../src/integrations/botnext/botnext-pedido-flow-service.js";
import {
  MENSAGEM_AGUARDANDO_CLAREZA,
  MENSAGEM_PEDIDO_CANCELADO,
  MENSAGEM_RECEBENDO_PEDIDO,
} from "../src/integrations/botnext/botnext-mensagens-pedido.js";

const TENANT = "tenant-1";
const EVENTO = "evento-1";
const CONV = "conv-1";
const MSG_ID = "msg-1";
const RASCUNHO_ID = "rasc-1";
const EXTRACAO_ID = "extr-1";

function mensagem(over: Record<string, unknown> = {}) {
  return {
    id: MSG_ID,
    conversationId: CONV,
    role: "CUSTOMER",
    text: "quero 2 pilsen hoffnung",
    detectedIntent: "FAZER_PEDIDO",
    eventDate: null,
    createdAt: new Date("2026-03-01T10:00:00.000Z"),
    conversation: { status: "ACTIVE" },
    ...over,
  };
}

function rascunho(over: Record<string, unknown> = {}) {
  return {
    id: RASCUNHO_ID,
    extracaoId: EXTRACAO_ID,
    status: "PRONTO",
    revision: 3,
    itens: {
      versao: "rascunho-v1",
      itens: [
        {
          quantidade: 2,
          problemas: [],
          resolucao: { status: "OK", nome: "Pilsen Hoffnung" },
          produtoMencionado: "pilsen hoffnung",
        },
      ],
      sinaisExtracao: [],
    },
    updatedAt: new Date("2026-03-01T09:59:00.000Z"),
    ...over,
  };
}

function extracaoOk(over: Record<string, unknown> = {}) {
  return {
    situacao: "EXTRAIDA",
    eventoId: EVENTO,
    mensagemId: MSG_ID,
    conversaId: CONV,
    extracaoId: EXTRACAO_ID,
    resultado: {
      status: "EXTRAIDO",
      itens: [{ quantidade: 2, produtoMencionado: "pilsen hoffnung" }],
    },
    ...over,
  };
}

function construcaoPronto(over: Record<string, unknown> = {}) {
  return {
    situacao: "RASCUNHO_CRIADO",
    extracaoId: EXTRACAO_ID,
    rascunhoId: RASCUNHO_ID,
    status: "PRONTO",
    conteudo: {
      versao: "rascunho-v1",
      itens: [
        {
          quantidade: 2,
          problemas: [],
          resolucao: { status: "OK", nome: "Pilsen Hoffnung" },
          produtoMencionado: null,
        },
      ],
      sinaisExtracao: [],
    },
    totalItens: 1,
    itensResolvidos: 1,
    itensNaoResolvidos: 0,
    observacoes: null,
    ...over,
  };
}

function construirDeps(over: Partial<DependenciasFluxoPedido> = {}) {
  const fakes = {
    extrair: vi.fn().mockResolvedValue(extracaoOk()),
    construir: vi.fn().mockResolvedValue(construcaoPronto()),
    confirmar: vi.fn().mockResolvedValue({ situacao: "CONFIRMADO" as const }),
    cancelar: vi.fn().mockResolvedValue({ situacao: "CANCELADO" as const }),
    despachar: vi.fn().mockResolvedValue({ situacao: "ENVIADO" as const }),
    enviar: vi.fn().mockResolvedValue({ situacao: "ENVIADA" as const }),
    alterarEstado: vi.fn().mockResolvedValue({ ok: true }),
  };

  const deps: DependenciasFluxoPedido = {
    servicoExtracao: fakes.extrair as any,
    catalogo: {} as any,
    servicoConstrucao: fakes.construir as any,
    servicoConfirmacao: fakes.confirmar as any,
    servicoCancelamento: fakes.cancelar as any,
    servicoDispatch: fakes.despachar as any,
    servicoEnvioResposta: fakes.enviar as any,
    alterarEstadoConversa: fakes.alterarEstado as any,
    ...over,
  };

  return { fakes, deps };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.messageFindFirst.mockResolvedValue(mensagem());
  mocks.rascunhoFindFirst.mockResolvedValue(null);
});

describe("criarServicoFluxoPedido (Etapa 3.2)", () => {
  it("novo FAZER_PEDIDO → extração sem bypass + construção PRONTO + resumo + WAITING_CONFIRMATION", async () => {
    const { fakes, deps } = construirDeps();
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(fakes.extrair).toHaveBeenCalledWith({
      tenantId: TENANT,
      eventoId: EVENTO,
      permitirSemIntencaoDePedido: false,
    });
    expect(fakes.construir).toHaveBeenCalledWith({
      tenantId: TENANT,
      extracaoId: EXTRACAO_ID,
    });
    expect(fakes.enviar).toHaveBeenCalledWith(
      expect.objectContaining({
        texto: "• 2x Pilsen Hoffnung",
      }),
    );
    expect(fakes.alterarEstado).toHaveBeenCalledWith({
      conversaId: CONV,
      novoStatus: "WAITING_CONFIRMATION",
    });
    expect(fakes.despachar).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      situacao: "RASCUNHO_CRIADO",
      status: "PRONTO",
      mensagemEnviada: true,
    });
  });

  it("construtora reutilizada → RASCUNHO_ATUALIZADO + WAITING_CUSTOMER quando PENDENTE", async () => {
    const { fakes, deps } = construirDeps({
      servicoConstrucao: vi.fn().mockResolvedValue(
        construcaoPronto({
          situacao: "RASCUNHO_ATUALIZADO",
          status: "PENDENTE",
          conteudo: {
            versao: "rascunho-v1",
            itens: [
              {
                quantidade: null,
                problemas: ["QUANTIDADE_AUSENTE"],
                resolucao: { status: "OK", nome: "Pilsen Hoffnung" },
                produtoMencionado: null,
              },
            ],
            sinaisExtracao: [],
          },
        }),
      ),
    });
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(fakes.enviar).toHaveBeenCalledWith(
      expect.objectContaining({
        texto: "Quantas unidades você deseja de Pilsen Hoffnung?",
      }),
    );
    expect(fakes.alterarEstado).toHaveBeenCalledWith({
      conversaId: CONV,
      novoStatus: "WAITING_CUSTOMER",
    });
    expect(r).toMatchObject({ situacao: "RASCUNHO_ATUALIZADO", status: "PENDENTE" });
  });

  it("confirmação válida → CONFIRMADO + dispatch ENVIADO + conversa COMPLETED", async () => {
    mocks.messageFindFirst.mockResolvedValue(
      mensagem({
        text: "sim",
        conversation: { status: "WAITING_CONFIRMATION" },
      }),
    );
    mocks.rascunhoFindFirst.mockResolvedValue(rascunho());
    const { fakes, deps } = construirDeps();
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(fakes.extrair).not.toHaveBeenCalled();
    expect(fakes.confirmar).toHaveBeenCalledWith({
      tenantId: TENANT,
      rascunhoId: RASCUNHO_ID,
    });
    expect(fakes.despachar).toHaveBeenCalledWith({
      tenantId: TENANT,
      rascunhoId: RASCUNHO_ID,
    });
    expect(fakes.alterarEstado).toHaveBeenCalledWith({
      conversaId: CONV,
      novoStatus: "COMPLETED",
    });
    expect(r).toMatchObject({
      situacao: "CONFIRMADO",
      conversaStatus: "COMPLETED",
      dispatch: { situacao: "ENVIADO" },
    });
  });

  it("confirmação já despachada → COMPLETED, sem novo dispatch global", async () => {
    mocks.messageFindFirst.mockResolvedValue(
      mensagem({ text: "sim", conversation: { status: "WAITING_CONFIRMATION" } }),
    );
    mocks.rascunhoFindFirst.mockResolvedValue(rascunho());
    const despachar = vi
      .fn()
      .mockResolvedValue({ situacao: "JA_DESPACHADO" as const });
    const { fakes, deps } = construirDeps({
      servicoConfirmacao: vi.fn().mockResolvedValue({ situacao: "JA_CONFIRMADO" as const }),
      servicoDispatch: despachar,
    });
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(despachar).toHaveBeenCalledTimes(1);
    expect(fakes.alterarEstado).toHaveBeenCalledWith({
      conversaId: CONV,
      novoStatus: "COMPLETED",
    });
    expect(r).toMatchObject({
      situacao: "CONFIRMADO",
      conversaStatus: "COMPLETED",
    });
  });

  it("dispatch não-ENVIADO → reconhece com MENSAGEM_RECEBENDO_PEDIDO + ACTIVE", async () => {
    mocks.messageFindFirst.mockResolvedValue(
      mensagem({ text: "sim", conversation: { status: "WAITING_CONFIRMATION" } }),
    );
    mocks.rascunhoFindFirst.mockResolvedValue(rascunho());
    const { fakes, deps } = construirDeps({
      servicoDispatch: vi
        .fn()
        .mockResolvedValue({ situacao: "FALHA_TRANSITORIA", rascunhoId: RASCUNHO_ID, motivo: "5xx" }),
    });
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(fakes.enviar).toHaveBeenCalledWith(
      expect.objectContaining({ texto: MENSAGEM_RECEBENDO_PEDIDO }),
    );
    expect(fakes.alterarEstado).toHaveBeenCalledWith({
      conversaId: CONV,
      novoStatus: "ACTIVE",
    });
    expect(r).toMatchObject({
      situacao: "CONFIRMADO",
      conversaStatus: "ACTIVE",
    });
  });

  it("sim sem rascunho em conversa em fluxo → re-extração multi-turn (bypass quando não-FAZER_PEDIDO)", async () => {
    mocks.messageFindFirst.mockResolvedValue(
      mensagem({ text: "vai sim", detectedIntent: "DUVIDA", conversation: { status: "WAITING_CUSTOMER" } }),
    );
    mocks.rascunhoFindFirst.mockResolvedValue(null);
    const { fakes, deps } = construirDeps();
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(fakes.extrair).toHaveBeenCalledWith({
      tenantId: TENANT,
      eventoId: EVENTO,
      permitirSemIntencaoDePedido: true,
    });
    expect(r).toMatchObject({ situacao: "RASCUNHO_CRIADO" });
  });

  it("sim com rascunho PENDENTE → não confirma, re-extrai e pergunta", async () => {
    mocks.messageFindFirst.mockResolvedValue(
      mensagem({ text: "sim", conversation: { status: "WAITING_CUSTOMER" } }),
    );
    mocks.rascunhoFindFirst.mockResolvedValue(
      rascunho({
        status: "PENDENTE",
        itens: {
          versao: "rascunho-v1",
          itens: [
            {
              quantidade: null,
              problemas: ["QUANTIDADE_AUSENTE"],
              resolucao: { status: "OK", nome: "Pilsen Hoffnung" },
              produtoMencionado: null,
            },
          ],
          sinaisExtracao: [],
        },
      }),
    );
    const { fakes, deps } = construirDeps();
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(fakes.confirmar).not.toHaveBeenCalled();
    expect(fakes.extrair).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ situacao: "RASCUNHO_CRIADO" });
  });

  it("cancelamento → CANCELADO + 'Pedido cancelado.' + conversa CANCELLED, sem dispatch", async () => {
    mocks.messageFindFirst.mockResolvedValue(mensagem({ text: "não quero" }));
    mocks.rascunhoFindFirst.mockResolvedValue(rascunho());
    const { fakes, deps } = construirDeps();
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(fakes.cancelar).toHaveBeenCalledWith({
      tenantId: TENANT,
      rascunhoId: RASCUNHO_ID,
    });
    expect(fakes.enviar).toHaveBeenCalledWith(
      expect.objectContaining({ texto: MENSAGEM_PEDIDO_CANCELADO }),
    );
    expect(fakes.alterarEstado).toHaveBeenCalledWith({
      conversaId: CONV,
      novoStatus: "CANCELLED",
    });
    expect(fakes.despachar).not.toHaveBeenCalled();
    expect(fakes.extrair).not.toHaveBeenCalled();
    expect(r).toEqual({ situacao: "CANCELADO", rascunhoId: RASCUNHO_ID });
  });

  it("cancelamento não-cancelável (corrida com outro worker) → SEM_PEDIDO / NAO_CANCELAVEL", async () => {
    mocks.messageFindFirst.mockResolvedValue(mensagem({ text: "não quero" }));
    mocks.rascunhoFindFirst.mockResolvedValue(rascunho());
    const { fakes, deps } = construirDeps({
      servicoCancelamento: vi
        .fn()
        .mockResolvedValue({ situacao: "NAO_CANCELAVEL", rascunhoId: RASCUNHO_ID, status: "CONFIRMADO", motivo: "JA_CONFIRMADO" }),
    });
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(fakes.enviar).not.toHaveBeenCalled();
    expect(fakes.extrair).not.toHaveBeenCalled();
    expect(r).toMatchObject({ situacao: "SEM_PEDIDO", motivo: "NAO_CANCELAVEL" });
  });

  it("ambiguidade → AMBIGUO + MENSAGEM_AGUARDANDO_CLAREZA, nada mais", async () => {
    mocks.messageFindFirst.mockResolvedValue(mensagem({ text: "sim, não quero" }));
    mocks.rascunhoFindFirst.mockResolvedValue(rascunho());
    const { fakes, deps } = construirDeps();
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(fakes.cancelar).not.toHaveBeenCalled();
    expect(fakes.confirmar).not.toHaveBeenCalled();
    expect(fakes.extrair).not.toHaveBeenCalled();
    expect(fakes.enviar).toHaveBeenCalledWith(
      expect.objectContaining({ texto: MENSAGEM_AGUARDANDO_CLAREZA }),
    );
    expect(r).toEqual({ situacao: "AMBIGUO", mensagemEnviada: true });
  });

  it("reabertura FAZER_PEDIDO em conversa COMPLETED → ACTIVE antes do fluxo", async () => {
    mocks.messageFindFirst.mockResolvedValue(
      mensagem({ conversation: { status: "COMPLETED" } }),
    );
    mocks.rascunhoFindFirst.mockResolvedValue(null);
    const { fakes, deps } = construirDeps();
    const fluxo = criarServicoFluxoPedido(deps);

    await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(fakes.alterarEstado).toHaveBeenNthCalledWith(1, {
      conversaId: CONV,
      novoStatus: "ACTIVE",
    });
    expect(fakes.alterarEstado).toHaveBeenNthCalledWith(2, {
      conversaId: CONV,
      novoStatus: "WAITING_CONFIRMATION",
    });
  });

  it("reabertura FAZER_PEDIDO em conversa CANCELLED → ACTIVE", async () => {
    mocks.messageFindFirst.mockResolvedValue(
      mensagem({ conversation: { status: "CANCELLED" } }),
    );
    mocks.rascunhoFindFirst.mockResolvedValue(null);
    const { fakes, deps } = construirDeps();
    const fluxo = criarServicoFluxoPedido(deps);

    await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(fakes.alterarEstado).toHaveBeenCalledWith({
      conversaId: CONV,
      novoStatus: "ACTIVE",
    });
  });

  it("outra intenção sem fluxo → SEM_PEDIDO / OUTRA_INTENCAO, nada externo", async () => {
    mocks.messageFindFirst.mockResolvedValue(
      mensagem({ text: "qual o preço?", detectedIntent: "DUVIDA" }),
    );
    mocks.rascunhoFindFirst.mockResolvedValue(null);
    const { fakes, deps } = construirDeps();
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(fakes.extrair).not.toHaveBeenCalled();
    expect(fakes.enviar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ situacao: "SEM_PEDIDO", motivo: "OUTRA_INTENCAO" });
  });

  it("mensagem não-cliente → SEM_PEDIDO / MENSAGEM_NAO_CLIENTE", async () => {
    mocks.messageFindFirst.mockResolvedValue(mensagem({ role: "ASSISTANT" }));
    const { fakes, deps } = construirDeps();
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(r).toMatchObject({ situacao: "SEM_PEDIDO", motivo: "MENSAGEM_NAO_CLIENTE" });
  });

  it("extração IGNORADA → SEM_PEDIDO / EXTRACAO_<motivo>", async () => {
    const { deps } = construirDeps({
      servicoExtracao: vi.fn().mockResolvedValue({
        situacao: "IGNORADA",
        eventoId: EVENTO,
        mensagemId: MSG_ID,
        conversaId: CONV,
        motivo: "INTENCAO_NAO_E_PEDIDO",
      }),
    });
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(r).toMatchObject({
      situacao: "SEM_PEDIDO",
      motivo: "EXTRACAO_INTENCAO_NAO_E_PEDIDO",
    });
  });

  it("extração sem itens → SEM_PEDIDO / EXTRACAO_<status>", async () => {
    const { deps } = construirDeps({
      servicoExtracao: vi.fn().mockResolvedValue(
        extracaoOk({ resultado: { status: "EXTRAIDO", itens: [] } }),
      ),
    });
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(r).toMatchObject({ situacao: "SEM_PEDIDO", motivo: "EXTRACAO_EXTRAIDO" });
  });

  it("construção sem rascunho → SEM_PEDIDO / CONSTRUCAO_SEM_RASCUNHO", async () => {
    const { deps } = construirDeps({
      servicoConstrucao: vi.fn().mockResolvedValue({
        situacao: "SEM_RASCUNHO",
        extracaoId: EXTRACAO_ID,
        statusExtracao: "IGNORADA",
        motivo: "x",
      }),
    });
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(r).toMatchObject({
      situacao: "SEM_PEDIDO",
      motivo: "CONSTRUCAO_SEM_RASCUNHO_IGNORADA",
    });
  });

  it("tenant isolado: mensagem de outro tenant → erro", async () => {
    mocks.messageFindFirst.mockResolvedValue(null);
    const { fakes, deps } = construirDeps();
    const fluxo = criarServicoFluxoPedido(deps);

    await expect(
      fluxo({ tenantId: "outro-tenant", eventoId: EVENTO }),
    ).rejects.toThrow(/não encontrada no tenant/i);
    expect(fakes.extrair).not.toHaveBeenCalled();
  });

  it("confirmação NAO_CONFIRMAVEL com pendência → re-pergunta (AGUARDANDO_INFORMACAO)", async () => {
    mocks.messageFindFirst.mockResolvedValue(
      mensagem({ text: "sim", conversation: { status: "WAITING_CONFIRMATION" } }),
    );
    mocks.rascunhoFindFirst.mockResolvedValue(
      rascunho({
        status: "PRONTO",
        itens: {
          versao: "rascunho-v1",
          itens: [
            {
              quantidade: 2,
              problemas: ["PRODUTO_AUSENTE"],
              resolucao: null,
              produtoMencionado: null,
            },
          ],
          sinaisExtracao: [],
        },
      }),
    );
    const { deps } = construirDeps({
      servicoConfirmacao: vi.fn().mockResolvedValue({ situacao: "NAO_CONFIRMAVEL" as const }),
    });
    const fluxo = criarServicoFluxoPedido(deps);

    const r = await fluxo({ tenantId: TENANT, eventoId: EVENTO });

    expect(r).toMatchObject({ situacao: "AGUARDANDO_INFORMACAO" });
  });
});

describe("processarFluxoPedidoBotnext — wiring de produção", () => {
  it("IA desativada → SEM_PEDIDO / IA_DESATIVADA sem tocar em nada", async () => {
    vi.stubEnv("BOTNEXT_AI_ENABLED", "false");
    const r = await processarFluxoPedidoBotnext({ tenantId: TENANT, eventoId: EVENTO });

    expect(r).toEqual({ situacao: "SEM_PEDIDO", motivo: "IA_DESATIVADA" });
    expect(mocks.messageFindFirst).not.toHaveBeenCalled();
  });
});