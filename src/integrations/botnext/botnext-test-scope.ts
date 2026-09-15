import { normalizarTelefoneBrasil } from "../../visitas/telefone-service.js";

export type ConfiguracaoEscopoTesteBotnext = {
  modoTeste: boolean | string | undefined;
  telefoneTeste: string | undefined;
};

export type MotivoBloqueioEscopoBotnext =
  | "CONFIGURACAO_INVALIDA"
  | "TELEFONE_INVALIDO"
  | "FORA_DO_ESCOPO_DE_TESTE";

export type ResultadoEscopoBotnext =
  | {
      permitido: true;
      modoTeste: boolean;
      telefoneNormalizado: string | null;
    }
  | {
      permitido: false;
      motivo: MotivoBloqueioEscopoBotnext;
    };

export function configuracaoEscopoTesteBotnext(
  ambiente: NodeJS.ProcessEnv = process.env,
): ConfiguracaoEscopoTesteBotnext {
  return {
    modoTeste: ambiente.BOTNEXT_TEST_MODE,
    telefoneTeste: ambiente.BOTNEXT_TEST_TO,
  };
}

export function avaliarTelefoneNoEscopoBotnext(
  telefone: string | null | undefined,
  configuracao: ConfiguracaoEscopoTesteBotnext =
    configuracaoEscopoTesteBotnext(),
): ResultadoEscopoBotnext {
  const modoBruto = configuracao.modoTeste;
  const modoNormalizado =
    typeof modoBruto === "boolean"
      ? String(modoBruto)
      : modoBruto?.trim().toLowerCase();

  if (modoNormalizado === "false") {
    return {
      permitido: true,
      modoTeste: false,
      telefoneNormalizado:
        normalizarTelefoneBrasil(telefone ?? null)?.numeroComCodigoPais ?? null,
    };
  }

  if (modoNormalizado !== undefined && modoNormalizado !== "" && modoNormalizado !== "true") {
    return { permitido: false, motivo: "CONFIGURACAO_INVALIDA" };
  }

  const telefoneTeste = normalizarTelefoneBrasil(
    configuracao.telefoneTeste ?? null,
  );
  if (!telefoneTeste) {
    return { permitido: false, motivo: "CONFIGURACAO_INVALIDA" };
  }

  const telefoneRecebido = normalizarTelefoneBrasil(telefone ?? null);
  if (!telefoneRecebido) {
    return { permitido: false, motivo: "TELEFONE_INVALIDO" };
  }

  if (
    telefoneRecebido.numeroComCodigoPais !==
    telefoneTeste.numeroComCodigoPais
  ) {
    return { permitido: false, motivo: "FORA_DO_ESCOPO_DE_TESTE" };
  }

  return {
    permitido: true,
    modoTeste: true,
    telefoneNormalizado: telefoneRecebido.numeroComCodigoPais,
  };
}

export function mascararTelefoneBotnext(
  telefone: string | null | undefined,
): string {
  const normalizado = normalizarTelefoneBrasil(telefone ?? null);
  if (!normalizado) {
    return "[telefone-invalido]";
  }

  return `***********${normalizado.numeroNacional.slice(-2)}`;
}
