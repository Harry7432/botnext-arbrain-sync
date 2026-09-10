import { readFileSync } from "node:fs";

import {
  BotnextPedidoRascunhoStatus,
  Prisma,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { criarCatalogoRepositoryEmMemoria } from "../src/pedidos/catalogo-repository.js";
import type {
  ItemCatalogo,
} from "../src/pedidos/tipos.js";
import type {
  ItemExtraido,
  ResultadoExtracao,
  SinalExtracao,
} from "../src/pedidos/extracao/tipos.js";

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const EXTRACAO_ID = "e0000000-0000-4000-8000-0000000000aa";

const mocks = vi.hoisted(() => ({
  rascunhoFindUnique: vi.fn(),
  rascunhoCreate: vi.fn(),
  extracaoFindUnique: vi.fn(),
}));

vi.mock("../src/database/prisma.js", () => ({
  prisma: {
    botnextPedidoRascunho: {
      findUnique: mocks.rascunhoFindUnique,
      create: mocks.rascunhoCreate,
    },
    botnextPedidoExtracao: {
      findUnique: mocks.extracaoFindUnique,
    },
  },
}));

// ---------------------------------------------------------------------------
// Catálogos do tenant para o resolvedor REAL (integração).
//
// PRONTO exige RESOLVIDO SEM SEM_CONTEXTO_DE_FONTE: só acontece (sem hint)
// quando as DUAS fontes contribuem e uma vence por rank estritamente maior.
// ---------------------------------------------------------------------------
function produto(id: string, nome: string, sku: number): ItemCatalogo {
  return { fonte: "PRODUTO", id, tenantId: TENANT_A, arbrainId: `arbP-${id}`, sku, nome };
}
function cerveja(id: string, nome: string, sku: number): ItemCatalogo {
  return { fonte: "CERVEJA", id, tenantId: TENANT_A, arbrainId: `arbC-${id}`, sku, nome };
}

// query "cachaça premium" → produto NOME_EXATO (3) vence cerveja TOKENS (2)
const CATALOGO_PRODUTO_PRONT0 = {
  produtos: [
    produto("p-cachaca", "Cachaça Premium", 9),
  ],
  cervejas: [
    cerveja("c-cachaca-malbec", "Cachaça Premium Malbec", 41),
  ],
};

// query "pilsen hoffnung" → cerveja NOME_EXATO (3) vence produto TOKENS (2)
const CATALOGO_CERVEJA_PRONTA = {
  produtos: [
    produto("p-copo-pilsen", "Copo Pilsen Hoffnung", 24),
  ],
  cervejas: [
    cerveja("c-pilsen", "Pilsen Hoffnung", 1),
  ],
};

// catálogo combinado para múltiplos itens (ambos cenários PRONTO)
const CATALOGO_COMBINADO = {
  produtos: [
    produto("p-cachaca", "Cachaça Premium", 9),
    produto("p-copo-pilsen", "Copo Pilsen Hoffnung", 24),
  ],
  cervejas: [
    cerveja("c-cachaca-malbec", "Cachaça Premium Malbec", 41),
    cerveja("c-pilsen", "Pilsen Hoffnung", 1),
  ],
};

// dua cervejas com o MESMO nome normalizado → AMBIGUO por NOME_EXATO
const CATALOGO_AMBIGUO = {
  produtos: [],
  cervejas: [
    cerveja("c-pilsen-hoff", "Pilsen Hoffnung", 1),
    cerveja("c-pilsen-verde", "Pilsen Hoffnung", 2),
  ],
};

const CATALOGO_VAZIO = { produtos: [], cervejas: [], aliases: [] };

// ---------------------------------------------------------------------------
// Estado simulado
// ---------------------------------------------------------------------------
type LinhaExtracao = {
  id: string;
  itensExtraidos: unknown;
} | null;

type LinhaRascunho = {
  id: string;
  status: BotnextPedidoRascunhoStatus;
  itens: unknown;
  totalItens: number;
  itensResolvidos: number;
  itensNaoResolvidos: number;
  observacoes: string | null;
} | null;

let linhaExtracao: LinhaExtracao = null;
let linhaRascunho: LinhaRascunho = null;

function item(parcial: Partial<ItemExtraido> = {}): ItemExtraido {
  return {
    quantidade: 3,
    produtoMencionado: "Pilsen Hoffnung",
    unidadeMencionada: "caixas",
    embalagemMencionada: null,
    observacaoItem: null,
    problemas: [],
    ...parcial,
  };
}

function extracao(
  status: ResultadoExtracao["status"],
  itens: ItemExtraido[] = [],
  sinais: SinalExtracao[] = [],
): ResultadoExtracao {
  return {
    status,
    itens,
    observacaoPedido: null,
    desistenciaDetectada: false,
    confiancaIa: 0.95,
    sinais,
    modelo: "modelo-teste",
    versaoExtractor: "extractor-teste-v1",
    versaoPrompt: "prompt-teste-v1",
    extraidoEm: "2026-09-09T00:00:00.000Z",
    erro: null,
  };
}

async function importarServico() {
  const { criarServicoConstrucaoRascunho } = await import(
    "../src/integrations/botnext/botnext-pedido-rascunho-service.js"
  );
  return criarServicoConstrucaoRascunho;
}

function repoDe(dados: {
  produtos: ItemCatalogo[];
  cervejas: ItemCatalogo[];
  aliases?: never[];
}) {
  return criarCatalogoRepositoryEmMemoria({
    produtos: dados.produtos,
    cervejas: dados.cervejas,
    aliases: dados.aliases ?? [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  linhaExtracao = null;
  linhaRascunho = null;

  mocks.rascunhoFindUnique.mockImplementation(async () => linhaRascunho);
  mocks.rascunhoCreate.mockImplementation(
    async ({
      data,
    }: {
      data: {
        status: string;
        itens: unknown;
        totalItens: number;
        itensResolvidos: number;
        itensNaoResolvidos: number;
        observacoes: string | null;
      };
    }) => {
      linhaRascunho = {
        id: "rasc-1",
        status: data.status as BotnextPedidoRascunhoStatus,
        itens: data.itens,
        totalItens: data.totalItens,
        itensResolvidos: data.itensResolvidos,
        itensNaoResolvidos: data.itensNaoResolvidos,
        observacoes: data.observacoes,
      };
      return linhaRascunho;
    },
  );
  mocks.extracaoFindUnique.mockImplementation(async () => linhaExtracao);
});

describe("serviço de construção de rascunho BotNext (Etapa 3.0)", () => {
  it("#1 1 produto resolvido (vitória entre fontes) → RASCUNHO_CRIADO PRONTO", async () => {
    const criar = await importarServico();
    const servico = criar({ catalogo: repoDe(CATALOGO_PRODUTO_PRONT0) });
    linhaExtracao = {
      id: EXTRACAO_ID,
      itensExtraidos: extracao("EXTRAIDO", [
        item({ produtoMencionado: "cachaça premium", quantidade: 2 }),
      ]),
    };

    const r = await servico({ tenantId: TENANT_A, extracaoId: EXTRACAO_ID });

    expect(r.situacao).toBe("RASCUNHO_CRIADO");
    if (r.situacao === "RASCUNHO_CRIADO") {
      expect(r.status).toBe(BotnextPedidoRascunhoStatus.PRONTO);
      expect(r.totalItens).toBe(1);
      expect(r.itensResolvidos).toBe(1);
      expect(r.itensNaoResolvidos).toBe(0);
      expect(r.conteudo.itens[0]?.pendente).toBe(false);
      expect(r.conteudo.itens[0]?.resolucao?.fonteCatalogo).toBe("PRODUTO");
    }
    expect(mocks.rascunhoCreate).toHaveBeenCalledTimes(1);
  });

  it("#2 1 cerveja resolvida (vitória entre fontes) → RASCUNHO_CRIADO PRONTO", async () => {
    const criar = await importarServico();
    const servico = criar({ catalogo: repoDe(CATALOGO_CERVEJA_PRONTA) });
    linhaExtracao = {
      id: EXTRACAO_ID,
      itensExtraidos: extracao("EXTRAIDO", [
        item({ produtoMencionado: "pilsen hoffnung", quantidade: 1 }),
      ]),
    };

    const r = await servico({ tenantId: TENANT_A, extracaoId: EXTRACAO_ID });

    expect(r.situacao).toBe("RASCUNHO_CRIADO");
    if (r.situacao === "RASCUNHO_CRIADO") {
      expect(r.status).toBe(BotnextPedidoRascunhoStatus.PRONTO);
      expect(r.conteudo.itens[0]?.resolucao?.fonteCatalogo).toBe("CERVEJA");
      expect(r.conteudo.itens[0]?.resolucao?.arbrainId).toBe("arbC-c-pilsen");
    }
  });

  it("#3 produto com QUANTIDADE_AUSENTE → PENDENTE (status RASCUNHO)", async () => {
    const criar = await importarServico();
    const servico = criar({ catalogo: repoDe(CATALOGO_PRODUTO_PRONT0) });
    linhaExtracao = {
      id: EXTRACAO_ID,
      itensExtraidos: extracao("EXTRAIDO", [
        item({
          produtoMencionado: "cachaça premium",
          quantidade: null,
          problemas: ["QUANTIDADE_AUSENTE"],
        }),
      ]),
    };

    const r = await servico({ tenantId: TENANT_A, extracaoId: EXTRACAO_ID });

    expect(r.situacao).toBe("RASCUNHO_CRIADO");
    if (r.situacao === "RASCUNHO_CRIADO") {
      expect(r.status).toBe(BotnextPedidoRascunhoStatus.RASCUNHO);
      expect(r.conteudo.itens[0]?.pendente).toBe(true);
    }
  });

  it("#4 produto ausente → PENDENTE, item preservado, sem resolução", async () => {
    const criar = await importarServico();
    const servico = criar({ catalogo: repoDe(CATALOGO_VAZIO) });
    linhaExtracao = {
      id: EXTRACAO_ID,
      itensExtraidos: extracao("EXTRAIDO", [
        item({
          produtoMencionado: null,
          unidadeMencionada: null,
          problemas: ["PRODUTO_AUSENTE"],
        }),
      ]),
    };

    const r = await servico({ tenantId: TENANT_A, extracaoId: EXTRACAO_ID });

    expect(r.situacao).toBe("RASCUNHO_CRIADO");
    if (r.situacao === "RASCUNHO_CRIADO") {
      expect(r.status).toBe(BotnextPedidoRascunhoStatus.RASCUNHO);
      expect(r.conteudo.itens[0]?.resolucao).toBeNull();
      expect(r.conteudo.itens[0]?.produtoMencionado).toBeNull();
      expect(r.conteudo.itens[0]?.pendente).toBe(true);
    }
  });

  it("#5 resolução AMBIGUO → PENDENTE, candidatos persistidos", async () => {
    const criar = await importarServico();
    const servico = criar({ catalogo: repoDe(CATALOGO_AMBIGUO) });
    linhaExtracao = {
      id: EXTRACAO_ID,
      itensExtraidos: extracao("EXTRAIDO", [
        item({ produtoMencionado: "pilsen hoffnung", quantidade: 1 }),
      ]),
    };

    const r = await servico({ tenantId: TENANT_A, extracaoId: EXTRACAO_ID });

    expect(r.situacao).toBe("RASCUNHO_CRIADO");
    if (r.situacao === "RASCUNHO_CRIADO") {
      expect(r.status).toBe(BotnextPedidoRascunhoStatus.RASCUNHO);
      expect(r.conteudo.itens[0]?.resolucao?.status).toBe("AMBIGUO");
      expect(r.conteudo.itens[0]?.resolucao?.candidatos.length).toBe(2);
    }
  });

  it("#6 SEM_CORRESPONDENCIA → PENDENTE", async () => {
    const criar = await importarServico();
    const servico = criar({ catalogo: repoDe(CATALOGO_VAZIO) });
    linhaExtracao = {
      id: EXTRACAO_ID,
      itensExtraidos: extracao("EXTRAIDO", [
        item({ produtoMencionado: "produto que não existe", quantidade: 1 }),
      ]),
    };

    const r = await servico({ tenantId: TENANT_A, extracaoId: EXTRACAO_ID });

    expect(r.situacao).toBe("RASCUNHO_CRIADO");
    if (r.situacao === "RASCUNHO_CRIADO") {
      expect(r.status).toBe(BotnextPedidoRascunhoStatus.RASCUNHO);
      expect(r.conteudo.itens[0]?.resolucao?.status).toBe("SEM_CORRESPONDENCIA");
    }
  });

  it("#7 SEM_CONTEXTO_DE_FONTE (match de fonte única) → PENDENTE", async () => {
    const criar = await importarServico();
    const servico = criar({
      catalogo: repoDe({
        produtos: [],
        cervejas: [cerveja("c-pilsen", "Pilsen Hoffnung", 1)],
      }),
    });
    linhaExtracao = {
      id: EXTRACAO_ID,
      itensExtraidos: extracao("EXTRAIDO", [
        item({ produtoMencionado: "pilsen hoffnung", quantidade: 1 }),
      ]),
    };

    const r = await servico({ tenantId: TENANT_A, extracaoId: EXTRACAO_ID });

    expect(r.situacao).toBe("RASCUNHO_CRIADO");
    if (r.situacao === "RASCUNHO_CRIADO") {
      expect(r.status).toBe(BotnextPedidoRascunhoStatus.RASCUNHO);
      expect(r.conteudo.itens[0]?.resolucao?.status).toBe("RESOLVIDO");
      expect(r.conteudo.itens[0]?.resolucao?.sinais).toContain(
        "SEM_CONTEXTO_DE_FONTE",
      );
      expect(r.conteudo.itens[0]?.pendente).toBe(true);
    }
  });

  it("#8 múltiplos itens todos resolvidos sem pendência → PRONTO", async () => {
    const criar = await importarServico();
    const servico = criar({ catalogo: repoDe(CATALOGO_COMBINADO) });
    linhaExtracao = {
      id: EXTRACAO_ID,
      itensExtraidos: extracao("EXTRAIDO", [
        item({ produtoMencionado: "cachaça premium", quantidade: 2 }),
        item({ produtoMencionado: "pilsen hoffnung", quantidade: 1 }),
      ]),
    };

    const r = await servico({ tenantId: TENANT_A, extracaoId: EXTRACAO_ID });

    expect(r.situacao).toBe("RASCUNHO_CRIADO");
    if (r.situacao === "RASCUNHO_CRIADO") {
      expect(r.status).toBe(BotnextPedidoRascunhoStatus.PRONTO);
      expect(r.totalItens).toBe(2);
      expect(r.itensResolvidos).toBe(2);
      expect(r.conteudo.itens.every((i) => i.pendente === false)).toBe(true);
    }
  });

  it("#9 múltiplos itens com 1 pendência → PENDENTE", async () => {
    const criar = await importarServico();
    const servico = criar({ catalogo: repoDe(CATALOGO_COMBINADO) });
    linhaExtracao = {
      id: EXTRACAO_ID,
      itensExtraidos: extracao("EXTRAIDO", [
        item({ produtoMencionado: "cachaça premium", quantidade: 2 }),
        item({ produtoMencionado: "produto fantasma", quantidade: 1 }),
      ]),
    };

    const r = await servico({ tenantId: TENANT_A, extracaoId: EXTRACAO_ID });

    expect(r.situacao).toBe("RASCUNHO_CRIADO");
    if (r.situacao === "RASCUNHO_CRIADO") {
      expect(r.status).toBe(BotnextPedidoRascunhoStatus.RASCUNHO);
      expect(r.totalItens).toBe(2);
      expect(r.itensResolvidos).toBe(1);
      expect(r.itensNaoResolvidos).toBe(1);
    }
  });

  it.each([
    ["SEM_ITENS", extracao("SEM_ITENS", [])],
    ["REFERENCIA_SEM_CONTEUDO", extracao("REFERENCIA_SEM_CONTEUDO", [])],
    ["DESISTENCIA", extracao("DESISTENCIA", [])],
    ["FALHA_IA", extracao("FALHA_IA", [])],
  ])("#10/#11/#12/#13 %s → SEM_RASCUNHO, nada criado", async (_nome, resultado) => {
    const criar = await importarServico();
    const servico = criar({ catalogo: repoDe(CATALOGO_COMBINADO) });
    linhaExtracao = { id: EXTRACAO_ID, itensExtraidos: resultado };

    const r = await servico({ tenantId: TENANT_A, extracaoId: EXTRACAO_ID });

    expect(r).toMatchObject({
      situacao: "SEM_RASCUNHO",
      extracaoId: EXTRACAO_ID,
      statusExtracao: resultado.status,
    });
    expect(mocks.rascunhoCreate).not.toHaveBeenCalled();
  });

  it("#14 idempotência/reprocessamento → 2ª chamada JA_CRIADO, nada re-executado", async () => {
    const criar = await importarServico();
    const servico = criar({ catalogo: repoDe(CATALOGO_PRODUTO_PRONT0) });
    linhaExtracao = {
      id: EXTRACAO_ID,
      itensExtraidos: extracao("EXTRAIDO", [
        item({ produtoMencionado: "cachaça premium", quantidade: 2 }),
      ]),
    };

    const r1 = await servico({ tenantId: TENANT_A, extracaoId: EXTRACAO_ID });
    const r2 = await servico({ tenantId: TENANT_A, extracaoId: EXTRACAO_ID });

    expect(r1.situacao).toBe("RASCUNHO_CRIADO");
    expect(r2.situacao).toBe("JA_CRIADO");
    expect(mocks.rascunhoCreate).toHaveBeenCalledTimes(1);
    expect(mocks.extracaoFindUnique).toHaveBeenCalledTimes(1);
  });

  it("#15 corrida/P2002 → devolve o vencedor persistido (JA_CRIADO)", async () => {
    const criar = await importarServico();
    const servico = criar({ catalogo: repoDe(CATALOGO_CERVEJA_PRONTA) });
    linhaExtracao = {
      id: EXTRACAO_ID,
      itensExtraidos: extracao("EXTRAIDO", [
        item({ produtoMencionado: "pilsen hoffnung", quantidade: 1 }),
      ]),
    };

    // 1ª busca (idempotência) → null; create → P2002; 2ª busca → vencedor.
    let chamadasFind = 0;
    mocks.rascunhoFindUnique.mockImplementation(async () => {
      chamadasFind += 1;
      if (chamadasFind === 1) return null;
      return {
        id: "rasc-vencedor",
        status: BotnextPedidoRascunhoStatus.PRONTO,
        itens: {
          versao: "rascunho-v1",
          itens: [
            {
              quantidade: 1,
              produtoMencionado: "pilsen hoffnung",
              unidadeMencionada: "caixas",
              embalagemMencionada: null,
              observacaoItem: null,
              problemas: [],
              resolucao: {
                status: "RESOLVIDO",
                origemResolucao: "NOME_EXATO",
                fonteCatalogo: "CERVEJA",
                arbrainId: "arbC-c-pilsen",
                id: "c-pilsen",
                sku: 1,
                nome: "Pilsen Hoffnung",
                score: null,
                candidatos: [],
                sinais: [],
                motivo: "vencedor",
              },
              pendente: false,
            },
          ],
          sinaisExtracao: [],
        },
        totalItens: 1,
        itensResolvidos: 1,
        itensNaoResolvidos: 0,
        observacoes: null,
      };
    });
    mocks.rascunhoCreate.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError("Conflito unique", {
        code: "P2002",
        clientVersion: "6.12.0",
      });
    });

    const r = await servico({ tenantId: TENANT_A, extracaoId: EXTRACAO_ID });

    expect(r.situacao).toBe("JA_CRIADO");
    if (r.situacao === "JA_CRIADO") {
      expect(r.rascunhoId).toBe("rasc-vencedor");
      expect(r.status).toBe(BotnextPedidoRascunhoStatus.PRONTO);
    }
  });

  it("#16 tenant isolation: extração de outro tenant → erro, nada criado", async () => {
    const criar = await importarServico();
    const servico = criar({ catalogo: repoDe(CATALOGO_PRODUTO_PRONT0) });
    mocks.extracaoFindUnique.mockResolvedValue(null); // não achou no tenant B

    await expect(
      servico({ tenantId: TENANT_B, extracaoId: EXTRACAO_ID }),
    ).rejects.toThrow(/não encontrada no tenant/i);
    expect(mocks.rascunhoCreate).not.toHaveBeenCalled();
  });

  it("#17 determinismo do snapshot no serviço — mesma entrada, mesmo JSON", async () => {
    const criar = await importarServico();
    const catalogo = repoDe(CATALOGO_CERVEJA_PRONTA);
    const servico = criar({ catalogo });
    const linha1 = {
      id: EXTRACAO_ID,
      itensExtraidos: extracao("EXTRAIDO", [
        item({ produtoMencionado: "pilsen hoffnung", quantidade: 1 }),
      ]),
    };
    linhaExtracao = linha1;

    const a = await servico({ tenantId: TENANT_A, extracaoId: EXTRACAO_ID });
    vi.clearAllMocks();
    linhaRascunho = null;
    linhaExtracao = { ...linha1, id: "outro-id" };
    mocks.rascunhoFindUnique.mockImplementation(async () => linhaRascunho);
    mocks.rascunhoCreate.mockImplementation(
      async ({ data }: { data: { status: string; itens: unknown } }) => {
        linhaRascunho = {
          id: "rasc-2",
          status: data.status as BotnextPedidoRascunhoStatus,
          itens: data.itens,
          totalItens: 1,
          itensResolvidos: 1,
          itensNaoResolvidos: 0,
          observacoes: null,
        };
        return linhaRascunho;
      },
    );
    mocks.extracaoFindUnique.mockImplementation(async () => linhaExtracao);

    const b = await servico({ tenantId: TENANT_A, extracaoId: "outro-id" });

    if (a.situacao === "RASCUNHO_CRIADO" && b.situacao === "RASCUNHO_CRIADO") {
      expect(JSON.stringify(a.conteudo)).toBe(JSON.stringify(b.conteudo));
    } else {
      throw new Error("Esperava RASCUNHO_CRIADO nas duas execuções.");
    }
  });

  it("#18/#19 snapshot sem campos não resolvidos; nem dispatch configurado", async () => {
    const criar = await importarServico();
    const servico = criar({ catalogo: repoDe(CATALOGO_PRODUTO_PRONT0) });
    linhaExtracao = {
      id: EXTRACAO_ID,
      itensExtraidos: extracao("EXTRAIDO", [
        item({ produtoMencionado: "cachaça premium", quantidade: 2 }),
      ]),
    };

    await servico({ tenantId: TENANT_A, extracaoId: EXTRACAO_ID });
    const conteudo = JSON.stringify(
      mocks.rascunhoCreate.mock.calls[0]?.[0]?.data,
    );

    for (const campo of [
      "idEmbalagem",
      "idUnidade",
      "valorUnitario",
      "preco",
      "contrato",
      // dispatch não é configurado nesta etapa:
      "dispatchKey",
      "dispatchToken",
      "dispatchLeaseUntil",
      "dispatchedAt",
    ]) {
      expect(conteudo ?? "").not.toContain(campo);
    }
  });

  it("#20 processor delega o pedido exclusivamente ao fluxo (Etapa 3.2)", () => {
    const fonte = readFileSync(
      new URL(
        "../src/integrations/botnext/botnext-webhook-processor.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(fonte).toMatch(/processarFluxoPedidoBotnext/);
    expect(fonte).toMatch(/botnext-pedido-flow-service/);
    expect(fonte).not.toMatch(/botnext-pedido-rascunho-service/);
    expect(fonte).not.toMatch(/criarServicoConstrucaoRascunho/);
    expect(fonte).not.toMatch(/criarServicoConfirmacaoRascunho/);
    expect(fonte).not.toMatch(/criarServicoDispatchPedido/);
  });
});