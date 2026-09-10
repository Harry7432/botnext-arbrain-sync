import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type EstadoEvento = {
  id: string;
  status: "RECEIVED" | "PROCESSING" | "PROCESSED" | "IGNORED" | "FAILED";
  processingToken: string | null;
  processingWorker: string | null;
  processingLeaseUntil: Date | null;
  processingAttempts: number;
  enqueueToken: string | null;
  enqueueLeaseUntil: Date | null;
  processedAt: Date | null;
  errorMessage: string | null;
  clienteId: string | null;
};

const EVENTO_ID = "10000000-0000-4000-8000-000000000001";
const TOKEN_ATUAL = "20000000-0000-4000-8000-000000000002";
const TOKEN_ANTIGO = "30000000-0000-4000-8000-000000000003";
const CLIENTE_ID = "40000000-0000-4000-8000-000000000004";
const AGORA = new Date("2026-09-08T12:00:00.000Z");

const fake = vi.hoisted(() => ({
  estado: null as EstadoEvento | null,
  queryRaw: vi.fn(),
}));

vi.mock("../src/database/prisma.js", () => ({
  prisma: {
    $queryRaw: fake.queryRaw,
  },
}));

function criarEstado(
  parcial: Partial<EstadoEvento> = {},
): EstadoEvento {
  const estado: EstadoEvento = {
    id: EVENTO_ID,
    status: "RECEIVED",
    processingToken: null,
    processingWorker: null,
    processingLeaseUntil: null,
    processingAttempts: 0,
    enqueueToken: null,
    enqueueLeaseUntil: null,
    processedAt: null,
    errorMessage: null,
    clienteId: null,
    ...parcial,
  };

  if (
    estado.status === "PROCESSING" &&
    !("processingLeaseUntil" in parcial)
  ) {
    estado.processingLeaseUntil =
      new Date(AGORA.getTime() + 60_000);
  }

  return estado;
}

