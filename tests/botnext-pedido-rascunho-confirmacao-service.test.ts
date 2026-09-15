import {
  BotnextPedidoRascunhoStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { calcularDispatchKey } from "../src/pedidos/pedido-confirmado/dispatch-key.js";
import { paraItemPedidoConfirmado } from "../src/pedidos/pedido-confirmado/tipos.js";
import type {
  ConteudoRascunhoPersistido,
  ItemRascunho,
} from "../src/pedidos/rascunho/tipos.js";
import type { ConfirmacaoRascunho } from "../src/pedidos/pedido-confirmado/tipos.js";

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const CONVERSAO_ID = "c0000000-0000-4000-8000-0000000000cc";
const EXTRACAO_ID = "e0000000-0000-4000-8000-0000000000aa";
const RASCUNHO_ID = "r0000000-0000-4000-8000-0000000000rr";

const mocks = vi.hoisted(() => ({
  rascunhoFindFirst: vi.fn(),
  rascunhoUpdateMany: vi.fn(),
}));

vi.mock("../src/database/prisma.js", () => ({
  prisma: {
    botnextPedidoRascunho: {
      findFirst: mocks.rascunhoFindFirst,
      updateMany: mocks.rascunhoUpdateMany,
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

function conteudo(
  itens: ItemRascunho[],
  confirmacao?: ConfirmacaoRascunho,
): ConteudoRascunhoPersistido {
  const conteudo: ConteudoRascunhoPersistido = {
    versao: "rascunho-v1",
    itens,
    sinaisExtracao: [],
  };
  if (confirmacao) {
    conteudo.confirmacao = confirmacao;
  }
  return conteudo;
}

type LinhaSim = {
  id: string;
  tenantId: string;
  extracaoId: string;
  status: BotnextPedidoRascunhoStatus;
  revision: number;
  itens: unknown;
  dispatchKey: string | null;
  extracao: {
    conversationId: string;
    sourceMessage: {
      webhookEvent: { senderPhone: string | null } | null;
    };
  };
};

let linha: LinhaSim | null = null;
let protocoloUpdate: Array<unknown> = [];

function definirLinha(
  status: BotnextPedidoRascunhoStatus,
  conteudoRascunho: ConteudoRascunhoPersistido,
  revision = 0,
) {
  linha = {
    id: RASCUNHO_ID,
    tenantId: TENANT_A,
    extracaoId: EXTRACAO_ID,
    status,
    revision,
    itens: conteudoRascunho,
    dispatchKey: conteudoRascunho.confirmacao?.dispatchKey ?? null,
    extracao: {
      conversationId: CONVERSAO_ID,
      sourceMessage: {
        webhookEvent: { senderPhone: "5511988880001" },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("BOTNEXT_TEST_MODE", "false");
  linha = null;
  protocoloUpdate = [];

  mocks.rascunhoFindFirst.mockImplementation(async () =>
    linha
      ? JSON.parse(JSON.stringify(linha))
      : null,
  );

  mocks.rascunhoUpdateMany.mockImplementation(
    async ({ where, data }: { where: Record<string, unknown>; data: any }) => {
      protocoloUpdate.push({ where, data });
      if (!linha) return { count: 0 };
      if (where.id && linha.id !== where.id) return { count: 0 };
      if (where.tenantId && linha.tenantId !== where.tenantId) {
        return { count: 0 };
      }
      if (where.revision !== undefined && linha.revision !== where.revision) {
        return { count: 0 };
      }
      if (where.status && linha.status !== where.status) return { count: 0 };

      if (data.status) linha.status = data.status;
      if (data.dispatchKey !== undefined) linha.dispatchKey = data.dispatchKey;
      if (data.itens !== undefined) linha.itens = data.itens;
      if (data.revision?.increment !== undefined) {
        linha.revision += data.revision.increment;
      }
      return { count: 1 };
    },
  );
});

async function confirmar() {
  const { criarServicoConfirmacaoRascunho } = await import(
    "../src/integrations/botnext/botnext-pedido-rascunho-confirmacao-service.js"
  );
  return criarServicoConfirmacaoRascunho()({
    tenantId: TENANT_A,
    rascunhoId: RASCUNHO_ID,
  });
}

function chaveEsperada(itens: ItemRascunho[], revision = 1): string {
  return calcularDispatchKey({
    tenantId: TENANT_A,
    conversationId: CONVERSAO_ID,
    extracaoId: EXTRACAO_ID,
    rascunhoId: RASCUNHO_ID,
    revision,
    itens: itens.map(paraItemPedidoConfirmado),
  });
}

describe("serviço de confirmação de pedido (Etapa 3.1)", () => {
  it("modo de teste não confirma rascunho originado por outro telefone", async () => {
    vi.stubEnv("BOTNEXT_TEST_MODE", "true");
    vi.stubEnv("BOTNEXT_TEST_TO", "5511988880001");
    definirLinha(
      BotnextPedidoRascunhoStatus.PRONTO,
      conteudo([itemRascunho()]),
    );
    linha!.extracao.sourceMessage.webhookEvent = {
      senderPhone: "5511988880002",
    };

    const r = await confirmar();

    expect(r).toMatchObject({
      situacao: "NAO_CONFIRMAVEL",
      motivo: "FORA_DO_ESCOPO_DE_TESTE",
    });
    expect(mocks.rascunhoUpdateMany).not.toHaveBeenCalled();
  });

  it("modo de teste não retorna sucesso idempotente para confirmado fora do escopo", async () => {
    vi.stubEnv("BOTNEXT_TEST_MODE", "true");
    vi.stubEnv("BOTNEXT_TEST_TO", "5511988880001");
    definirLinha(
      BotnextPedidoRascunhoStatus.CONFIRMADO,
      conteudo([itemRascunho()]),
      1,
    );
    linha!.extracao.sourceMessage.webhookEvent = {
      senderPhone: "5511988880002",
    };

    const r = await confirmar();

    expect(r).toMatchObject({
      situacao: "NAO_CONFIRMAVEL",
      motivo: "FORA_DO_ESCOPO_DE_TESTE",
    });
    expect(mocks.rascunhoUpdateMany).not.toHaveBeenCalled();
  });


  it("#1 PRONTO + zero pendências → CONFIRMADO com dispatchKey/confirmadoEm/revision+1", async () => {
    const itens = [itemRascunho()];
    definirLinha(BotnextPedidoRascunhoStatus.PRONTO, conteudo(itens), 0);
    const revPos = 1;
    const chave = chaveEsperada(itens, revPos);

    const r = await confirmar();

    expect(r.situacao).toBe("CONFIRMADO");
    if (r.situacao === "CONFIRMADO") {
      expect(r.dispatchKey).toBe(chave);
      expect(r.revision).toBe(1);
      expect(r.confirmadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }

    const { where, data } = protocoloUpdate[0] as {
      where: Record<string, unknown>;
      data: any;
    };
    expect(where).toMatchObject({
      id: RASCUNHO_ID,
      tenantId: TENANT_A,
      revision: 0,
      status: BotnextPedidoRascunhoStatus.PRONTO,
    });
    expect(data).toMatchObject({
      status: BotnextPedidoRascunhoStatus.CONFIRMADO,
      dispatchKey: chave,
      revision: { increment: 1 },
    });
    const conteudoGravado = data.itens as ConteudoRascunhoPersistido;
    expect(conteudoGravado.confirmacao?.dispatchKey).toBe(chave);
    expect(typeof conteudoGravado.confirmacao?.confirmadoEm).toBe("string");
    expect(linha?.status).toBe(BotnextPedidoRascunhoStatus.CONFIRMADO);
  });

  it("#2 PENDENTE (RASCUNHO) → NÃO_CONFIRMAVEL, nada gravado", async () => {
    definirLinha(BotnextPedidoRascunhoStatus.RASCUNHO, conteudo([itemRascunho()]));

    const r = await confirmar();

    expect(r).toMatchObject({
      situacao: "NAO_CONFIRMAVEL",
      motivo: "RASCUNHO_NAO_PRONTO",
    });
    expect(mocks.rascunhoUpdateMany).not.toHaveBeenCalled();
  });

  it("#3 item pendente escondido com status PRONTO → bloqueia", async () => {
    const itens = [itemRascunho({ resolucao: null, pendente: true })];
    definirLinha(BotnextPedidoRascunhoStatus.PRONTO, conteudo(itens));

    const r = await confirmar();

    expect(r).toMatchObject({
      situacao: "NAO_CONFIRMAVEL",
      motivo: "ITEM_PENDENTE",
    });
    expect(mocks.rascunhoUpdateMany).not.toHaveBeenCalled();
  });

  it("#4 CONFIRMADO → JA_CONFIRMADO idempotente (mesmos dados)", async () => {
    const itens = [itemRascunho()];
    const chave = chaveEsperada(itens, 1);
    const confirmacao: ConfirmacaoRascunho = {
      confirmadoEm: "2026-09-09T12:00:00.000Z",
      dispatchKey: chave,
    };
    definirLinha(
      BotnextPedidoRascunhoStatus.CONFIRMADO,
      conteudo(itens, confirmacao),
      1,
    );

    const r = await confirmar();

    expect(r).toMatchObject({
      situacao: "JA_CONFIRMADO",
      dispatchKey: chave,
      confirmadoEm: "2026-09-09T12:00:00.000Z",
      revision: 1,
    });
    expect(mocks.rascunhoUpdateMany).not.toHaveBeenCalled();
  });

  it("#5 DESPACHADO → JA_DESPACHADO, nada gravado", async () => {
    definirLinha(BotnextPedidoRascunhoStatus.DESPACHADO, conteudo([itemRascunho()]));

    const r = await confirmar();

    expect(r).toMatchObject({ situacao: "JA_DESPACHADO" });
    expect(mocks.rascunhoUpdateMany).not.toHaveBeenCalled();
  });

  it("#6 tenant isolation: rascunho de outro tenant → erro", async () => {
    mocks.rascunhoFindFirst.mockResolvedValue(null);

    await expect(confirmar()).rejects.toThrow(/não encontrado no tenant/i);
    expect(mocks.rascunhoUpdateMany).not.toHaveBeenCalled();
  });

  it("#7 corrida (CAS conta 0) → re-lê vencedor CONFIRMADO → JA_CONFIRMADO", async () => {
    const itens = [itemRascunho()];
    const chave = chaveEsperada(itens, 1);
    const vencedor = {
      ...(linha ?? {
        id: RASCUNHO_ID,
        tenantId: TENANT_A,
        extracaoId: EXTRACAO_ID,
        extracao: {
          conversationId: CONVERSAO_ID,
          sourceMessage: {
            webhookEvent: { senderPhone: "5511988880001" },
          },
        },
      }),
      status: BotnextPedidoRascunhoStatus.PRONTO,
      revision: 0,
      dispatchKey: null,
      itens: conteudo(itens),
    };
    const confirmado = JSON.parse(JSON.stringify(vencedor)) as LinhaSim;
    confirmado.status = BotnextPedidoRascunhoStatus.CONFIRMADO;
    confirmado.revision = 1;
    confirmado.dispatchKey = chave;
    confirmado.itens = conteudo(itens, {
      confirmadoEm: "2026-09-09T12:00:00.000Z",
      dispatchKey: chave,
    });

    let chamadasFind = 0;
    mocks.rascunhoFindFirst.mockImplementation(async () => {
      chamadasFind += 1;
      return chamadasFind === 1
        ? JSON.parse(JSON.stringify(vencedor))
        : JSON.parse(JSON.stringify(confirmado));
    });
    mocks.rascunhoUpdateMany.mockResolvedValue({ count: 0 });

    const r = await confirmar();

    expect(r).toMatchObject({
      situacao: "JA_CONFIRMADO",
      dispatchKey: chave,
      confirmadoEm: "2026-09-09T12:00:00.000Z",
      revision: 1,
    });
  });

  it("#8 CONFIRMADO sem confirmação/dispatchKey persistidos → inconsistência", async () => {
    definirLinha(
      BotnextPedidoRascunhoStatus.CONFIRMADO,
      conteudo([itemRascunho()]),
      1,
    );

    await expect(confirmar()).rejects.toThrow(/sem dispatchKey\/confirmação/i);
  });

  it("#9 corrida com estado revertido para RASCUNHO → NÃO_CONFIRMAVEL", async () => {
    const itens = [itemRascunho()];
    const pronto = {
      id: RASCUNHO_ID,
      tenantId: TENANT_A,
      extracaoId: EXTRACAO_ID,
      status: BotnextPedidoRascunhoStatus.PRONTO,
      revision: 0,
      dispatchKey: null,
      itens: conteudo(itens),
      extracao: {
        conversationId: CONVERSAO_ID,
        sourceMessage: {
          webhookEvent: { senderPhone: "5511988880001" },
        },
      },
    };
    const revertido = JSON.parse(JSON.stringify(pronto)) as LinhaSim;
    revertido.status = BotnextPedidoRascunhoStatus.RASCUNHO;

    let chamadasFind = 0;
    mocks.rascunhoFindFirst.mockImplementation(async () => {
      chamadasFind += 1;
      return chamadasFind === 1 ? JSON.parse(JSON.stringify(pronto)) : JSON.parse(JSON.stringify(revertido));
    });
    mocks.rascunhoUpdateMany.mockResolvedValue({ count: 0 });

    const r = await confirmar();

    if (r.situacao === "NAO_CONFIRMAVEL") {
      expect(r.motivo).toBe("ESTADO_ALTERADO_NA_CORRIDA");
    } else {
      throw new Error("Esperava NAO_CONFIRMAVEL na corrida revertida.");
    }
  });
});
