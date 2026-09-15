// Dispatcher do pedido confirmado ao webhook do n8n (Etapa 3.1).
//
// Orquestra a máquina de estados do envio: claim exclusivo (lease/f),
// payload determinístico PEDIDO_CONFIRMADO_V1, POST via cliente HTTP
// INJETÁVEL, e finalização com f. Efeito externo desativado por
// configuração (BOTNEXT_PEDIDO_DISPATCH_ENABLED=false): DESATIVADO sem
// nenhuma chamada HTTP e sem nenhuma escrita.

import { randomUUID } from "node:crypto";

import { BotnextPedidoRascunhoStatus } from "@prisma/client";

import { prisma } from "../../database/prisma.js";

import {
  dispatchPedidoHabilitado,
  obterConfiguracaoDispatchAmbiente,
} from "../../config/botnext-pedido-dispatch-config.js";
import { BOTNEXT_DISPATCH_LEASE_MS } from "../../queue/botnext-processing-config.js";
import { lerConteudoPersistido } from "./botnext-pedido-rascunho-persistence.js";
import {
  adquirirLeaseDispatch,
  finalizarDispatchEnviado,
  lerRascunhoParaDispatch,
  mensagemErroSegura,
  registrarEnvioIncerto,
  registrarFalhaPermanenteDispatch,
  registrarFalhaTransitoriaDispatch,
} from "./botnext-pedido-rascunho-dispatch-persistence.js";
import {
  montarPayloadPedidoConfirmadoV1,
} from "../../pedidos/pedido-confirmado/payload-pedido-confirmado.js";
import {
  avaliarTelefoneNoEscopoBotnext,
} from "./botnext-test-scope.js";

// ---------------------------------------------------------------------------
// Cliente HTTP injetável
// ---------------------------------------------------------------------------

export interface RequisicaoHttp {
  url: string;
  corpo: unknown;
  timeoutMs: number;
}

export type ResultadoEnvioHttp =
  | {
      tipo: "RESPOSTA";
      status: number;
      corpo: unknown;
    }
  | {
      tipo: "TEMPO_ESGOTADO";
    }
  | {
      tipo: "FALHA_REDE";
      motivo: string;
    };

export type EnviadorHttp = (
  req: RequisicaoHttp,
) => Promise<ResultadoEnvioHttp>;

/** Implementação real usando fetch (Node >= 18) — nunca lança. */
export async function enviarJsonComFetch(
  req: RequisicaoHttp,
): Promise<ResultadoEnvioHttp> {
  try {
    const resposta = await fetch(req.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "botnext-arbrain-sync/3.1",
      },
      body: JSON.stringify(req.corpo),
      signal: AbortSignal.timeout(req.timeoutMs),
    });

    const texto = await resposta.text().catch(() => "");
    let corpo: unknown = null;
    try {
      corpo = texto ? JSON.parse(texto) : null;
    } catch {
      corpo = texto;
    }

    return { tipo: "RESPOSTA", status: resposta.status, corpo };
  } catch (erro: unknown) {
    if (
      erro instanceof Error &&
      (erro.name === "TimeoutError" || erro.name === "AbortError")
    ) {
      return { tipo: "TEMPO_ESGOTADO" };
    }
    return {
      tipo: "FALHA_REDE",
      motivo:
        erro instanceof Error ? erro.message : "Falha de rede desconhecida.",
    };
  }
}

// ---------------------------------------------------------------------------
// Resultado do serviço
// ---------------------------------------------------------------------------

export type ResultadoDispatchRascunho =
  | {
      situacao: "DESATIVADO";
    }
  | {
      situacao: "NAO_CONFIRMADO";
      rascunhoId: string;
      motivo: "STATUS_NAO_CONFIRMADO" | "DISPATCH_KEY_AUSENTE";
    }
  | {
      situacao: "JA_DESPACHADO";
      rascunhoId: string;
      dispatchKey: string;
      dispatchedAt: Date | null;
    }
  | {
      situacao: "ENVIADO";
      rascunhoId: string;
      dispatchKey: string;
      dispatchedAt: Date;
    }
  | {
      situacao: "FALHA_TRANSITORIA";
      rascunhoId: string;
      tentativa: number;
      podeTentarDeNovo: boolean;
    }
  | {
      situacao: "FALHA_PERMANENTE";
      rascunhoId: string;
      motivo: string;
    }
  | {
      situacao: "INCERTO";
      rascunhoId: string;
      motivo: string;
    }
  | {
      situacao: "CONCORRENCIA";
      rascunhoId: string;
    }
  | {
      situacao: "FORA_DO_ESCOPO_DE_TESTE";
      rascunhoId: string;
    };

