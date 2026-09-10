import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rascunhoFindFirst: vi.fn(),
  rascunhoUpdateMany: vi.fn(),
  clienteFindFirst: vi.fn(),
}));

vi.mock("../src/database/prisma.js", () => ({
  prisma: {
    botnextPedidoRascunho: {
      findFirst: mocks.rascunhoFindFirst,
      updateMany: mocks.rascunhoUpdateMany,
    },
    cliente: { findFirst: mocks.clienteFindFirst },
  },
}));

import {
  criarServicoEnvioResposta,
  enviarTextoBotNextComFetch,
  envioRespostaBotnextHabilitado,
} from "../src/integrations/botnext/botnext-message-sender.js";

const TENANT = "tenant-1";
const RASCUNHO_ID = "rascunho-1";
const EVENTO_ID = "evento-1";

function conteudoRascunho(over: Record<string, unknown> = {}) {
  return {
    versao: "rascunho-v1",
    itens: [
      { quantidade: 2, problemas: [], resolucao: { status: "OK", nome: "Pilsen" } },
    ],
    sinaisExtracao: [],
    ...over,
  };
}

function linhaRascunho(over: { itens?: Record<string, unknown>; revision?: number; clienteId?: string | null } = {}) {
  return {
    id: RASCUNHO_ID,
    revision: over.revision ?? 3,
    itens: over.itens ?? conteudoRascunho(),
    extracao: {
      conversation: { clienteId: over.clienteId === undefined ? "cliente-1" : over.clienteId },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.rascunhoFindFirst.mockResolvedValue(linhaRascunho());
  mocks.rascunhoUpdateMany.mockResolvedValue({ count: 1 });
  mocks.clienteFindFirst.mockResolvedValue({ celular: "+55 11 99999-0000", telefone: null });
});

describe("envioRespostaBotnextHabilitado — gate permissivo", () => {
  it("false/vazio/ausente → false", () => {
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "false");
    expect(envioRespostaBotnextHabilitado()).toBe(false);
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "");
    expect(envioRespostaBotnextHabilitado()).toBe(false);
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "");
  });

  it("true → true; valor inválido lança", () => {
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "true");
    expect(envioRespostaBotnextHabilitado()).toBe(true);
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "talvez");
    expect(() => envioRespostaBotnextHabilitado()).toThrow();
  });
});

