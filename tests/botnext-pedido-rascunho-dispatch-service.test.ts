import {
  BotnextPedidoRascunhoStatus,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ConteudoRascunhoPersistido,
  ItemRascunho,
} from "../src/pedidos/rascunho/tipos.js";
import type {
  ConfirmacaoRascunho,
  ItemPedidoConfirmadoV1,
  PedidoConfirmadoV1,
} from "../src/pedidos/pedido-confirmado/tipos.js";
import type {
  EnviadorHttp,
  RequisicaoHttp,
} from "../src/integrations/botnext/botnext-pedido-rascunho-dispatch-service.js";

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const CONVERSAO_ID = "c0000000-0000-4000-8000-0000000000cc";
const EXTRACAO_ID = "e0000000-0000-4000-8000-0000000000aa";
const RASCUNHO_ID = "r0000000-0000-4000-8000-0000000000rr";
const CHAVE = "aa".repeat(32);
const URL_N8N = "https://n8n.hubnext.tech/webhook/huffnung";

const envOriginais = {
  enabled: process.env.BOTNEXT_PEDIDO_DISPATCH_ENABLED,
  url: process.env.BOTNEXT_PEDIDO_DISPATCH_URL,
  timeout: process.env.BOTNEXT_PEDIDO_DISPATCH_TIMEOUT_MS,
  attempts: process.env.BOTNEXT_PEDIDO_DISPATCH_MAX_ATTEMPTS,
};

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
    cliente: {
      findFirst: mocks.clienteFindFirst,
    },
  },
}));

function itemRascunho(parcial: Partial<ItemRascunho> = {}): ItemRascunho {
  return {
    quantidade: 2,
    produtoMencionado: "cachaça premium",
    unidadeMencionada: "caixas",
    embalagemMencionada: null,
    observacaoItem: null,
    problemas: [],
    resolucao: {
      status: "RESOLVIDO",
      origemResolucao: "NOME_EXATO",
      fonteCatalogo: "PRODUTO",
      arbrainId: "arbP-p-cachaca",
      id: "p-cachaca",
      sku: 9,
      nome: "Cachaça Premium",
      score: null,
      candidatos: [],
      sinais: [],
      motivo: "teste",
    },
    pendente: false,
    ...parcial,
  };
}

const CONFIRMACAO: ConfirmacaoRascunho = {
  confirmadoEm: "2026-09-09T12:00:00.000Z",
  dispatchKey: CHAVE,
};

const CONTEUDO: ConteudoRascunhoPersistido = {
  versao: "rascunho-v1",
  itens: [itemRascunho()],
  sinaisExtracao: [],
  confirmacao: CONFIRMACAO,
};

type LinhaDispatchSim = {
  id: string;
  tenantId: string;
  extracaoId: string;
  status: BotnextPedidoRascunhoStatus;
  revision: number;
  itens: ConteudoRascunhoPersistido;
  dispatchKey: string | null;
  dispatchToken: string | null;
  dispatchWorker: string | null;
  dispatchLeaseUntil: Date | null;
  dispatchAttempts: number;
  dispatchedAt: Date | null;
  errorMessage: string | null;
  extracao: {
    conversationId: string;
    conversation: { clienteId: string | null };
  };
};

let linha: LinhaDispatchSim | null = null;
const postagens: RequisicaoHttp[] = [];

function linhaConfirmada(
  overrides: Partial<LinhaDispatchSim> = {},
): LinhaDispatchSim {
  return {
    id: RASCUNHO_ID,
    tenantId: TENANT_A,
    extracaoId: EXTRACAO_ID,
    status: BotnextPedidoRascunhoStatus.CONFIRMADO,
    revision: 1,
    itens: CONTEUDO,
    dispatchKey: CHAVE,
    dispatchToken: null,
    dispatchWorker: null,
    dispatchLeaseUntil: null,
    dispatchAttempts: 0,
    dispatchedAt: null,
    errorMessage: null,
    extracao: {
      conversationId: CONVERSAO_ID,
      conversation: { clienteId: "cliente-1" },
    },
    ...overrides,
  };
}