export interface DespacharPedidoParams {
  tenantId: string;
  rascunhoId: string;
}

export type ServicoDispatchPedido = (
  params: DespacharPedidoParams,
) => Promise<ResultadoDispatchRascunho>;

export interface DependenciasDispatchPedido {
  enviadorHttp: EnviadorHttp;
  dispatchWorker?: string;
  duracaoLeaseMs?: number;
}

async function obterClienteParaDispatch(
  tenantId: string,
  clienteId: string | null,
): Promise<{
  arbrainId: string;
} | null> {
  if (!clienteId) {
    return null;
  }

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, tenantId },
    select: { arbrainId: true },
  });

  return cliente;
}

function ehResposta2xx(status: number): boolean {
  return status >= 200 && status <= 299;
}

export function criarServicoDispatchPedido(
  dependencias: DependenciasDispatchPedido,
): ServicoDispatchPedido {
  return async (
    params: DespacharPedidoParams,
  ): Promise<ResultadoDispatchRascunho> => {
    const tenantId = params.tenantId.trim();
    const rascunhoId = params.rascunhoId.trim();

    if (!tenantId || !rascunhoId) {
      throw new Error("Tenant e rascunho são obrigatórios.");
    }

    // 1) Guard de segurança por configuração — antes de qualquer HTTP/escrita.
    if (!dispatchPedidoHabilitado()) {
      return { situacao: "DESATIVADO" };
    }

    const configuracao = obterConfiguracaoDispatchAmbiente();

    // 3) Carregar rascunho no tenant.
    const linha = await lerRascunhoParaDispatch({ tenantId, rascunhoId });
    if (!linha) {
      throw new Error("Rascunho não encontrado no tenant informado.");
    }

    const escopo = avaliarTelefoneNoEscopoBotnext(
      linha.extracao.sourceMessage.webhookEvent?.senderPhone ?? null,
    );

    if (!escopo.permitido) {
      return { situacao: "FORA_DO_ESCOPO_DE_TESTE", rascunhoId };
    }

    // 4) Exigir CONFIRMADO + dispatchKey.
    if (linha.status === BotnextPedidoRascunhoStatus.DESPACHADO) {
      return {
        situacao: "JA_DESPACHADO",
        rascunhoId: linha.id,
        dispatchKey: linha.dispatchKey ?? "",
        dispatchedAt: linha.dispatchedAt,
      };
    }

    if (linha.status !== BotnextPedidoRascunhoStatus.CONFIRMADO) {
      return {
        situacao: "NAO_CONFIRMADO",
        rascunhoId: linha.id,
        motivo: "STATUS_NAO_CONFIRMADO",
      };
    }

    if (!linha.dispatchKey) {
      return {
        situacao: "NAO_CONFIRMADO",
        rascunhoId: linha.id,
        motivo: "DISPATCH_KEY_AUSENTE",
      };
    }

    const conteudo = lerConteudoPersistido(linha.itens);
    if (!conteudo.confirmacao) {
      throw new Error(
        "Rascunho CONFIRMADO sem confirmação persistida.",
      );
    }

    const cliente = await obterClienteParaDispatch(
      tenantId,
      linha.extracao.conversation.clienteId,
    );

    // 5) Claim exclusivo (lease/f por CAS).
    const worker =
      dependencias.dispatchWorker ?? "botnext-pedido-dispatch";
    const duracaoLeaseMs =
      dependencias.duracaoLeaseMs ?? BOTNEXT_DISPATCH_LEASE_MS;
    const dispatchToken = randomUUID();
    const adquirido = await adquirirLeaseDispatch({
      tenantId,
      rascunhoId,
      dispatchToken,
      dispatchWorker: worker,
      duracaoLeaseMs,
      maxTentativas: configuracao.maxTentativas,
    });

    if (!adquirido) {
      return { situacao: "CONCORRENCIA", rascunhoId };
    }

    const tentativa = linha.dispatchAttempts + 1;

    // 6) Payload determinístico.
    const payload = montarPayloadPedidoConfirmadoV1({
      tenantId,
      conversationId: linha.extracao.conversationId,
      extracaoId: linha.extracaoId,
      rascunhoId: linha.id,
      revision: linha.revision,
      confirmacao: conteudo.confirmacao,
      clienteArbrainId: cliente?.arbrainId ?? null,
      itens: conteudo.itens,
    });

    // 7) POST JSON.
    const resultado = await dependencias.enviadorHttp({
      url: configuracao.url,
      corpo: payload,
      timeoutMs: configuracao.timeoutMs,
    });

    // 8) Finalização com f.
    const f = { tenantId, rascunhoId, dispatchToken };

    switch (resultado.tipo) {
      case "RESPOSTA": {
        if (ehResposta2xx(resultado.status)) {
          const dispatchedAt = new Date();
          const finalizado = await finalizarDispatchEnviado({
            ...f,
            dispatchedAt,
          });
          if (finalizado === "LEASE_LOST") {
            return { situacao: "CONCORRENCIA", rascunhoId };
          }
          return {
            situacao: "ENVIADO",
            rascunhoId,
            dispatchKey: linha.dispatchKey,
            dispatchedAt,
          };
        }

        // 4xx → permanente; 5xx → transitória; o resto → inesperada.
        if (resultado.status >= 400 && resultado.status <= 499) {
          const motivo = `Status ${resultado.status} definitivo do webhook.`;
          await registrarFalhaPermanenteDispatch({
            ...f,
            mensagem: mensagemErroSegura(
              { message: motivo },
              "Falha permanente no dispatch.",
            ),
          });
          return { situacao: "FALHA_PERMANENTE", rascunhoId, motivo };
        }

        if (resultado.status >= 500 && resultado.status <= 599) {
          return registrarTransitoria({
            rascunhoId,
            f: f,
            tentativa,
            maxTentativas: configuracao.maxTentativas,
            motivo: `Status ${resultado.status} transitório do webhook.`,
          });
        }

        // 1xx/3xx/>=600 → resposta inesperada → FALHA_PERMANENTE.
        const motivo = `Status ${resultado.status} inesperado do webhook (1xx/3xx/>=600).`;
        await registrarFalhaPermanenteDispatch({
          ...f,
          mensagem: mensagemErroSegura(
            { message: motivo },
            "Resposta inesperada do webhook.",
          ),
        });
        return { situacao: "FALHA_PERMANENTE", rascunhoId, motivo };
      }

      case "TEMPO_ESGOTADO": {
        // INCERTO: o envio pode ter chegado — mantém token/lease até expirar.
        const motivo = `Timeout do webhook após ${configuracao.timeoutMs}ms (resultado indeterminado).`;
        await registrarEnvioIncerto({
          ...f,
          mensagem: mensagemErroSegura(
            { message: motivo },
            "Timeout indeterminado no dispatch.",
          ),
        });
        return { situacao: "INCERTO", rascunhoId, motivo };
      }

      case "FALHA_REDE": {
        return registrarTransitoria({
          rascunhoId,
          f: f,
          tentativa,
          maxTentativas: configuracao.maxTentativas,
          motivo: `Falha de rede antes do envio: ${resultado.motivo}`,
        });
      }
    }
  };
}

async function registrarTransitoria(params: {
  rascunhoId: string;
  f: { tenantId: string; rascunhoId: string; dispatchToken: string };
  tentativa: number;
  maxTentativas: number;
  motivo: string;
}): Promise<ResultadoDispatchRascunho> {
  if (params.tentativa >= params.maxTentativas) {
    const motivoFinal = `Tentativas esgotadas (${params.tentativa}/${params.maxTentativas}). ${params.motivo}`;
    await registrarFalhaPermanenteDispatch({
      ...params.f,
      mensagem: mensagemErroSegura(
        { message: motivoFinal },
        "Tentativas esgotadas no dispatch.",
      ),
    });
    return {
      situacao: "FALHA_PERMANENTE",
      rascunhoId: params.rascunhoId,
      motivo: motivoFinal,
    };
  }

  // Libera lease/token: novo claim fará outro POST (retry controlado).
  await registrarFalhaTransitoriaDispatch({
    ...params.f,
    mensagem: mensagemErroSegura(
      { message: params.motivo },
      "Falha transitória no dispatch.",
    ),
  });

  return {
    situacao: "FALHA_TRANSITORIA",
    rascunhoId: params.rascunhoId,
    tentativa: params.tentativa,
    podeTentarDeNovo: true,
  };
}
