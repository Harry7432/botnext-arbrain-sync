import {
  criarServicoClassificacaoBotnext,
} from "./botnext-message-classification-service.js";

import type {
  ClassificarMensagemBotnextParams,
  ResultadoClassificacaoMensagem,
  ServicoClassificacaoMensagem,
} from "./botnext-message-classification-service.js";

export type ResultadoClassificacaoOpcional =
  | ResultadoClassificacaoMensagem
  | {
      situacao: "DESATIVADA";
    };

const VERSAO_CLASSIFICADOR =
  "botnext-intent-v1";

let inicializacaoServico:
  Promise<ServicoClassificacaoMensagem> | null = null;

export function iaBotnextHabilitada(): boolean {
  const valor =
    process.env.BOTNEXT_AI_ENABLED
      ?.trim()
      .toLowerCase();

  if (
    valor === undefined ||
    valor === "" ||
    valor === "false"
  ) {
    return false;
  }

  if (valor === "true") {
    return true;
  }

  throw new Error(
    "BOTNEXT_AI_ENABLED deve ser true ou false.",
  );
}

async function criarServicoReal():
  Promise<ServicoClassificacaoMensagem> {
  // Estes módulos só são carregados depois que
  // a configuração de ativação é verificada.
  const [
    moduloClassificador,
    moduloCliente,
  ] = await Promise.all([
    import("../../ai/botnext-intent-classifier.js"),
    import("../../ai/openai-client.js"),
  ]);

  return criarServicoClassificacaoBotnext({
    modelo:
      moduloCliente.MODELO_OPENAI,

    versao:
      VERSAO_CLASSIFICADOR,

    classificar:
      moduloClassificador.classificarIntencaoBotnext,
  });
}

function obterServicoReal():
  Promise<ServicoClassificacaoMensagem> {
  if (!inicializacaoServico) {
    // Compartilha também a inicialização entre chamadas
    // simultâneas, mantendo uma instância por processo.
    inicializacaoServico =
      criarServicoReal().catch((error: unknown) => {
        inicializacaoServico = null;
        throw error;
      });
  }

  return inicializacaoServico;
}

export async function classificarEventoBotnextSeHabilitado(
  params: ClassificarMensagemBotnextParams,
): Promise<ResultadoClassificacaoOpcional> {
  if (!iaBotnextHabilitada()) {
    return {
      situacao: "DESATIVADA",
    };
  }

  const servico = await obterServicoReal();

  // Reconfere antes de iniciar o serviço.
  // Isso não cancela requisições que já começaram.
  if (!iaBotnextHabilitada()) {
    return {
      situacao: "DESATIVADA",
    };
  }

  return servico(params);
}