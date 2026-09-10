import { describe, expect, it } from "vitest";

import {
  calcularDispatchKey,
} from "../src/pedidos/pedido-confirmado/dispatch-key.js";
import {
  montarPayloadPedidoConfirmadoV1,
} from "../src/pedidos/pedido-confirmado/payload-pedido-confirmado.js";
import {
  paraItemPedidoConfirmado,
  type ConfirmacaoRascunho,
  type PedidoConfirmadoV1,
} from "../src/pedidos/pedido-confirmado/tipos.js";
import type { ItemRascunho } from "../src/pedidos/rascunho/tipos.js";

const TENANT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const CONVERSAO_ID = "c0000000-0000-4000-8000-0000000000cc";
const EXTRACAO_ID = "e0000000-0000-4000-8000-0000000000aa";
const RASCUNHO_ID = "r0000000-0000-4000-8000-0000000000rr";
const CONFIRMACAO: ConfirmacaoRascunho = {
  confirmadoEm: "2026-09-09T12:00:00.000Z",
  dispatchKey: "abc",
};

function itemRascunho(
  parcial: Partial<ItemRascunho> = {},
): ItemRascunho {
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

function payloadDe(itens: ItemRascunho[], revision = 1): PedidoConfirmadoV1 {
  return montarPayloadPedidoConfirmadoV1({
    tenantId: TENANT_ID,
    conversationId: CONVERSAO_ID,
    extracaoId: EXTRACAO_ID,
    rascunhoId: RASCUNHO_ID,
    revision,
    confirmacao: CONFIRMACAO,
    clienteArbrainId: "arb-cliente-1",
    itens,
  });
}

describe("PEDIDO_CONFIRMADO_V1 — shape do contrato e determinismo", () => {
  it("#1 contrato: version/tipoEvento/campos básicos exatos", () => {
    const payload = payloadDe([itemRascunho()]);

    expect(payload.version).toBe("1");
    expect(payload.tipoEvento).toBe("PEDIDO_CONFIRMADO");
    expect(payload.dispatchKey).toBe(CONFIRMACAO.dispatchKey);
    expect(payload.tenantId).toBe(TENANT_ID);
    expect(payload.conversationId).toBe(CONVERSAO_ID);
    expect(payload.extracaoId).toBe(EXTRACAO_ID);
    expect(payload.rascunhoId).toBe(RASCUNHO_ID);
    expect(payload.revision).toBe(1);
    expect(payload.confirmadoEm).toBe(CONFIRMACAO.confirmadoEm);
    expect(payload.cliente).toEqual({ arbrainId: "arb-cliente-1" });
  });

  it("#2 campos ArBrain ainda desconhecidos permanecem null", () => {
    const payload = payloadDe([itemRascunho()]);
    const item = payload.itens[0]!;

    expect(item.idEmbalagem).toBeNull();
    expect(item.idUnidade).toBeNull();
    expect(item.tipoLinha).toBeNull();
    expect(item.valorUnitario).toBeNull();
  });

  it("#3 cliente.arbrainId null é permitido pelo contrato", () => {
    const payload = montarPayloadPedidoConfirmadoV1({
      tenantId: TENANT_ID,
      conversationId: CONVERSAO_ID,
      extracaoId: EXTRACAO_ID,
      rascunhoId: RASCUNHO_ID,
      revision: 1,
      confirmacao: CONFIRMACAO,
      clienteArbrainId: null,
      itens: [itemRascunho()],
    });

    expect(payload.cliente.arbrainId).toBeNull();
  });

  it("#4 item preserva menção original completa", () => {
    const payload = payloadDe([
      itemRascunho({
        quantidade: 3,
        produtoMencionado: "pilsen hoffnung",
        unidadeMencionada: "fardo",
        embalagemMencionada: "pack 6",
        observacaoItem: "bem gelada",
      }),
    ]);
    const item = payload.itens[0]!;

    expect(item.quantidade).toBe(3);
    expect(item.produtoMencionado).toBe("pilsen hoffnung");
    expect(item.unidadeMencionada).toBe("fardo");
    expect(item.embalagemMencionada).toBe("pack 6");
    expect(item.observacaoItem).toBe("bem gelada");
  });

  it("#5 resolucao espelha snapshot sem campos internos", () => {
    const payload = payloadDe([itemRascunho()]);
    const resolucao = payload.itens[0]!.resolucao;

    expect(resolucao).toEqual({
      status: "RESOLVIDO",
      fonteCatalogo: "PRODUTO",
      arbrainId: "arbP-p-cachaca",
      id: "p-cachaca",
      sku: 9,
      nome: "Cachaça Premium",
      origemResolucao: "NOME_EXATO",
      score: null,
    });
  });

  it("#6 payload externo NÃO inclui campos internos (problemas/pendente/sinais/candidatos/motivo)", () => {
    const serializado = JSON.stringify(payloadDe([itemRascunho()]));

    for (const campo of [
      "problemas",
      "pendente",
      "candidatos",
      "sinais",
      "motivo",
    ]) {
      expect(serializado).not.toContain(campo);
    }
  });

  it("#7 payload byte-idêntico para os mesmos itens", () => {
    const a = payloadDe([itemRascunho(), itemRascunho({ produtoMencionado: "pilsen" })]);
    const b = payloadDe([itemRascunho({ produtoMencionado: "pilsen" }), itemRascunho()]);

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("#8 itens ordenados deterministicamente independe da ordem de entrada", () => {
    const a = payloadDe([itemRascunho(), itemRascunho({ produtoMencionado: "pilsen" })]);
    expect(JSON.stringify(a.itens.map((i) => i.produtoMencionado))).toBe(
      JSON.stringify(["cachaça premium", "pilsen"]),
    );
  });

  it("#9 revision diferente → payload difere", () => {
    const a = payloadDe([itemRascunho()], 1);
    const b = payloadDe([itemRascunho()], 2);

    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe("dispatchKey — idempotência determinística", () => {
  function chave(itens: ItemRascunho[], revision = 1, alteracoes: Partial<Record<string, unknown>> = {}) {
    return calcularDispatchKey({
      tenantId: TENANT_ID,
      conversationId: CONVERSAO_ID,
      extracaoId: EXTRACAO_ID,
      rascunhoId: RASCUNHO_ID,
      revision,
      itens: itens.map(paraItemPedidoConfirmado),
      ...alteracoes,
    });
  }

  it("#10 mesmo pedido → mesma chave", () => {
    expect(chave([itemRascunho()])).toBe(chave([itemRascunho()]));
  });

  it("#11 retry → mesma chave (itens em ordem diferente)", () => {
    const itens = [itemRascunho(), itemRascunho({ produtoMencionado: "pilsen" })];
    const a = chave(itens);
    const b = chave([itens[1]!, itens[0]!]);
    expect(a).toBe(b);
  });

  it("#12 revision diferente → chave diferente", () => {
    expect(chave([itemRascunho()], 1)).not.toBe(
      chave([itemRascunho()], 2),
    );
  });

  it("#13 conteúdo do item diferente → chave diferente", () => {
    expect(chave([itemRascunho()])).not.toBe(
      chave([itemRascunho({ quantidade: 5 })]),
    );
  });

  it("#14 chave é sha256 hex de 64 caracteres", () => {
    const chave1 = chave([itemRascunho()]);
    expect(chave1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("#15 chave não depende de timestamp/aleatoriedade", () => {
    const a = chave([itemRascunho()]);
    const b = chave([itemRascunho()]);
    expect(a).toBe(b);
  });
});