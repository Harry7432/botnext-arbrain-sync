export type TipoTelefone =
  | "CELULAR_PROVAVEL"
  | "FIXO_OU_WHATSAPP_BUSINESS";

export type TelefoneNormalizado = {
  numeroNacional: string;
  numeroComCodigoPais: string;
  formatoE164: string;
  tipo: TipoTelefone;
};

function extrairDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

export function normalizarTelefoneBrasil(
  valor: string | null,
): TelefoneNormalizado | null {
  if (valor === null || valor.trim().length === 0) {
    return null;
  }

  let digitos = extrairDigitos(valor);

  if (
    (digitos.length === 12 || digitos.length === 13) &&
    digitos.startsWith("55")
  ) {
    digitos = digitos.slice(2);
  }

  if (digitos.length !== 10 && digitos.length !== 11) {
    return null;
  }

  const ddd = digitos.slice(0, 2);

  if (ddd.startsWith("0")) {
    return null;
  }

  const tipo: TipoTelefone =
    digitos.length === 11 && digitos[2] === "9"
      ? "CELULAR_PROVAVEL"
      : "FIXO_OU_WHATSAPP_BUSINESS";

  return {
    numeroNacional: digitos,
    numeroComCodigoPais: `55${digitos}`,
    formatoE164: `+55${digitos}`,
    tipo,
  };
}