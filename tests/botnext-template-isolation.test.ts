import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeEnv = vi.hoisted(() => ({
  BOTNEXT_TEST_MODE: true,
  BOTNEXT_SEND_ENABLED: true,
  BOTNEXT_TEST_TO: "+55 (11) 98888-0001",
  BOTNEXT_FROM: "5511977770000",
  BOTNEXT_TEMPLATE_ID: "template-ficticio",
  BOTNEXT_TEMPLATE_PARAMETERS_JSON: {} as Record<string, string | null>,
  BOTNEXT_BASE_URL: "https://botnext.invalid",
  BOTNEXT_API_TOKEN: "token-ficticio",
}));

vi.mock("../src/config/env.js", () => ({ env: fakeEnv }));

import {
  montarTemplateDeTeste,
} from "../src/integrations/botnext/botnext-template.js";

describe("isolamento do sender de template", () => {
  beforeEach(() => {
    fakeEnv.BOTNEXT_TEST_MODE = true;
    fakeEnv.BOTNEXT_TEST_TO = "+55 (11) 98888-0001";
  });

  it("usa exclusivamente BOTNEXT_TEST_TO normalizado", () => {
    const mensagem = montarTemplateDeTeste();

    expect(mensagem.to).toBe("5511988880001");
    expect(mensagem.body.templateId).toBe("template-ficticio");
  });

  it("não monta template fora do modo de teste", () => {
    fakeEnv.BOTNEXT_TEST_MODE = false;

    expect(() => montarTemplateDeTeste()).toThrow(
      "Esta funcao exige BOTNEXT_TEST_MODE=true.",
    );
  });

  it("falha fechado quando o destino de teste é inválido", () => {
    fakeEnv.BOTNEXT_TEST_TO = "invalido";

    expect(() => montarTemplateDeTeste()).toThrow(
      "Configuração de isolamento BotNext inválida.",
    );
  });
});
