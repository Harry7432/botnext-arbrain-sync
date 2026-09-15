// Envio de resposta (texto livre) ao cliente no BotNext (Etapa 3.2).
//
// Sample of effects: envia mensagem de texto para o número do cliente via
// POST /v1/message/send. Duas travas tornam o envio idempotente:
//
//  1. Gate permissivo BOTNEXT_SEND_ENABLED (flag SEPARADA do dispatch n8n):
//     desativado → zero HTTP e zero escrita.
//  2. Marcador durável no JSON do rascunho (`respostas[eventoId]`): cada
//     evento só envia a resposta uma vez. Como `webhookEventId` do model de
//     mensagem é @unique e já é consumido pela mensagem CUSTOMER, NÃO é
//     possível criar uma mensagem ASSISTANT com o mesmo valor — a dedup vive
//     no rascunho, sem migration.
//
// Timeout é INDETERMINADO: o servidor pode ter recebido. Não afirmamos
// ENVIADA nem persistimos marcador — retornamos ENVIO_INCERTO preservando o
// motivo para diagnóstico. Nenhum retry automático nem segunda mensagem.

import {
  Prisma,
} from "@prisma/client";

import {
  lerConteudoPersistido,
} from "./botnext-pedido-rascunho-persistence.js";
import { prisma } from "../../database/prisma.js";
import {
  avaliarTelefoneNoEscopoBotnext,
} from "./botnext-test-scope.js";

const TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Transporte de texto (injetável). Nunca lança.
// ---------------------------------------------------------------------------

export type MensagemTextoBotNext = {
  from: string;
  to: string;
  body: { text: string };
  options: { forceStartSession: boolean };
};

export type ResultadoEnvioTextoBotNext =
  | { tipo: "RESPOSTA"; status: number }
  | { tipo: "TEMPO_ESGOTADO" }
  | { tipo: "BLOQUEADO_TESTE" }
  | { tipo: "FALHA_REDE"; motivo: string };

export type EnviarTextoBotNext = (
  mensagem: MensagemTextoBotNext,
) => Promise<ResultadoEnvioTextoBotNext>;

/**
 * POST /v1/message/send com texto livre. Payload fiel ao contrato usado para
 * templates (`body` passa a carregar `text`); o endpoint e as flags são os
 * mesmos. Nunca lança — devolve o resultado normalizado.
 */
export async function enviarTextoBotNextComFetch(
  mensagem: MensagemTextoBotNext,
): Promise<ResultadoEnvioTextoBotNext> {
  if (!avaliarTelefoneNoEscopoBotnext(mensagem.to).permitido) {
    return { tipo: "BLOQUEADO_TESTE" };
  }

  const baseUrl = process.env.BOTNEXT_BASE_URL?.trim().replace(/\/+$/, "");
  const token = process.env.BOTNEXT_API_TOKEN?.trim();

  if (!baseUrl || !token) {
    return {
      tipo: "FALHA_REDE",
      motivo: "BOTNEXT_BASE_URL/BOTNEXT_API_TOKEN ausentes no ambiente.",
    };
  }

  try {
    const url = new URL(`${baseUrl}/v1/message/send`);
    const resposta = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(mensagem),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });

    return { tipo: "RESPOSTA", status: resposta.status };
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

export const ENVIADOR_TEXTO_BOTNEXT_REAL: EnviarTextoBotNext =
  enviarTextoBotNextComFetch;

// ---------------------------------------------------------------------------
// Gate permissivo (padrão de BOTNEXT_AI_ENABLED / dispatchPedidoHabilitado)
// ---------------------------------------------------------------------------

export function envioRespostaBotnextHabilitado(): boolean {
  const valor = process.env.BOTNEXT_SEND_ENABLED?.trim().toLowerCase();

  if (valor === undefined || valor === "" || valor === "false") {
    return false;
  }

  if (valor === "true") {
    return true;
  }

  throw new Error("BOTNEXT_SEND_ENABLED deve ser true ou false.");
}

// ---------------------------------------------------------------------------
// Serviço de envio com dedup durável
// ---------------------------------------------------------------------------

export interface EnviarRespostaParams {
  tenantId: string;
  rascunhoId: string;
  /** webhookEventId que originou a resposta (chave do marcador). */
  eventoId: string;
  texto: string;
}