function aplicarUpdateMany(where: any, data: any): { count: number } {
  if (!linha) return { count: 0 };
  if (where.id && linha.id !== where.id) return { count: 0 };
  if (where.tenantId && linha.tenantId !== where.tenantId) return { count: 0 };
  if (where.status && linha.status !== where.status) return { count: 0 };

  if (where.dispatchToken) {
    if (linha.dispatchToken !== where.dispatchToken) return { count: 0 };
    const gte = where.dispatchLeaseUntil?.gte as Date | undefined;
    if (
      gte &&
      !(
        linha.dispatchLeaseUntil !== null &&
        linha.dispatchLeaseUntil >= gte
      )
    ) {
      return { count: 0 };
    }
  }

  if (where.dispatchAttempts?.lt !== undefined) {
    if (linha.dispatchAttempts >= (where.dispatchAttempts.lt as number)) {
      return { count: 0 };
    }
  }

  const or = where.OR as
    | Array<{ dispatchToken?: null; dispatchLeaseUntil?: { lt: Date } }>
    | undefined;
  if (or) {
    const aceitaNulo =
      or.some((c) => "dispatchToken" in c && c.dispatchToken === null) &&
      linha.dispatchToken === null;
    const lt = or.find((c) => c.dispatchLeaseUntil)?.dispatchLeaseUntil?.lt;
    const aceitaExpirada =
      lt !== undefined &&
      (linha.dispatchLeaseUntil === null || linha.dispatchLeaseUntil < lt);
    if (!aceitaNulo && !aceitaExpirada) return { count: 0 };
  }

  if (data.status !== undefined) linha.status = data.status;
  if (data.dispatchedAt !== undefined) {
    linha.dispatchedAt = data.dispatchedAt as Date;
  }
  if (data.dispatchToken !== undefined) {
    linha.dispatchToken = data.dispatchToken as string | null;
  }
  if (data.dispatchWorker !== undefined) {
    linha.dispatchWorker = data.dispatchWorker as string;
  }
  if (data.dispatchLeaseUntil !== undefined) {
    linha.dispatchLeaseUntil = data.dispatchLeaseUntil as Date | null;
  }
  if (data.dispatchAttempts?.increment !== undefined) {
    linha.dispatchAttempts += data.dispatchAttempts.increment as number;
  }
  if (data.errorMessage !== undefined) {
    linha.errorMessage = data.errorMessage as string | null;
  }
  return { count: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  linha = null;
  postagens.length = 0;

  process.env.BOTNEXT_PEDIDO_DISPATCH_ENABLED = "true";
  process.env.BOTNEXT_PEDIDO_DISPATCH_URL = URL_N8N;
  process.env.BOTNEXT_PEDIDO_DISPATCH_TIMEOUT_MS = "1000";
  process.env.BOTNEXT_PEDIDO_DISPATCH_MAX_ATTEMPTS = "3";

  mocks.rascunhoFindFirst.mockImplementation(async () =>
    linha ? structuredClone(linha) : null,
  );
  mocks.rascunhoUpdateMany.mockImplementation(async ({ where, data }) =>
    aplicarUpdateMany(where, data),
  );
  mocks.clienteFindFirst.mockResolvedValue({ arbrainId: "arb-cliente-1" });
});

afterEach(() => {
  if (envOriginais.enabled === undefined) {
    delete process.env.BOTNEXT_PEDIDO_DISPATCH_ENABLED;
  } else {
    process.env.BOTNEXT_PEDIDO_DISPATCH_ENABLED = envOriginais.enabled;
  }
  if (envOriginais.url === undefined) {
    delete process.env.BOTNEXT_PEDIDO_DISPATCH_URL;
  } else {
    process.env.BOTNEXT_PEDIDO_DISPATCH_URL = envOriginais.url;
  }
  if (envOriginais.timeout === undefined) {
    delete process.env.BOTNEXT_PEDIDO_DISPATCH_TIMEOUT_MS;
  } else {
    process.env.BOTNEXT_PEDIDO_DISPATCH_TIMEOUT_MS = envOriginais.timeout;
  }
  if (envOriginais.attempts === undefined) {
    delete process.env.BOTNEXT_PEDIDO_DISPATCH_MAX_ATTEMPTS;
  } else {
    process.env.BOTNEXT_PEDIDO_DISPATCH_MAX_ATTEMPTS = envOriginais.attempts;
  }
});

