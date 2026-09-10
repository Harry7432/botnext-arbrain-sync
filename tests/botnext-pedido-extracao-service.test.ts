import { APIConnectionTimeoutError } from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExtracaoIaError } from "../src/pedidos/extracao/erros.js";
import type { ExtracaoPedidoGerada } from "../src/pedidos/extracao/tipos.js";

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const EVENTO_ID = "evento-1";
const MSG_ID = "10000000-0000-4000-8000-0000000000aa";
const CONV_ID = "20000000-0000-4000-8000-0000000000bb";

const mocks = vi.hoisted(() => ({
  messageFindFirst: vi.fn(),
  extracaoFindUnique: vi.fn(),
  extracaoCreate: vi.fn(),
}));

vi.mock("../src/database/prisma.js", () => ({
  prisma: {
    botnextConversationMessage: { findFirst: mocks.messageFindFirst },
    botnextPedidoExtracao: {
      findUnique: mocks.extracaoFindUnique,
      create: mocks.extracaoCreate,
    },
  },
}));

let linhaExtracao:
  | { id: string; status: string; itensExtraidos: unknown }
  | null = null;

const BRUTO_OK: ExtracaoPedidoGerada = {
  itens: [
    {
      quantidade: 3,
      produtoMencionado: "Pilsen Hoffnung",
      unidadeMencionada: "caixas",
      embalagemMencionada: null,
      observacaoItem: null,
      ehReferenciaAnterior: false,
    },
  ],
  observacaoPedido: null,
  desistenciaDetectada: false,
  correcaoDetectada: false,
  confianca: 0.95,
};

function provedorFake(extrair: (texto: string) => Promise<ExtracaoPedidoGerada>) {
  return {
    modelo: "modelo-teste",
    versaoExtractor: "extractor-teste-v1",
    versaoPrompt: "prompt-teste-v1",
    extrair,
  };
}

async function importarServico() {
  const { criarServicoExtracaoPedido } = await import(
    "../src/integrations/botnext/botnext-pedido-extracao-service.js"
  );
  return criarServicoExtracaoPedido;
}

beforeEach(() => {
  vi.clearAllMocks();
  linhaExtracao = null;

  mocks.messageFindFirst.mockResolvedValue({
    id: MSG_ID,
    conversationId: CONV_ID,
    role: "CUSTOMER",
    text: "quero 3 caixas de pilsen hoffnung",
    detectedIntent: "FAZER_PEDIDO",
  });
  mocks.extracaoFindUnique.mockImplementation(async () => linhaExtracao);
  mocks.extracaoCreate.mockImplementation(
    async ({ data }: { data: { status: string; itensExtraidos: unknown } }) => {
      linhaExtracao = {
        id: "extr-1",
        status: data.status,
        itensExtraidos: data.itensExtraidos,
      };
      return linhaExtracao;
    },
  );
});

