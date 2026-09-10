// Configuração do dispatch de pedido confirmado ao webhook n8n (Etapa 3.1).
//
// O dispatcher permanece BLOQUEADO por configuração:
//   BOTNEXT_PEDIDO_DISPATCH_ENABLED=false
// Flag SEPARADA de BOTNEXT_SEND_ENABLED (envio de template no BotNext) — são
// efeitos externos distintos e não devem ser acoplados. Leitura permissiva
// (padrão de BOTNEXT_AI_ENABLED): não quebra o boot de quem não configurou.

export const BOTNEXT_PEDIDO_DISPATCH_TIMEOUT_MS_DEFAULT = 10_000;
export const BOTNEXT_PEDIDO_DISPATCH_MAX_ATTEMPTS_DEFAULT = 3;

export function dispatchPedidoHabilitado(): boolean {
  const valor =
    process.env.BOTNEXT_PEDIDO_DISPATCH_ENABLED
      ?.trim()
      .toLowerCase();

  if (valor === undefined || valor === "") {
    return false;
  }

  if (valor === "true" || valor === "false") {
    return valor === "true";
  }

  throw new Error(
    "BOTNEXT_PEDIDO_DISPATCH_ENABLED deve ser true ou false.",
  );
}

export interface ConfiguracaoDispatchAmbiente {
  url: string;
  timeoutMs: number;
  maxTentativas: number;
}

function inteiroPositivo(
  valor: number,
  nome: string,
): void {
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new Error(`${nome} deve ser um inteiro positivo.`);
  }
}

export function obterConfiguracaoDispatchAmbiente(): ConfiguracaoDispatchAmbiente {
  const url = process.env.BOTNEXT_PEDIDO_DISPATCH_URL?.trim();

  if (!url) {
    throw new Error(
      "BOTNEXT_PEDIDO_DISPATCH_URL é obrigatória quando o dispatch está habilitado.",
    );
  }

  if (!/^https:\/\//i.test(url)) {
    throw new Error(
      "BOTNEXT_PEDIDO_DISPATCH_URL deve usar HTTPS.",
    );
  }

  const timeoutMs = Number(
    process.env.BOTNEXT_PEDIDO_DISPATCH_TIMEOUT_MS ??
      BOTNEXT_PEDIDO_DISPATCH_TIMEOUT_MS_DEFAULT,
  );
  inteiroPositivo(timeoutMs, "BOTNEXT_PEDIDO_DISPATCH_TIMEOUT_MS");

  const maxTentativas = Number(
    process.env.BOTNEXT_PEDIDO_DISPATCH_MAX_ATTEMPTS ??
      BOTNEXT_PEDIDO_DISPATCH_MAX_ATTEMPTS_DEFAULT,
  );
  inteiroPositivo(maxTentativas, "BOTNEXT_PEDIDO_DISPATCH_MAX_ATTEMPTS");

  return { url, timeoutMs, maxTentativas };
}