async function despachar(
  enviador: EnviadorHttp,
  params: { tenantId?: string; rascunhoId?: string } = {},
) {
  const { criarServicoDispatchPedido } = await import(
    "../src/integrations/botnext/botnext-pedido-rascunho-dispatch-service.js"
  );
  const servico = criarServicoDispatchPedido({ enviadorHttp: enviador });
  return servico({
    tenantId: params.tenantId ?? TENANT_A,
    rascunhoId: params.rascunhoId ?? RASCUNHO_ID,
  });
}

function enviadorFixo(valor: any): EnviadorHttp {
  return async (req) => {
    postagens.push(req);
    return valor;
  };
}

function corpoDaUltimaPostagem(): PedidoConfirmadoV1 | null {
  return postagens.length > 0
    ? (postagens[postagens.length - 1]!.corpo as PedidoConfirmadoV1)
    : null;
}

describe("dispatch do pedido confirmado ao n8n (Etapa 3.1)", () => {
  it("#1 flag desligada → DESATIVADO, zero HTTP e zero escrita", async () => {
    process.env.BOTNEXT_PEDIDO_DISPATCH_ENABLED = "false";
    linha = linhaConfirmada();
    const enviador = enviadorFixo({ tipo: "RESPOSTA", status: 200, corpo: null });

    const r = await despachar(enviador);

    expect(r.situacao).toBe("DESATIVADO");
    expect(postagens).toHaveLength(0);
    expect(mocks.rascunhoFindFirst).not.toHaveBeenCalled();
    expect(mocks.rascunhoUpdateMany).not.toHaveBeenCalled();
  });

  it("#2 rascunho PENDENTE (não CONFIRMADO) → NAO_CONFIRMADO, sem HTTP", async () => {
    linha = linhaConfirmada({ status: BotnextPedidoRascunhoStatus.RASCUNHO });
    const enviador = enviadorFixo({ tipo: "RESPOSTA", status: 200, corpo: null });

    const r = await despachar(enviador);

    expect(r).toMatchObject({
      situacao: "NAO_CONFIRMADO",
      motivo: "STATUS_NAO_CONFIRMADO",
    });
    expect(postagens).toHaveLength(0);
  });

  it("#3 CONFIRMADO sem dispatchKey → NAO_CONFIRMADO (DISPATCH_KEY_AUSENTE)", async () => {
    linha = linhaConfirmada({ dispatchKey: null });
    const enviador = enviadorFixo({ tipo: "RESPOSTA", status: 200, corpo: null });

    const r = await despachar(enviador);

    expect(r).toMatchObject({
      situacao: "NAO_CONFIRMADO",
      motivo: "DISPATCH_KEY_AUSENTE",
    });
    expect(postagens).toHaveLength(0);
  });

  it("#4 2xx → ENVIADO, DESPACHADO + dispatchedAt, payload correto", async () => {
    linha = linhaConfirmada();
    const enviador = enviadorFixo({ tipo: "RESPOSTA", status: 200, corpo: null });

    const r = await despachar(enviador);

    expect(r.situacao).toBe("ENVIADO");
    if (r.situacao === "ENVIADO") {
      expect(r.dispatchKey).toBe(CHAVE);
      expect(r.dispatchedAt).toBeInstanceOf(Date);
    }
    expect(linha?.status).toBe(BotnextPedidoRascunhoStatus.DESPACHADO);
    expect(linha?.dispatchedAt).toBeInstanceOf(Date);
    expect(linha?.dispatchToken).toBeNull();

    const corpo = corpoDaUltimaPostagem();
    expect(corpo).toMatchObject({
      version: "1",
      tipoEvento: "PEDIDO_CONFIRMADO",
      dispatchKey: CHAVE,
      tenantId: TENANT_A,
      conversationId: CONVERSAO_ID,
      extracaoId: EXTRACAO_ID,
      rascunhoId: RASCUNHO_ID,
      revision: 1,
      confirmadoEm: CONFIRMACAO.confirmadoEm,
      cliente: { arbrainId: "arb-cliente-1" },
    });
    const item = corpo!.itens[0]! as ItemPedidoConfirmadoV1;
    expect(item.quantidade).toBe(2);
    expect(item.produtoMencionado).toBe("cachaça premium");
    expect(item.idEmbalagem).toBeNull();
    expect(item.idUnidade).toBeNull();
    expect(item.tipoLinha).toBeNull();
    expect(item.valorUnitario).toBeNull();
  });

  it("#5 4xx → FALHA_PERMANENTE, status FALHOU", async () => {
    linha = linhaConfirmada();
    const enviador = enviadorFixo({ tipo: "RESPOSTA", status: 422, corpo: { erro: "x" } });

    const r = await despachar(enviador);

    expect(r.situacao).toBe("FALHA_PERMANENTE");
    expect(linha?.status).toBe(BotnextPedidoRascunhoStatus.FALHOU);
    expect(linha?.errorMessage).toContain("422");
  });

  it("#6 5xx → FALHA_TRANSITORIA, lease/token liberados para retry", async () => {
    linha = linhaConfirmada();
    const enviador = enviadorFixo({ tipo: "RESPOSTA", status: 500, corpo: null });

    const r = await despachar(enviador);

    expect(r.situacao).toBe("FALHA_TRANSITORIA");
    if (r.situacao === "FALHA_TRANSITORIA") {
      expect(r.tentativa).toBe(1);
      expect(r.podeTentarDeNovo).toBe(true);
    }
    expect(linha?.status).toBe(BotnextPedidoRascunhoStatus.CONFIRMADO);
    expect(linha?.dispatchToken).toBeNull();
    expect(linha?.dispatchAttempts).toBe(1);
  });

  it("#7 5xx com tentativas esgotadas → FALHA_PERMANENTE", async () => {
    process.env.BOTNEXT_PEDIDO_DISPATCH_MAX_ATTEMPTS = "1";
    linha = linhaConfirmada();
    const enviador = enviadorFixo({ tipo: "RESPOSTA", status: 503, corpo: null });

    const r = await despachar(enviador);

    expect(r.situacao).toBe("FALHA_PERMANENTE");
    expect(linha?.status).toBe(BotnextPedidoRascunhoStatus.FALHOU);
  });

  it("#8 timeout → INCERTO, token mantido (farol até expirar o lease)", async () => {
    linha = linhaConfirmada();
    const enviador = enviadorFixo({ tipo: "TEMPO_ESGOTADO" });

    const r = await despachar(enviador);

    expect(r.situacao).toBe("INCERTO");
    expect(linha?.status).toBe(BotnextPedidoRascunhoStatus.CONFIRMADO);
    expect(linha?.dispatchToken).not.toBeNull();
    expect(linha?.errorMessage).toContain("Timeout");
  });

  it("#9 resposta inesperada (3xx) → FALHA_PERMANENTE", async () => {
    linha = linhaConfirmada();
    const enviador = enviadorFixo({ tipo: "RESPOSTA", status: 302, corpo: null });

    const r = await despachar(enviador);

    expect(r.situacao).toBe("FALHA_PERMANENTE");
    expect(linha?.status).toBe(BotnextPedidoRascunhoStatus.FALHOU);
    expect(linha?.errorMessage).toContain("302");
  });

  it("#10 erro de rede antes do envio → FALHA_TRANSITORIA", async () => {
    linha = linhaConfirmada();
    const enviador = enviadorFixo({
      tipo: "FALHA_REDE",
      motivo: "ECONNREFUSED",
    });

    const r = await despachar(enviador);

    expect(r.situacao).toBe("FALHA_TRANSITORIA");
    expect(linha?.dispatchToken).toBeNull();
    expect(linha?.dispatchAttempts).toBe(1);
  });

  it("#11 duas execuções concorrentes → apenas 1 POST efetivo", async () => {
    linha = linhaConfirmada();
    const enviador = enviadorFixo({ tipo: "RESPOSTA", status: 200, corpo: null });

    const [a, b] = await Promise.all([
      despachar(enviador),
      despachar(enviador),
    ]);

    expect(postagens).toHaveLength(1);
    const situacoes = [a.situacao, b.situacao].sort();
    expect(situacoes).toEqual(["CONCORRENCIA", "ENVIADO"]);
    expect(linha?.status).toBe(BotnextPedidoRascunhoStatus.DESPACHADO);
  });

  it("#12 JA_DESPACHADO em re-entrada, sem novo POST", async () => {
    const dispatchedAt = new Date();
    linha = linhaConfirmada({
      status: BotnextPedidoRascunhoStatus.DESPACHADO,
      dispatchedAt,
    });
    const enviador = enviadorFixo({ tipo: "RESPOSTA", status: 200, corpo: null });

    const r = await despachar(enviador);

    expect(r).toMatchObject({
      situacao: "JA_DESPACHADO",
      dispatchKey: CHAVE,
      dispatchedAt,
    });
    expect(postagens).toHaveLength(0);
  });

  it("#13 token de fencing errado na finalização → CONCORRENCIA", async () => {
    linha = linhaConfirmada();
    const enviador: EnviadorHttp = async (req) => {
      postagens.push(req);
      linha!.dispatchToken = "token-alterado-por-outro-worker";
      return { tipo: "RESPOSTA", status: 200, corpo: null };
    };

    const r = await despachar(enviador);

    expect(r.situacao).toBe("CONCORRENCIA");
    expect(linha?.status).toBe(BotnextPedidoRascunhoStatus.CONFIRMADO);
  });

  it("#14 lease vencida na finalização → CONCORRENCIA", async () => {
    linha = linhaConfirmada();
    const enviador: EnviadorHttp = async (req) => {
      postagens.push(req);
      linha!.dispatchLeaseUntil = new Date(Date.now() - 60_000);
      return { tipo: "RESPOSTA", status: 200, corpo: null };
    };

    const r = await despachar(enviador);

    expect(r.situacao).toBe("CONCORRENCIA");
    expect(linha?.status).toBe(BotnextPedidoRascunhoStatus.CONFIRMADO);
  });

  it("#15 tenant isolation: rascunho de outro tenant → erro sem HTTP", async () => {
    mocks.rascunhoFindFirst.mockResolvedValue(null);
    const enviador = enviadorFixo({ tipo: "RESPOSTA", status: 200, corpo: null });

    await expect(
      despachar(enviador, { tenantId: TENANT_B }),
    ).rejects.toThrow(/não encontrado no tenant/i);
    expect(postagens).toHaveLength(0);
  });

  it("#16 payload byte-idêntico em retry (5xx → 2xx)", async () => {
    linha = linhaConfirmada();
    let chamadas = 0;
    const enviador: EnviadorHttp = async (req) => {
      postagens.push(req);
      chamadas += 1;
      return chamadas === 1
        ? { tipo: "RESPOSTA", status: 500, corpo: null }
        : { tipo: "RESPOSTA", status: 200, corpo: null };
    };

    const r1 = await despachar(enviador);
    expect(r1.situacao).toBe("FALHA_TRANSITORIA");

    const r2 = await despachar(enviador);
    expect(r2.situacao).toBe("ENVIADO");

    expect(postagens).toHaveLength(2);
    expect(JSON.stringify(postagens[0]!.corpo)).toBe(
      JSON.stringify(postagens[1]!.corpo),
    );
  });

  it("#17 nenhuma chamada HTTP real (fetch global) durante testes", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    linha = linhaConfirmada();
    const enviador = enviadorFixo({ tipo: "RESPOSTA", status: 200, corpo: null });

    await despachar(enviador);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("#18 cliente.arbrainId null → contrato aceita null", async () => {
    mocks.clienteFindFirst.mockResolvedValue(null);
    linha = linhaConfirmada();
    const enviador = enviadorFixo({ tipo: "RESPOSTA", status: 200, corpo: null });

    await despachar(enviador);

    const corpo = corpoDaUltimaPostagem();
    expect(corpo?.cliente.arbrainId).toBeNull();
  });
});