describe("serviço de extração de pedido BotNext", () => {
  it("sucesso → EXTRAIDA, persiste status EXTRAIDO", async () => {
    const criar = await importarServico();
    const extrair = vi.fn().mockResolvedValue(BRUTO_OK);
    const servico = criar(provedorFake(extrair));

    const r = await servico({ tenantId: TENANT_A, eventoId: EVENTO_ID });

    expect(r.situacao).toBe("EXTRAIDA");
    if (r.situacao === "EXTRAIDA") {
      expect(r.resultado.status).toBe("EXTRAIDO");
      expect(r.resultado.itens[0]?.produtoMencionado).toBe("Pilsen Hoffnung");
      expect(r.mensagemId).toBe(MSG_ID);
      expect(r.conversaId).toBe(CONV_ID);
    }
    expect(mocks.extracaoCreate).toHaveBeenCalledTimes(1);
    expect(mocks.extracaoCreate.mock.calls[0]?.[0]?.data?.status).toBe("EXTRAIDO");
    expect(extrair).toHaveBeenCalledTimes(1);
  });

  it("reprocessamento idempotente (sucesso): 2ª chamada devolve persistido, IA 1×", async () => {
    const criar = await importarServico();
    const extrair = vi.fn().mockResolvedValue(BRUTO_OK);
    const servico = criar(provedorFake(extrair));

    const r1 = await servico({ tenantId: TENANT_A, eventoId: EVENTO_ID });
    const r2 = await servico({ tenantId: TENANT_A, eventoId: EVENTO_ID });

    expect(r1.situacao).toBe("EXTRAIDA");
    expect(r2.situacao).toBe("JA_EXTRAIDA");
    expect(extrair).toHaveBeenCalledTimes(1);
    expect(mocks.extracaoCreate).toHaveBeenCalledTimes(1);
  });

  it("falha DEFINITIVA da IA → FALHA_DEFINITIVA, persiste status FALHOU", async () => {
    const criar = await importarServico();
    const extrair = vi
      .fn()
      .mockRejectedValue(
        new ExtracaoIaError("DEFINITIVO", "resposta fora do schema"),
      );
    const servico = criar(provedorFake(extrair));

    const r = await servico({ tenantId: TENANT_A, eventoId: EVENTO_ID });

    expect(r.situacao).toBe("FALHA_DEFINITIVA");
    if (r.situacao === "FALHA_DEFINITIVA") {
      expect(r.resultado.status).toBe("FALHA_IA");
      expect(r.resultado.erro).toContain("schema");
    }
    expect(mocks.extracaoCreate.mock.calls[0]?.[0]?.data?.status).toBe("FALHOU");
  });

  it("reprocessar após FALHOU → devolve o FALHOU persistido, IA não re-chamada", async () => {
    const criar = await importarServico();
    const extrair = vi
      .fn()
      .mockRejectedValue(new ExtracaoIaError("DEFINITIVO", "schema ruim"));
    const servico = criar(provedorFake(extrair));

    await servico({ tenantId: TENANT_A, eventoId: EVENTO_ID });
    const r2 = await servico({ tenantId: TENANT_A, eventoId: EVENTO_ID });

    expect(r2.situacao).toBe("JA_EXTRAIDA");
    if (r2.situacao === "JA_EXTRAIDA") {
      expect(r2.resultado.status).toBe("FALHA_IA");
    }
    expect(extrair).toHaveBeenCalledTimes(1);
  });

  it("falha TRANSITÓRIA (timeout) → relança, NÃO persiste; reprocessar re-chama a IA", async () => {
    const criar = await importarServico();
    const extrair = vi
      .fn()
      .mockRejectedValueOnce(new APIConnectionTimeoutError({ message: "timeout" }))
      .mockResolvedValueOnce(BRUTO_OK);
    const servico = criar(provedorFake(extrair));

    await expect(
      servico({ tenantId: TENANT_A, eventoId: EVENTO_ID }),
    ).rejects.toBeInstanceOf(ExtracaoIaError);
    expect(mocks.extracaoCreate).not.toHaveBeenCalled();

    const r2 = await servico({ tenantId: TENANT_A, eventoId: EVENTO_ID });
    expect(r2.situacao).toBe("EXTRAIDA");
    expect(extrair).toHaveBeenCalledTimes(2);
    expect(mocks.extracaoCreate).toHaveBeenCalledTimes(1);
  });

  it("tenant isolation: mensagem de outro tenant → erro, IA não chamada", async () => {
    const criar = await importarServico();
    mocks.messageFindFirst.mockResolvedValue(null); // não achou no tenant B
    const extrair = vi.fn().mockResolvedValue(BRUTO_OK);
    const servico = criar(provedorFake(extrair));

    await expect(
      servico({ tenantId: TENANT_B, eventoId: EVENTO_ID }),
    ).rejects.toThrow(/não encontrada no tenant/i);
    expect(extrair).not.toHaveBeenCalled();
  });

  it("mensagem não é do cliente → IGNORADA / MENSAGEM_NAO_CLIENTE", async () => {
    const criar = await importarServico();
    mocks.messageFindFirst.mockResolvedValue({
      id: MSG_ID,
      conversationId: CONV_ID,
      role: "ASSISTANT",
      text: "olá",
      detectedIntent: "FAZER_PEDIDO",
    });
    const extrair = vi.fn().mockResolvedValue(BRUTO_OK);
    const servico = criar(provedorFake(extrair));

    const r = await servico({ tenantId: TENANT_A, eventoId: EVENTO_ID });
    expect(r).toMatchObject({ situacao: "IGNORADA", motivo: "MENSAGEM_NAO_CLIENTE" });
    expect(extrair).not.toHaveBeenCalled();
  });

  it("mensagem sem texto → IGNORADA / MENSAGEM_SEM_TEXTO", async () => {
    const criar = await importarServico();
    mocks.messageFindFirst.mockResolvedValue({
      id: MSG_ID,
      conversationId: CONV_ID,
      role: "CUSTOMER",
      text: "   ",
      detectedIntent: "FAZER_PEDIDO",
    });
    const servico = criar(provedorFake(vi.fn()));

    const r = await servico({ tenantId: TENANT_A, eventoId: EVENTO_ID });
    expect(r).toMatchObject({ situacao: "IGNORADA", motivo: "MENSAGEM_SEM_TEXTO" });
  });

  it("intenção não é FAZER_PEDIDO → IGNORADA / INTENCAO_NAO_E_PEDIDO", async () => {
    const criar = await importarServico();
    mocks.messageFindFirst.mockResolvedValue({
      id: MSG_ID,
      conversationId: CONV_ID,
      role: "CUSTOMER",
      text: "qual o preço da pilsen?",
      detectedIntent: "DUVIDA",
    });
    const extrair = vi.fn();
    const servico = criar(provedorFake(extrair));

    const r = await servico({ tenantId: TENANT_A, eventoId: EVENTO_ID });
    expect(r).toMatchObject({
      situacao: "IGNORADA",
      motivo: "INTENCAO_NAO_E_PEDIDO",
    });
    expect(extrair).not.toHaveBeenCalled();
  });

  it("multi-turn: permitirSemIntencaoDePedido=true extrai com outra intenção", async () => {
    const criar = await importarServico();
    mocks.messageFindFirst.mockResolvedValue({
      id: MSG_ID,
      conversationId: CONV_ID,
      role: "CUSTOMER",
      text: "qual o preço da pilsen?",
      detectedIntent: "DUVIDA",
    });
    const extrair = vi.fn().mockResolvedValue(BRUTO_OK);
    const servico = criar(provedorFake(extrair));

    const r = await servico({
      tenantId: TENANT_A,
      eventoId: EVENTO_ID,
      permitirSemIntencaoDePedido: true,
    });

    expect(r.situacao).toBe("EXTRAIDA");
    expect(extrair).toHaveBeenCalledTimes(1);
    expect(extrair).toHaveBeenCalledWith("qual o preço da pilsen?");
  });

  it("default permanece exigindo FAZER_PEDIDO mesmo em fluxo", async () => {
    const criar = await importarServico();
    mocks.messageFindFirst.mockResolvedValue({
      id: MSG_ID,
      conversationId: CONV_ID,
      role: "CUSTOMER",
      text: "qual o preço da pilsen?",
      detectedIntent: "DUVIDA",
    });
    const extrair = vi.fn().mockResolvedValue(BRUTO_OK);
    const servico = criar(provedorFake(extrair));

    const r = await servico({ tenantId: TENANT_A, eventoId: EVENTO_ID });
    expect(r).toMatchObject({ situacao: "IGNORADA", motivo: "INTENCAO_NAO_E_PEDIDO" });
    expect(extrair).not.toHaveBeenCalled();
  });
});

describe("extrairPedidoBotnextSeHabilitado — gate BOTNEXT_AI_ENABLED", () => {
  it("BOTNEXT_AI_ENABLED=false → DESATIVADA, nada é chamado", async () => {
    vi.stubEnv("BOTNEXT_AI_ENABLED", "false");
    const { extrairPedidoBotnextSeHabilitado } = await import(
      "../src/integrations/botnext/botnext-pedido-ai-service.js"
    );

    const r = await extrairPedidoBotnextSeHabilitado({
      tenantId: TENANT_A,
      eventoId: EVENTO_ID,
    });

    expect(r).toEqual({ situacao: "DESATIVADA" });
    expect(mocks.messageFindFirst).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
