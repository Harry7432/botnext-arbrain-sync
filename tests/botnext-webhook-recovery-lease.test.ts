import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const EVENTO_ID = "10000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  enfileirar: vi.fn(),
  falharNoLimite: vi.fn(),
}));

vi.mock("../src/database/prisma.js", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
  },
}));
vi.mock("../src/queue/botnext-webhook-queue.js", () => ({
  enfileirarEventoBotnext: mocks.enfileirar,
}));
vi.mock("../src/queue/botnext-processing-recovery.js", () => ({
  falharEventoBotnextRecebidoNoLimite: mocks.falharNoLimite,
}));

type EstadoEnqueue = {
  elegivel: boolean;
  reservado: boolean;
  token: string | null;
  enqueuedAt: boolean;
  noLimite: boolean;
};

function instalarFake(estado: EstadoEnqueue): void {
  mocks.queryRaw.mockImplementation(
    async (
      strings: TemplateStringsArray,
      ...valores: unknown[]
    ): Promise<Array<{ id: string }>> => {
      const sql = strings.join("?");

      if (
        sql.includes("SELECT") &&
        sql.includes('"processing_attempts" >=')
      ) {
        return estado.noLimite ? [{ id: EVENTO_ID }] : [];
      }

      if (
        sql.includes("SELECT") &&
        sql.includes('"processing_attempts" <')
      ) {
        return estado.elegivel && !estado.reservado
          ? [{ id: EVENTO_ID }]
          : [];
      }

      if (sql.includes('SET\n          "enqueue_token"')) {
        const [token] = valores as [string];

        if (!estado.elegivel || estado.reservado) {
          return [];
        }

        estado.reservado = true;
        estado.token = token;
        return [{ id: EVENTO_ID }];
      }

      if (sql.includes('SET "enqueued_at" = NOW()')) {
        const [, token] = valores as [string, string];

        if (estado.token !== token) {
          return [];
        }

        estado.enqueuedAt = true;
        return [{ id: EVENTO_ID }];
      }

      throw new Error(`SQL não reconhecido pelo fake: ${sql}`);
    },
  );
}

describe("recovery RECEIVED com enqueue lease", () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
    mocks.enfileirar.mockReset();
    mocks.falharNoLimite.mockReset();
    mocks.enfileirar.mockResolvedValue(undefined);
    mocks.falharNoLimite.mockResolvedValue("FAILED");
  });

  it("reserva enqueue lease e confirma enqueuedAt após publicação", async () => {
    const estado: EstadoEnqueue = {
      elegivel: true,
      reservado: false,
      token: null,
      enqueuedAt: false,
      noLimite: false,
    };
    instalarFake(estado);
    const { recuperarEventosBotnextPendentes } =
      await import("../src/queue/botnext-webhook-recovery.js");

    const resultado = await recuperarEventosBotnextPendentes();

    expect(resultado.enfileirados).toBe(1);
    expect(estado.enqueuedAt).toBe(true);
    expect(mocks.enfileirar).toHaveBeenCalledWith(
      EVENTO_ID,
      expect.any(String),
    );
  });

  it("duas varreduras concorrentes obtêm somente uma reserva", async () => {
    const estado: EstadoEnqueue = {
      elegivel: true,
      reservado: false,
      token: null,
      enqueuedAt: false,
      noLimite: false,
    };
    instalarFake(estado);
    const { recuperarEventosBotnextPendentes } =
      await import("../src/queue/botnext-webhook-recovery.js");

    await Promise.all([
      recuperarEventosBotnextPendentes(),
      recuperarEventosBotnextPendentes(),
    ]);

    expect(mocks.enfileirar).toHaveBeenCalledOnce();
  });

  it("falha de publicação mantém lease e permite nova tentativa após expiração", async () => {
    const estado: EstadoEnqueue = {
      elegivel: true,
      reservado: false,
      token: null,
      enqueuedAt: false,
      noLimite: false,
    };
    instalarFake(estado);
    mocks.enfileirar
      .mockRejectedValueOnce(new Error("Redis indisponível"))
      .mockResolvedValueOnce(undefined);
    const { recuperarEventosBotnextPendentes } =
      await import("../src/queue/botnext-webhook-recovery.js");

    const primeira = await recuperarEventosBotnextPendentes();
    const tokenAnterior = estado.token;
    const duranteLease = await recuperarEventosBotnextPendentes();
    estado.reservado = false;
    const depoisDaExpiracao = await recuperarEventosBotnextPendentes();

    expect(primeira.falhas).toBe(1);
    expect(duranteLease.enfileirados).toBe(0);
    expect(depoisDaExpiracao.enfileirados).toBe(1);
    expect(estado.token).not.toBe(tokenAnterior);
  });

  it("move RECEIVED no limite para FAILED e não publica", async () => {
    const estado: EstadoEnqueue = {
      elegivel: false,
      reservado: false,
      token: null,
      enqueuedAt: false,
      noLimite: true,
    };
    instalarFake(estado);
    const { recuperarEventosBotnextPendentes } =
      await import("../src/queue/botnext-webhook-recovery.js");

    const resultado = await recuperarEventosBotnextPendentes();

    expect(resultado.falhadosPorLimite).toBe(1);
    expect(mocks.enfileirar).not.toHaveBeenCalled();
  });
});
