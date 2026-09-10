import { beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  criarServicoCancelamentoRascunho,
} from "../src/integrations/botnext/botnext-pedido-cancelamento-service.js";

const TENANT = "tenant-1";
const RASCUNHO_ID = "rascunho-1";

function linha(status: string, revision = 2) {
  return {
    id: RASCUNHO_ID,
    tenantId: TENANT,
    status,
    revision,
    itens: {
      versao: "rascunho-v1",
      itens: [],
      sinaisExtracao: [],
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rascunhoUpdateMany.mockResolvedValue({ count: 1 });
});

describe("criarServicoCancelamentoRascunho (Etapa 3.2)", () => {
  it("RASCUNHO → CANCELADO, persiste cancelamento.canceladoEm com CAS", async () => {
    mocks.rascunhoFindFirst.mockResolvedValue(linha("RASCUNHO", 5));
    const servico = criarServicoCancelamentoRascunho();

    const r = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID });

    expect(r).toMatchObject({ situacao: "CANCELADO", revision: 6 });
    expect((r as any).canceladoEm).toBeTruthy();
    expect(mocks.rascunhoUpdateMany).toHaveBeenCalledTimes(1);
    const args = mocks.rascunhoUpdateMany.mock.calls[0]?.[0];
    expect(args?.where).toMatchObject({ id: RASCUNHO_ID, tenantId: TENANT, revision: 5, status: "RASCUNHO" });
    expect(args?.data?.status).toBe("CANCELADO");
    expect(args?.data?.itens?.cancelamento?.canceladoEm).toBeTruthy();
    expect(args?.data?.revision?.increment).toBe(1);
  });

  it("PRONTO → CANCELADO", async () => {
    mocks.rascunhoFindFirst.mockResolvedValue(linha("PRONTO"));
    const servico = criarServicoCancelamentoRascunho();

    const r = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID });

    expect(r.situacao).toBe("CANCELADO");
  });

  it("já CANCELADO → JA_CANCELADO sem resetar nada", async () => {
    mocks.rascunhoFindFirst.mockResolvedValue(linha("CANCELADO", 7));
    const servico = criarServicoCancelamentoRascunho();

    const r = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID });

    expect(r).toEqual({ situacao: "JA_CANCELADO", rascunhoId: RASCUNHO_ID, revision: 7 });
    expect(mocks.rascunhoUpdateMany).not.toHaveBeenCalled();
  });

  it("CONFIRMADO/DESPACHADO/FALHOU → NAO_CANCELAVEL com motivo", async () => {
    const servico = criarServicoCancelamentoRascunho();

    mocks.rascunhoFindFirst.mockResolvedValue(linha("CONFIRMADO"));
    expect(await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID })).toMatchObject({
      situacao: "NAO_CANCELAVEL",
      motivo: "JA_CONFIRMADO",
    });

    mocks.rascunhoFindFirst.mockResolvedValue(linha("DESPACHADO"));
    expect(await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID })).toMatchObject({
      situacao: "NAO_CANCELAVEL",
      motivo: "JA_DESPACHADO",
    });

    mocks.rascunhoFindFirst.mockResolvedValue(linha("FALHOU"));
    expect(await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID })).toMatchObject({
      situacao: "NAO_CANCELAVEL",
      motivo: "RASCUNHO_FALHOU",
    });

    expect(mocks.rascunhoUpdateMany).not.toHaveBeenCalled();
  });

  it("corrida: perde o CAS mas o rascunho já ficou CANCELADO → JA_CANCELADO", async () => {
    mocks.rascunhoFindFirst
      .mockResolvedValueOnce(linha("RASCUNHO", 5))
      .mockResolvedValueOnce(linha("CANCELADO", 6));
    mocks.rascunhoUpdateMany.mockResolvedValue({ count: 0 });
    const servico = criarServicoCancelamentoRascunho();

    const r = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID });

    expect(r).toEqual({ situacao: "JA_CANCELADO", rascunhoId: RASCUNHO_ID, revision: 6 });
  });

  it("corrida: rascunho confirmado por outro worker → NAO_CANCELAVEL/JA_CONFIRMADO", async () => {
    mocks.rascunhoFindFirst
      .mockResolvedValueOnce(linha("RASCUNHO", 5))
      .mockResolvedValueOnce(linha("CONFIRMADO", 6));
    mocks.rascunhoUpdateMany.mockResolvedValue({ count: 0 });
    const servico = criarServicoCancelamentoRascunho();

    const r = await servico({ tenantId: TENANT, rascunhoId: RASCUNHO_ID });

    expect(r).toMatchObject({ situacao: "NAO_CANCELAVEL", motivo: "JA_CONFIRMADO" });
  });

  it("rascunho de outro tenant → erro", async () => {
    mocks.rascunhoFindFirst.mockResolvedValue(null);
    const servico = criarServicoCancelamentoRascunho();

    await expect(
      servico({ tenantId: "outro-tenant", rascunhoId: RASCUNHO_ID }),
    ).rejects.toThrow(/não encontrado/i);
    expect(mocks.rascunhoUpdateMany).not.toHaveBeenCalled();
  });
});