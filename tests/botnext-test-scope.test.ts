import { describe, expect, it } from "vitest";

import {
  avaliarTelefoneNoEscopoBotnext,
  mascararTelefoneBotnext,
} from "../src/integrations/botnext/botnext-test-scope.js";

const AUTORIZADO = "5511988880001";
const OUTRO = "5511988880002";

describe("isolamento BotNext por telefone", () => {
  it("modo de teste desligado preserva o comportamento existente", () => {
    expect(
      avaliarTelefoneNoEscopoBotnext(OUTRO, {
        modoTeste: false,
        telefoneTeste: undefined,
      }),
    ).toMatchObject({ permitido: true, modoTeste: false });
  });

  it("falha de forma fechada sem BOTNEXT_TEST_TO", () => {
    expect(
      avaliarTelefoneNoEscopoBotnext(AUTORIZADO, {
        modoTeste: true,
        telefoneTeste: undefined,
      }),
    ).toEqual({ permitido: false, motivo: "CONFIGURACAO_INVALIDA" });
  });

  it("falha de forma fechada com BOTNEXT_TEST_TO inválido", () => {
    expect(
      avaliarTelefoneNoEscopoBotnext(AUTORIZADO, {
        modoTeste: true,
        telefoneTeste: "telefone-invalido",
      }),
    ).toEqual({ permitido: false, motivo: "CONFIGURACAO_INVALIDA" });
  });

  it("reconhece formatos equivalentes após normalização", () => {
    expect(
      avaliarTelefoneNoEscopoBotnext("(11) 98888-0001", {
        modoTeste: " true ",
        telefoneTeste: "+55 11 98888-0001",
      }),
    ).toEqual({
      permitido: true,
      modoTeste: true,
      telefoneNormalizado: AUTORIZADO,
    });
  });

  it("bloqueia configuração de modo inválida e telefone diferente", () => {
    expect(
      avaliarTelefoneNoEscopoBotnext(AUTORIZADO, {
        modoTeste: "talvez",
        telefoneTeste: AUTORIZADO,
      }),
    ).toEqual({ permitido: false, motivo: "CONFIGURACAO_INVALIDA" });
    expect(
      avaliarTelefoneNoEscopoBotnext(OUTRO, {
        modoTeste: true,
        telefoneTeste: AUTORIZADO,
      }),
    ).toEqual({ permitido: false, motivo: "FORA_DO_ESCOPO_DE_TESTE" });
  });

  it("não inclui o telefone completo em máscara, resultado ou erro", () => {
    const resultado = avaliarTelefoneNoEscopoBotnext(OUTRO, {
      modoTeste: true,
      telefoneTeste: AUTORIZADO,
    });
    const serializado = JSON.stringify(resultado);
    const mascara = mascararTelefoneBotnext(AUTORIZADO);

    expect(serializado).not.toContain(AUTORIZADO);
    expect(serializado).not.toContain(OUTRO);
    expect(mascara).not.toContain(AUTORIZADO);
    expect(mascara).toMatch(/\*+01$/);
  });
});