export type ResultadoEnvioResposta =
  | { situacao: "DESATIVADO" }
  | {
      situacao: "SEM_ROTA";
      motivo:
        | "SEM_FROM"
        | "SEM_CLIENTE"
        | "SEM_TELEFONE"
        | "SEM_RASCUNHO"
        | "FORA_DO_ESCOPO_DE_TESTE";
    }
  | { situacao: "ENVIADA" }
  | { situacao: "JA_ENVIADA" }
  | {
      situacao: "ENVIO_INCERTO";
      /** Causa do desconhecimento (ex.: timeout após 30s, status inesperado). */
      motivo: string;
    }
  | {
      situacao: "FALHA_ENVIO";
      transitoria: boolean;
      motivo: string;
    };

export type ServicoEnvioResposta = (
  params: EnviarRespostaParams,
) => Promise<ResultadoEnvioResposta>;

export interface DependenciasEnvioResposta {
  /** Transporte HTTP de texto. Default: fetch real. */
  enviarTexto?: EnviarTextoBotNext;
  /** Relógio injetável para os testes. */
  agora?: () => Date;
}

function ehResposta2xx(status: number): boolean {
  return status >= 200 && status <= 299;
}

async function buscarLinhaRascunho(params: {
  tenantId: string;
  rascunhoId: string;
}): Promise<{
  id: string;
  revision: number;
  itens: unknown;
  extracao: { conversation: { clienteId: string | null } };
} | null> {
  return prisma.botnextPedidoRascunho.findFirst({
    where: { id: params.rascunhoId, tenantId: params.tenantId },
    select: {
      id: true,
      revision: true,
      itens: true,
      extracao: {
        select: {
          conversation: { select: { clienteId: true } },
        },
      },
    },
  });
}

async function persistirMarcadorDeResposta(params: {
  tenantId: string;
  rascunhoId: string;
  eventoId: string;
  texto: string;
  enviadaEm: string;
}): Promise<void> {
  // Lê a linha, funde o marcador e escreve com CAS em revision. Se perder a
  // corrida, re-lê e repete — um marcador ausente nunca é perdido.
  let linha = await buscarLinhaRascunho(params);

  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    if (!linha) {
      throw new Error("Rascunho não encontrado para persistir a resposta.");
    }

    const conteudo = lerConteudoPersistido(linha.itens as never);
    if (conteudo.respostas?.[params.eventoId]) {
      return;
    }

    const atualizado = await prisma.botnextPedidoRascunho.updateMany({
      where: {
        id: params.rascunhoId,
        tenantId: params.tenantId,
        revision: linha.revision,
      },
      data: {
        itens: {
          ...conteudo,
          respostas: {
            ...(conteudo.respostas ?? {}),
            [params.eventoId]: {
              texto: params.texto,
              enviadaEm: params.enviadaEm,
            },
          },
        } as unknown as Prisma.InputJsonValue,
        revision: { increment: 1 },
      },
    });

    if (atualizado.count === 1) {
      return;
    }

    linha = await buscarLinhaRascunho(params);
  }

  throw new Error(
    "Não foi possível persistir o marcador de resposta (concorrência alta).",
  );
}

