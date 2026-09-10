import {
  describe,
  expect,
  it,
} from "vitest";

describe("jobId de recovery BotNext", () => {
  it("usa token UUID, não contém dois-pontos e muda a cada lease", async () => {
    const { criarJobIdEventoBotnext } =
      await import("../src/queue/botnext-webhook-job-id.js");
    const eventoId = "10000000-0000-4000-8000-000000000001";
    const primeiroToken = "20000000-0000-4000-8000-000000000002";
    const segundoToken = "30000000-0000-4000-8000-000000000003";

    const primeiro = criarJobIdEventoBotnext(eventoId, primeiroToken);
    const segundo = criarJobIdEventoBotnext(eventoId, segundoToken);

    expect(primeiro).toBe(`${eventoId}-recovery-${primeiroToken}`);
    expect(primeiro).not.toContain(":");
    expect(segundo).not.toBe(primeiro);
  });

  it("preserva o jobId normal e rejeita recovery token inválido", async () => {
    const { criarJobIdEventoBotnext } =
      await import("../src/queue/botnext-webhook-job-id.js");
    const eventoId = "10000000-0000-4000-8000-000000000001";

    expect(criarJobIdEventoBotnext(eventoId)).toBe(eventoId);
    expect(() => criarJobIdEventoBotnext(eventoId, "token:inválido"))
      .toThrow("enqueueToken deve ser um UUID válido.");
  });
});