function instalarBancoFake(): void {
  fake.queryRaw.mockImplementation(
    async (
      strings: TemplateStringsArray,
      ...valores: unknown[]
    ): Promise<Array<Record<string, unknown>>> => {
      const sql = strings.join("?");
      const estado = fake.estado;

      if (!estado) {
        return [];
      }

      if (sql.includes('"processing_attempts" = "processing_attempts" + 1')) {
        const [token, worker, duracaoLease, eventoId, maximoTentativas] =
          valores as [string, string, number, string, number];

        if (
          estado.id !== eventoId ||
          estado.status !== "RECEIVED" ||
          estado.processingAttempts >= maximoTentativas
        ) {
          return [];
        }

        estado.status = "PROCESSING";
        estado.processingToken = token;
        estado.processingWorker = worker;
        estado.processingLeaseUntil = new Date(
          AGORA.getTime() + duracaoLease,
        );
        estado.processingAttempts += 1;
        estado.enqueueToken = null;
        estado.enqueueLeaseUntil = null;
        estado.processedAt = null;
        estado.errorMessage = null;

        return [{
          id: estado.id,
          processingAttempts: estado.processingAttempts,
        }];
      }

      if (sql.includes('SET\n      "processing_lease_until" = NOW()')) {
        const [duracaoLease, eventoId, token] =
          valores as [number, string, string];

        if (
          estado.id !== eventoId ||
          estado.status !== "PROCESSING" ||
          estado.processingToken !== token ||
          estado.processingLeaseUntil === null ||
          estado.processingLeaseUntil.getTime() < AGORA.getTime()
        ) {
          return [];
        }

        estado.processingLeaseUntil = new Date(
          AGORA.getTime() + duracaoLease,
        );

        return [{ id: estado.id }];
      }

      if (sql.includes("'PROCESSED'")) {
        const [clienteId, eventoId, token] =
          valores as [string, string, string];

        if (!possuiPosse(estado, eventoId, token)) {
          return [];
        }

        estado.status = "PROCESSED";
        estado.clienteId = clienteId;
        limparLeases(estado);

        return [{ id: estado.id }];
      }

      if (sql.includes("'IGNORED'")) {
        const [motivo, eventoId, token] =
          valores as [string, string, string];

        if (!possuiPosse(estado, eventoId, token)) {
          return [];
        }

        estado.status = "IGNORED";
        estado.errorMessage = motivo;
        limparLeases(estado);

        return [{ id: estado.id }];
      }

      if (
        sql.includes("Falha desconhecida no processamento") ||
        sql.includes('"error_message" = ?')
      ) {
        const [maximoTentativas, , mensagem, eventoId, token] =
          valores as [number, number, string, string, string];

        if (!possuiPosse(estado, eventoId, token)) {
          return [];
        }

        estado.status = estado.processingAttempts < maximoTentativas
          ? "RECEIVED"
          : "FAILED";
        estado.errorMessage = mensagem;
        limparLeases(estado);

        return [{ status: estado.status }];
      }

      if (sql.includes("após lease expirada")) {
        const [maximoTentativas, , , eventoId, margemExpiracao] =
          valores as [number, number, number, string, number];
        const abandonado =
          estado.processingToken === null ||
          estado.processingLeaseUntil === null ||
          estado.processingLeaseUntil.getTime() <
            AGORA.getTime() - margemExpiracao;

        if (
          estado.id !== eventoId ||
          estado.status !== "PROCESSING" ||
          !abandonado
        ) {
          return [];
        }

        estado.status = estado.processingAttempts < maximoTentativas
          ? "RECEIVED"
          : "FAILED";
        limparLeases(estado);

        return [{ status: estado.status }];
      }

      if (sql.includes("antes de nova reivindicação")) {
        const [eventoId, maximoTentativas] =
          valores as [string, number];

        if (
          estado.id !== eventoId ||
          estado.status !== "RECEIVED" ||
          estado.processingAttempts < maximoTentativas
        ) {
          return [];
        }

        estado.status = "FAILED";
        limparLeases(estado);

        return [{ id: estado.id }];
      }

      throw new Error(`SQL não reconhecido pelo fake: ${sql}`);
    },
  );
}

function possuiPosse(
  estado: EstadoEvento,
  eventoId: string,
  token: string,
): boolean {
  return estado.id === eventoId &&
    estado.status === "PROCESSING" &&
    estado.processingToken === token &&
    estado.processingLeaseUntil !== null &&
    estado.processingLeaseUntil.getTime() >= AGORA.getTime();
}

function limparLeases(estado: EstadoEvento): void {
  estado.processingToken = null;
  estado.processingWorker = null;
  estado.processingLeaseUntil = null;
  estado.enqueueToken = null;
  estado.enqueueLeaseUntil = null;
  estado.processedAt = AGORA;
}