export function criarServicoEnvioResposta(
  dependencias: DependenciasEnvioResposta = {},
): ServicoEnvioResposta {
  const enviarTexto = dependencias.enviarTexto ?? ENVIADOR_TEXTO_BOTNEXT_REAL;
  const agora = dependencias.agora ?? (() => new Date());

  async function executar(
    params: EnviarRespostaParams,
  ): Promise<ResultadoEnvioResposta> {
    const tenantId = params.tenantId.trim();
    const rascunhoId = params.rascunhoId.trim();
    const eventoId = params.eventoId.trim();
    const texto = params.texto.trim();

    if (!tenantId || !rascunhoId || !eventoId || !texto) {
      throw new Error("Tenant, rascunho, evento e texto são obrigatórios.");
    }

    // 1) Guard de segurança por configuração — antes de qualquer HTTP/escrita.
    if (!envioRespostaBotnextHabilitado()) {
      return { situacao: "DESATIVADO" };
    }

    const linha = await buscarLinhaRascunho({ tenantId, rascunhoId });

    if (!linha) {
      return { situacao: "SEM_ROTA", motivo: "SEM_RASCUNHO" };
    }

    // 2) Dedup durável: a resposta deste evento já foi enviada.
    const conteudo = lerConteudoPersistido(linha.itens as never);
    if (conteudo.respostas?.[eventoId]) {
      return { situacao: "JA_ENVIADA" };
    }

    // 3) Rota: FROM é fixa do ambiente; TO é o telefone do cliente.
    const from = process.env.BOTNEXT_FROM?.trim();
    if (!from) {
      return { situacao: "SEM_ROTA", motivo: "SEM_FROM" };
    }

    const clienteId = linha.extracao.conversation.clienteId;
    if (!clienteId) {
      return { situacao: "SEM_ROTA", motivo: "SEM_CLIENTE" };
    }

    const cliente = await prisma.cliente.findFirst({
      where: { id: clienteId, tenantId },
      select: { celular: true, telefone: true },
    });

    const telefoneCliente = cliente?.celular ?? cliente?.telefone ?? null;
    const escopo = avaliarTelefoneNoEscopoBotnext(telefoneCliente);

    if (!escopo.permitido) {
      return {
        situacao: "SEM_ROTA",
        motivo: "FORA_DO_ESCOPO_DE_TESTE",
      };
    }

    const numeroComCodigoPais = escopo.telefoneNormalizado;

    if (!numeroComCodigoPais) {
      return { situacao: "SEM_ROTA", motivo: "SEM_TELEFONE" };
    }

    // 4) POST no BotNext.
    const resultado = await enviarTexto({
      from,
      to: numeroComCodigoPais,
      body: { text: texto },
      options: { forceStartSession: false },
    });

    // 5) Tratamento com dedup: só persiste o marcador quando o envio
    //    certamente aconteceu ou é indeterminado (timeout).
    switch (resultado.tipo) {
      case "BLOQUEADO_TESTE": {
        return {
          situacao: "SEM_ROTA",
          motivo: "FORA_DO_ESCOPO_DE_TESTE",
        };
      }

      case "RESPOSTA": {
        if (ehResposta2xx(resultado.status)) {
          await persistirMarcadorDeResposta({
            tenantId,
            rascunhoId,
            eventoId,
            texto,
            enviadaEm: agora().toISOString(),
          });
          return { situacao: "ENVIADA" };
        }

        if (resultado.status >= 400 && resultado.status <= 499) {
          return {
            situacao: "FALHA_ENVIO",
            transitoria: false,
            motivo: `BotNext respondeu HTTP ${resultado.status}.`,
          };
        }

        if (resultado.status >= 500 && resultado.status <= 599) {
          return {
            situacao: "FALHA_ENVIO",
            transitoria: true,
            motivo: `BotNext respondeu HTTP ${resultado.status}.`,
          };
        }

        return {
          situacao: "FALHA_ENVIO",
          transitoria: false,
          motivo: `BotNext respondeu HTTP ${resultado.status} (inesperado).`,
        };
      }

      case "TEMPO_ESGOTADO": {
        // O servidor pode ter recebido, mas NÃO temos confirmação. Não
        // afirmamos ENVIADA e NÃO persistimos marcador (um reprocessamento
        // futuro poderá tentar de novo). Nenhum retry automático aqui, e
        // nenhuma segunda mensagem é disparada por este resultado.
        return {
          situacao: "ENVIO_INCERTO",
          motivo: `Timeout de ${TIMEOUT_MS}ms: não sabemos se o BotNext recebeu a requisição.`,
        };
      }

      case "FALHA_REDE": {
        return {
          situacao: "FALHA_ENVIO",
          transitoria: true,
          motivo: `Falha de rede antes do envio: ${resultado.motivo}`,
        };
      }
    }
  }

  return executar;
}

// ---------------------------------------------------------------------------
// Instância real compartilhada (default do wiring de produção)
// ---------------------------------------------------------------------------

let servicoEnvioRespostaReal: ServicoEnvioResposta | null = null;

export function obterServicoEnvioRespostaReal(): ServicoEnvioResposta {
  if (!servicoEnvioRespostaReal) {
    servicoEnvioRespostaReal = criarServicoEnvioResposta();
  }
  return servicoEnvioRespostaReal;
}
