import { describe, expect, it } from "vitest";

import {
  classificarConfirmacao,
  normalizarFraseConfirmacao,
} from "../src/integrations/botnext/botnext-confirmacao-mensagem.js";

describe("classificarConfirmacao (Etapa 3.2) — determinístico, sem OpenAI", () => {
  it("normaliza acentos, pontuação e maiúsculas", () => {
    expect(normalizarFraseConfirmacao("  Está Certo, pode CONFIRMAR!  ")).toBe(
      "esta certo pode confirmar",
    );
    expect(normalizarFraseConfirmacao("NÃO...")).toBe("nao");
    // O travessão não é removido, mas a palavra "sim" continua isolada.
    expect(classificarConfirmacao("— sim —")).toBe("POSITIVA");
  });

  it("POSITIVA para frases de confirmação", () => {
    const positivas = [
      "sim",
      "Sim!",
      "SIM",
      "confirmo",
      "pode confirmar",
      "pode fechar",
      "pode mandar",
      "pode enviar",
      "correto",
      "está certo",
      "sim, pode confirmar",
    ];
    for (const frase of positivas) {
      expect(classificarConfirmacao(frase), frase).toBe("POSITIVA");
    }
  });

  it("NEGATIVA para frases de cancelamento", () => {
    const negativas = [
      "não",
      "Não!",
      "cancelar",
      "cancela",
      "pode cancelar",
      "deixa pra lá",
      "não quero",
      "não quero mais",
    ];
    for (const frase of negativas) {
      expect(classificarConfirmacao(frase), frase).toBe("NEGATIVA");
    }
  });

  it("AMBIGUA quando mescla positivo e negativo — nunca confirma", () => {
    const ambiguas = [
      "sim, não quero",
      "não, pode confirmar",
      "sim nao quero mais",
      "não sim",
    ];
    for (const frase of ambiguas) {
      expect(classificarConfirmacao(frase), frase).toBe("AMBIGUA");
    }
  });

  it("IRRELEVANTE para continuidade ou texto vazio", () => {
    const irrelevantes = [
      "",
      "ok",
      "obrigado",
      "quero 2 caixas de pilsen",
      "quanto fica?",
      "tudo certo",
    ];
    for (const frase of irrelevantes) {
      expect(classificarConfirmacao(frase), frase).toBe("IRRELEVANTE");
    }
  });

  it("não deixa 'nao' isolado dentro de palavra confirmar positiva", () => {
    // "não" tem borda de palavra; "infraestrutura" não contém "nao" isolado.
    expect(classificarConfirmacao("infraestrutura")).toBe("IRRELEVANTE");
    expect(classificarConfirmacao("infra não")).toBe("NEGATIVA");
  });
});