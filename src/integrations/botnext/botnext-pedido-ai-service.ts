import {
  VERSAO_EXTRACTOR_PEDIDO,
  VERSAO_PROMPT_EXTRACTOR_PEDIDO,
} from "../../pedidos/extracao/erros.js";

import { iaBotnextHabilitada } from "./botnext-ai-service.js";

import { criarServicoExtracaoPedido } from "./botnext-pedido-extracao-service.js";
import type {
  ExtrairPedidoBotnextParams,
  ResultadoExtracaoMensagem,
  ServicoExtracaoPedido,
} from "./botnext-pedido-extracao-service.js";

export type ResultadoExtracaoOpcional =
  | ResultadoExtracaoMensagem
  | { situacao: "DESATIVADA" };

let inicializacaoServico: Promise<ServicoExtracaoPedido> | null = null;

async function criarServicoReal(): Promise<ServicoExtracaoPedido> {
  // Só carrega o extractor + o cliente OpenAI depois de confirmar a ativação.
  const [moduloExtractor, moduloCliente] = await Promise.all([
    import("../../ai/botnext-pedido-extractor.js"),
    import("../../ai/openai-client.js"),
  ]);

  return criarServicoExtracaoPedido({
    modelo: moduloCliente.MODELO_OPENAI,
    versaoExtractor: VERSAO_EXTRACTOR_PEDIDO,
    versaoPrompt: VERSAO_PROMPT_EXTRACTOR_PEDIDO,
    extrair: moduloExtractor.extrairItensPedido,
  });
}

function obterServicoReal(): Promise<ServicoExtracaoPedido> {
  if (!inicializacaoServico) {
    inicializacaoServico = criarServicoReal().catch((erro: unknown) => {
      inicializacaoServico = null;
      throw erro;
    });
  }

  return inicializacaoServico;
}

/**
 * Accessor do serviço real de extração (Etapa 3.2). Permite ao fluxo de
 * pedido obter a mesma instância lazy (com os imports pesados de OpenAI
 * carregados somente sob demanda) e chamá-la com a flag de multi-turn.
 */
export function obterServicoExtraccaoPedidoReal(): Promise<ServicoExtracaoPedido> {
  return obterServicoReal();
}

export async function extrairPedidoBotnextSeHabilitado(
  params: ExtrairPedidoBotnextParams,
): Promise<ResultadoExtracaoOpcional> {
  if (!iaBotnextHabilitada()) {
    return { situacao: "DESATIVADA" };
  }

  const servico = await obterServicoReal();

  // Reconfere antes de disparar (não cancela chamadas já iniciadas).
  if (!iaBotnextHabilitada()) {
    return { situacao: "DESATIVADA" };
  }

  return servico(params);
}