describe("infraestrutura de lease BotNext", () => {
  beforeEach(() => {
    fake.queryRaw.mockReset();
    fake.estado = criarEstado();
    instalarBancoFake();
  });

  it("faz claim de RECEIVED abaixo do limite e incrementa attempts uma vez", async () => {
    const { reivindicarEventoBotnext } =
      await import("../src/queue/botnext-processing-lease-service.js");

    const resultado = await reivindicarEventoBotnext({
      eventoId: EVENTO_ID,
      processingToken: TOKEN_ATUAL,
      processingWorker: "worker-a",
      duracaoLeaseMs: 60_000,
      maximoTentativas: 5,
    });

    expect(resultado).toEqual({
      situacao: "ADQUIRIDO",
      processingToken: TOKEN_ATUAL,
      processingAttempts: 1,
    });
    expect(fake.estado?.processingAttempts).toBe(1);
  });

  it("permite apenas um vencedor em dois claims concorrentes", async () => {
    const { reivindicarEventoBotnext } =
      await import("../src/queue/botnext-processing-lease-service.js");

    const resultados = await Promise.all([
      reivindicarEventoBotnext({
        eventoId: EVENTO_ID,
        processingToken: TOKEN_ATUAL,
        processingWorker: "worker-a",
        duracaoLeaseMs: 60_000,
        maximoTentativas: 5,
      }),
      reivindicarEventoBotnext({
        eventoId: EVENTO_ID,
        processingToken: TOKEN_ANTIGO,
        processingWorker: "worker-b",
        duracaoLeaseMs: 60_000,
        maximoTentativas: 5,
      }),
    ]);

    expect(resultados.filter(
      (resultado) => resultado.situacao === "ADQUIRIDO",
    )).toHaveLength(1);
    expect(fake.estado?.processingAttempts).toBe(1);
  });

  it("renova heartbeat somente com o token correto", async () => {
    const { renovarLeaseEventoBotnext } =
      await import("../src/queue/botnext-processing-lease-service.js");
    fake.estado = criarEstado({
      status: "PROCESSING",
      processingToken: TOKEN_ATUAL,
      processingLeaseUntil: new Date(AGORA.getTime() + 1_000),
    });

    await expect(renovarLeaseEventoBotnext({
      eventoId: EVENTO_ID,
      processingToken: TOKEN_ATUAL,
      duracaoLeaseMs: 60_000,
    })).resolves.toBe("RENOVADA");
    expect(fake.estado.processingLeaseUntil).toEqual(
      new Date(AGORA.getTime() + 60_000),
    );

    await expect(renovarLeaseEventoBotnext({
      eventoId: EVENTO_ID,
      processingToken: TOKEN_ANTIGO,
      duracaoLeaseMs: 60_000,
    })).resolves.toBe("LEASE_LOST");
  });

  it("finaliza PROCESSED somente com posse atual", async () => {
    const { finalizarEventoBotnextProcessado } =
      await import("../src/queue/botnext-processing-lease-service.js");
    fake.estado = criarEstado({
      status: "PROCESSING",
      processingToken: TOKEN_ATUAL,
    });

    await expect(finalizarEventoBotnextProcessado({
      eventoId: EVENTO_ID,
      processingToken: TOKEN_ATUAL,
      clienteId: CLIENTE_ID,
    })).resolves.toBe("CONCLUIDO");
    expect(fake.estado).toMatchObject({
      status: "PROCESSED",
      clienteId: CLIENTE_ID,
      processingToken: null,
      processingWorker: null,
      processingLeaseUntil: null,
    });
  });

  it("finaliza IGNORED somente com posse atual", async () => {
    const { finalizarEventoBotnextIgnorado } =
      await import("../src/queue/botnext-processing-lease-service.js");
    fake.estado = criarEstado({
      status: "PROCESSING",
      processingToken: TOKEN_ATUAL,
    });

    await expect(finalizarEventoBotnextIgnorado({
      eventoId: EVENTO_ID,
      processingToken: TOKEN_ATUAL,
      motivo: "CLIENTE_NAO_ENCONTRADO",
    })).resolves.toBe("CONCLUIDO");
    expect(fake.estado).toMatchObject({
      status: "IGNORED",
      errorMessage: "CLIENTE_NAO_ENCONTRADO",
      processingToken: null,
    });
  });

  it("worker antigo não finaliza nem registra falha", async () => {
    const {
      finalizarEventoBotnextProcessado,
      registrarFalhaEventoBotnextComPosse,
    } = await import("../src/queue/botnext-processing-lease-service.js");
    fake.estado = criarEstado({
      status: "PROCESSING",
      processingToken: TOKEN_ATUAL,
      processingAttempts: 2,
    });

    await expect(finalizarEventoBotnextProcessado({
      eventoId: EVENTO_ID,
      processingToken: TOKEN_ANTIGO,
      clienteId: CLIENTE_ID,
    })).resolves.toBe("LEASE_LOST");
    await expect(registrarFalhaEventoBotnextComPosse({
      eventoId: EVENTO_ID,
      processingToken: TOKEN_ANTIGO,
      error: new Error("erro antigo"),
      maximoTentativas: 5,
    })).resolves.toBe("LEASE_LOST");
    expect(fake.estado).toMatchObject({
      status: "PROCESSING",
      processingToken: TOKEN_ATUAL,
    });
  });

  it("token correto com lease expirada também perde a posse", async () => {
    const {
      finalizarEventoBotnextProcessado,
      registrarFalhaEventoBotnextComPosse,
      renovarLeaseEventoBotnext,
    } = await import("../src/queue/botnext-processing-lease-service.js");
    fake.estado = criarEstado({
      status: "PROCESSING",
      processingToken: TOKEN_ATUAL,
      processingLeaseUntil: new Date(AGORA.getTime() - 1),
      processingAttempts: 2,
    });

    await expect(renovarLeaseEventoBotnext({
      eventoId: EVENTO_ID,
      processingToken: TOKEN_ATUAL,
      duracaoLeaseMs: 60_000,
    })).resolves.toBe("LEASE_LOST");
    await expect(finalizarEventoBotnextProcessado({
      eventoId: EVENTO_ID,
      processingToken: TOKEN_ATUAL,
      clienteId: CLIENTE_ID,
    })).resolves.toBe("LEASE_LOST");
    await expect(registrarFalhaEventoBotnextComPosse({
      eventoId: EVENTO_ID,
      processingToken: TOKEN_ATUAL,
      error: new Error("erro tardio"),
      maximoTentativas: 5,
    })).resolves.toBe("LEASE_LOST");
    expect(fake.estado.status).toBe("PROCESSING");
  });

  it("erro abaixo do limite volta para RECEIVED sem incrementar attempts", async () => {
    const { registrarFalhaEventoBotnextComPosse } =
      await import("../src/queue/botnext-processing-lease-service.js");
    fake.estado = criarEstado({
      status: "PROCESSING",
      processingToken: TOKEN_ATUAL,
      processingAttempts: 2,
    });

    await expect(registrarFalhaEventoBotnextComPosse({
      eventoId: EVENTO_ID,
      processingToken: TOKEN_ATUAL,
      error: new Error("Falha temporária"),
      maximoTentativas: 5,
    })).resolves.toBe("RECEIVED");
    expect(fake.estado.processingAttempts).toBe(2);
  });

  it("erro no limite vira FAILED", async () => {
    const { registrarFalhaEventoBotnextComPosse } =
      await import("../src/queue/botnext-processing-lease-service.js");
    fake.estado = criarEstado({
      status: "PROCESSING",
      processingToken: TOKEN_ATUAL,
      processingAttempts: 5,
    });

    await expect(registrarFalhaEventoBotnextComPosse({
      eventoId: EVENTO_ID,
      processingToken: TOKEN_ATUAL,
      error: new Error("Falha definitiva"),
      maximoTentativas: 5,
    })).resolves.toBe("FAILED");
  });

  it("recupera lease vencida abaixo do limite sem incrementar attempts", async () => {
    const { recuperarEventoBotnextAbandonado } =
      await import("../src/queue/botnext-processing-recovery.js");
    fake.estado = criarEstado({
      status: "PROCESSING",
      processingToken: TOKEN_ATUAL,
      processingLeaseUntil: new Date(AGORA.getTime() - 60_000),
      processingAttempts: 2,
    });

    await expect(recuperarEventoBotnextAbandonado({
      eventoId: EVENTO_ID,
      maximoTentativas: 5,
    })).resolves.toBe("RECEIVED");
    expect(fake.estado.processingAttempts).toBe(2);
  });

  it("recupera lease vencida no limite como FAILED", async () => {
    const { recuperarEventoBotnextAbandonado } =
      await import("../src/queue/botnext-processing-recovery.js");
    fake.estado = criarEstado({
      status: "PROCESSING",
      processingToken: TOKEN_ATUAL,
      processingLeaseUntil: new Date(AGORA.getTime() - 60_000),
      processingAttempts: 5,
    });

    await expect(recuperarEventoBotnextAbandonado({
      eventoId: EVENTO_ID,
      maximoTentativas: 5,
    })).resolves.toBe("FAILED");
  });

  it.each([
    {
      nome: "token NULL",
      token: null,
      lease: new Date(AGORA.getTime() + 60_000),
    },
    {
      nome: "lease NULL",
      token: TOKEN_ATUAL,
      lease: null,
    },
    {
      nome: "token e lease NULL",
      token: null,
      lease: null,
    },
  ])("recupera PROCESSING legado com $nome", async ({ token, lease }) => {
    const { recuperarEventoBotnextAbandonado } =
      await import("../src/queue/botnext-processing-recovery.js");
    fake.estado = criarEstado({
      status: "PROCESSING",
      processingToken: token,
      processingLeaseUntil: lease,
      processingAttempts: 1,
    });

    await expect(recuperarEventoBotnextAbandonado({
      eventoId: EVENTO_ID,
      maximoTentativas: 5,
    })).resolves.toBe("RECEIVED");
  });

  it("não recupera lease ainda válida", async () => {
    const { recuperarEventoBotnextAbandonado } =
      await import("../src/queue/botnext-processing-recovery.js");
    fake.estado = criarEstado({
      status: "PROCESSING",
      processingToken: TOKEN_ATUAL,
      processingLeaseUntil: new Date(AGORA.getTime() + 60_000),
      processingAttempts: 1,
    });

    await expect(recuperarEventoBotnextAbandonado({
      eventoId: EVENTO_ID,
      maximoTentativas: 5,
    })).resolves.toBe("NAO_RECUPERADO");
  });

  it("permite apenas um vencedor em duas recuperações concorrentes", async () => {
    const { recuperarEventoBotnextAbandonado } =
      await import("../src/queue/botnext-processing-recovery.js");
    fake.estado = criarEstado({
      status: "PROCESSING",
      processingToken: TOKEN_ATUAL,
      processingLeaseUntil: new Date(AGORA.getTime() - 60_000),
      processingAttempts: 1,
    });

    const resultados = await Promise.all([
      recuperarEventoBotnextAbandonado({
        eventoId: EVENTO_ID,
        maximoTentativas: 5,
      }),
      recuperarEventoBotnextAbandonado({
        eventoId: EVENTO_ID,
        maximoTentativas: 5,
      }),
    ]);

    expect(resultados.filter(
      (resultado) => resultado === "RECEIVED",
    )).toHaveLength(1);
    expect(resultados.filter(
      (resultado) => resultado === "NAO_RECUPERADO",
    )).toHaveLength(1);
  });

  it("move RECEIVED no limite para FAILED", async () => {
    const { falharEventoBotnextRecebidoNoLimite } =
      await import("../src/queue/botnext-processing-recovery.js");
    fake.estado = criarEstado({
      processingAttempts: 5,
    });

    await expect(falharEventoBotnextRecebidoNoLimite({
      eventoId: EVENTO_ID,
      maximoTentativas: 5,
    })).resolves.toBe("FAILED");
    expect(fake.estado.status).toBe("FAILED");
  });

  it("mantém valores como parâmetros fora do texto SQL", async () => {
    const { renovarLeaseEventoBotnext } =
      await import("../src/queue/botnext-processing-lease-service.js");
    fake.estado = criarEstado({
      status: "PROCESSING",
      processingToken: TOKEN_ATUAL,
    });

    await renovarLeaseEventoBotnext({
      eventoId: EVENTO_ID,
      processingToken: TOKEN_ATUAL,
      duracaoLeaseMs: 60_000,
    });

    const strings = fake.queryRaw.mock.calls[0]?.[0] as TemplateStringsArray;
    expect(strings.join("")).not.toContain(EVENTO_ID);
    expect(strings.join("")).not.toContain(TOKEN_ATUAL);
  });
});