describe("criarServicoEnvioResposta", () => {
  it("flag desativada → DESATIVADO, zero HTTP e zero escrita", async () => {
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "false");
    const enviarTexto = vi.fn();
    const servico = criarServicoEnvioResposta({ enviarTexto });

    const r = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID, eventoId: EVENTO_ID, texto: "ok" });

    expect(r).toEqual({ situacao: "DESATIVADO" });
    expect(enviarTexto).not.toHaveBeenCalled();
    expect(mocks.rascunhoUpdateMany).not.toHaveBeenCalled();
  });

  it("rascunho inexistente → SEM_ROTA / SEM_RASCUNHO", async () => {
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "true");
    mocks.rascunhoFindFirst.mockResolvedValue(null);
    const enviarTexto = vi.fn();
    const servico = criarServicoEnvioResposta({ enviarTexto });

    const r = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID, eventoId: EVENTO_ID, texto: "ok" });

    expect(r).toEqual({ situacao: "SEM_ROTA", motivo: "SEM_RASCUNHO" });
    expect(enviarTexto).not.toHaveBeenCalled();
  });

  it("evento já respondido → JA_ENVIADA, sem novo HTTP", async () => {
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "true");
    mocks.rascunhoFindFirst.mockResolvedValue(
      linhaRascunho({
        itens: conteudoRascunho({
          respostas: { [EVENTO_ID]: { texto: "já enviado", enviadaEm: "2026-01-01T00:00:00.000Z" } },
        }),
      }),
    );
    const enviarTexto = vi.fn();
    const servico = criarServicoEnvioResposta({ enviarTexto });

    const r = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID, eventoId: EVENTO_ID, texto: "ok" });

    expect(r).toEqual({ situacao: "JA_ENVIADA" });
    expect(enviarTexto).not.toHaveBeenCalled();
  });

  it("sem BOTNEXT_FROM → SEM_ROTA / SEM_FROM", async () => {
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "true");
    vi.stubEnv("BOTNEXT_FROM", " ");
    const enviarTexto = vi.fn();
    const servico = criarServicoEnvioResposta({ enviarTexto });

    const r = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID, eventoId: EVENTO_ID, texto: "ok" });

    expect(r).toEqual({ situacao: "SEM_ROTA", motivo: "SEM_FROM" });
    expect(enviarTexto).not.toHaveBeenCalled();
  });

  it("cliente sem telefone no rascunho → SEM_ROTA / SEM_CLIENTE", async () => {
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "true");
    vi.stubEnv("BOTNEXT_FROM", "5511999999999");
    mocks.rascunhoFindFirst.mockResolvedValue(
      linhaRascunho({ clienteId: null }),
    );
    const servico = criarServicoEnvioResposta({ enviarTexto: vi.fn() });

    const r = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID, eventoId: EVENTO_ID, texto: "ok" });

    expect(r).toEqual({ situacao: "SEM_ROTA", motivo: "SEM_CLIENTE" });
  });

  it("cliente sem telefone cadastrado → SEM_ROTA / SEM_TELEFONE", async () => {
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "true");
    vi.stubEnv("BOTNEXT_FROM", "5511999999999");
    mocks.clienteFindFirst.mockResolvedValue({ celular: null, telefone: "" });
    const servico = criarServicoEnvioResposta({ enviarTexto: vi.fn() });

    const r = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID, eventoId: EVENTO_ID, texto: "ok" });

    expect(r).toEqual({ situacao: "SEM_ROTA", motivo: "SEM_TELEFONE" });
  });

  it("2xx → ENVIADA, persiste marcador com eventoId e texto", async () => {
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "true");
    vi.stubEnv("BOTNEXT_FROM", "5511999999999");
    const agora = vi.fn(() => new Date("2026-02-01T10:00:00.000Z"));
    const enviarTexto = vi.fn().mockResolvedValue({ tipo: "RESPOSTA", status: 200 });
    const servico = criarServicoEnvioResposta({ enviarTexto, agora });

    const r = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID, eventoId: EVENTO_ID, texto: "Resumo" });

    expect(r).toEqual({ situacao: "ENVIADA" });
    expect(enviarTexto).toHaveBeenCalledWith({
      from: "5511999999999",
      to: "5511999990000",
      body: { text: "Resumo" },
      options: { forceStartSession: false },
    });
    expect(mocks.rascunhoUpdateMany).toHaveBeenCalledTimes(1);
    const data = mocks.rascunhoUpdateMany.mock.calls[0]?.[0]?.data;
    expect(data?.itens).toEqual(
      expect.objectContaining({
        respostas: {
          [EVENTO_ID]: { texto: "Resumo", enviadaEm: "2026-02-01T10:00:00.000Z" },
        },
      }),
    );
  });

  it("timeout → ENVIO_INCERTO, sem marcador persistido e sem retry automático", async () => {
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "true");
    vi.stubEnv("BOTNEXT_FROM", "5511999999999");
    const agora = vi.fn(() => new Date("2026-02-01T10:00:00.000Z"));
    const enviarTexto = vi.fn().mockResolvedValue({ tipo: "TEMPO_ESGOTADO" });
    const servico = criarServicoEnvioResposta({ enviarTexto, agora });

    const r = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID, eventoId: EVENTO_ID, texto: "Resumo" });

    expect(r).toMatchObject({
      situacao: "ENVIO_INCERTO",
      motivo: expect.stringContaining("não sabemos se o BotNext recebeu"),
    });
    // Nenhum marcador foi persistido: um reprocessamento poderá tentar de novo.
    expect(mocks.rascunhoUpdateMany).not.toHaveBeenCalled();
    // Exatamente 1 chamada HTTP — nenhuma segunda mensagem é disparada.
    expect(enviarTexto).toHaveBeenCalledTimes(1);
  });

  it("4xx → FALHA_ENVIO não transitoria, sem marcador", async () => {
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "true");
    vi.stubEnv("BOTNEXT_FROM", "5511999999999");
    const enviarTexto = vi.fn().mockResolvedValue({ tipo: "RESPOSTA", status: 400 });
    const servico = criarServicoEnvioResposta({ enviarTexto });

    const r = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID, eventoId: EVENTO_ID, texto: "Resumo" });

    expect(r).toMatchObject({ situacao: "FALHA_ENVIO", transitoria: false });
    expect(mocks.rascunhoUpdateMany).not.toHaveBeenCalled();
  });

  it("5xx e falha de rede → FALHA_ENVIO transitoria, sem marcador", async () => {
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "true");
    vi.stubEnv("BOTNEXT_FROM", "5511999999999");
    const enviarTexto = vi
      .fn()
      .mockResolvedValueOnce({ tipo: "RESPOSTA", status: 500 })
      .mockResolvedValueOnce({ tipo: "FALHA_REDE", motivo: "ECONNREFUSED" });
    const servico = criarServicoEnvioResposta({ enviarTexto });

    const r1 = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID, eventoId: EVENTO_ID, texto: "Resumo" });
    expect(r1).toMatchObject({ situacao: "FALHA_ENVIO", transitoria: true });

    const r2 = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID, eventoId: EVENTO_ID, texto: "Resumo" });
    expect(r2).toMatchObject({ situacao: "FALHA_ENVIO", transitoria: true });
    expect(mocks.rascunhoUpdateMany).not.toHaveBeenCalled();
  });

  it("tenant isolado: rascunho de outro tenant → SEM_RASCUNHO", async () => {
    vi.stubEnv("BOTNEXT_SEND_ENABLED", "true");
    mocks.rascunhoFindFirst.mockResolvedValue(null);
    const servico = criarServicoEnvioResposta({ enviarTexto: vi.fn() });

    const r = await servico({ tenantId: "outro-tenant", rascunhoId: RASCUNHO_ID, eventoId: EVENTO_ID, texto: "ok" });

    expect(r).toEqual({ situacao: "SEM_ROTA", motivo: "SEM_RASCUNHO" });
  });
});

describe("enviarTextoBotNextComFetch — transporte", () => {
  it("sem BOTNEXT_BASE_URL/token → FALHA_REDE, sem lançar", async () => {
    vi.stubEnv("BOTNEXT_BASE_URL", " ");
    vi.stubEnv("BOTNEXT_API_TOKEN", "");
    const r = await enviarTextoBotNextComFetch({ from: "a", to: "b", body: { text: "oi" }, options: { forceStartSession: false } });
    expect(r).toEqual({ tipo: "FALHA_REDE", motivo: expect.stringContaining("ausentes") });
  });
});