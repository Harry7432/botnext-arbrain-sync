import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import {
  BotnextConversationMessageRole,
  BotnextConversationStatus,
  BotnextPedidoExtracaoStatus,
  BotnextPedidoRascunhoStatus,
} from "@prisma/client";

import {
  prisma,
} from "./database/prisma.js";

import {
  criarServicoConstrucaoRascunho,
} from "./integrations/botnext/botnext-pedido-rascunho-service.js";
import {
  criarServicoConfirmacaoRascunho,
} from "./integrations/botnext/botnext-pedido-rascunho-confirmacao-service.js";
import {
  criarServicoDispatchPedido,
  enviarJsonComFetch,
  type EnviadorHttp,
} from "./integrations/botnext/botnext-pedido-rascunho-dispatch-service.js";
import {
  criarCatalogoRepositoryPrisma,
} from "./pedidos/catalogo-repository-prisma.js";
import {
  normalizarExtracao,
} from "./pedidos/extracao/normalizar-extracao.js";

// Teste real CONTROLADO do dispatch ao n8n (Etapa 3.1).
//
// IMPORTANTE: este script NÃO deve rodar automaticamente. Ele executa UM
// POST real para BOTNEXT_PEDIDO_DISPATCH_URL. Rodar somente com autorização
// explícita e com a URL do webhook do n8n configurada no .env.
//
// A extração é CONTROLADA via normalizarExtracao (sem OpenAI); o rascunho é
// construído contra o catálogo REAL do tenant recém-criado; a confirmação usa
// o serviço real; o dispatch usa o cliente HTTP real (fetch). Tudo isolado em
// fixtures temporárias, removidas no final.

const PRODUTO_MENCIONADO = "cachaca premium";

async function executarTeste(): Promise<void> {
  const urlWebhook = process.env.BOTNEXT_PEDIDO_DISPATCH_URL?.trim();

  if (!urlWebhook) {
    throw new Error(
      "BOTNEXT_PEDIDO_DISPATCH_URL não está configurada no .env.",
    );
  }

  const configuracaoOriginalEnv =
    process.env.BOTNEXT_PEDIDO_DISPATCH_ENABLED;

  const tenantId = randomUUID();
  const contaId = randomUUID();
  const empresaId = randomUUID();
  const sessaoId = randomUUID();
  const conversaId = randomUUID();
  const clienteId = randomUUID();
  const mensagemId = randomUUID();
  const extracaoId = randomUUID();
  const produtoId = randomUUID();
  const cervejaId = randomUUID();
  const slug = `teste-dispatch-real-${tenantId}`;

  const textoDoCliente =
    "Quero 2 cachaca premium";

  const agora = new Date();
  const sourceHash = createHash("sha256")
    .update(textoDoCliente)
    .digest("hex");

  // Extração CONTROLADA pelo backend — nenhuma chamada à OpenAI.
  const bruto = {
    itens: [
      {
        quantidade: 2,
        produtoMencionado: PRODUTO_MENCIONADO,
        unidadeMencionada: null,
        embalagemMencionada: null,
        observacaoItem: null,
        ehReferenciaAnterior: false,
      },
    ],
    observacaoPedido: null,
    desistenciaDetectada: false,
    correcaoDetectada: false,
    confianca: 0.99,
  };

  const resultadoExtracao = normalizarExtracao(bruto, {
    confiancaMinima: 0.8,
    modelo: "extracao-controlada-teste",
    versaoExtractor: "extractor-teste-3.1",
    versaoPrompt: "prompt-teste-3.1",
    agora,
  });

  assert.equal(
    resultadoExtracao.status,
    "EXTRAIDO",
  );

  let registrosCriados = false;
  let rascunhoId: string | null = null;
  let fetchGlobalOriginal: typeof globalThis.fetch | null = null;

  try {
    // ------------------------------------------------------------- fixtures
    await prisma.$transaction(
      async (transaction) => {
        await transaction.tenant.create({
          data: {
            id: tenantId,
            name: "Tenant temporário do teste real dispatch",
            slug,
            arbrainDataId: -1,
            active: false,
          },
        });

        await transaction.botnextAccount.create({
          data: {
            id: contaId,
            tenantId,
            companyId: empresaId,
            name: "Conta fictícia do teste real dispatch",
            active: false,
          },
        });

        await transaction.cliente.create({
          data: {
            id: clienteId,
            tenantId,
            arbrainId: `arb-cli-teste-dispatch-${tenantId}`,
            sku: -9901,
            syncedAt: agora,
            lastSeenAt: agora,
          },
        });

        await transaction.botnextConversation.create({
          data: {
            id: conversaId,
            tenantId,
            clienteId,
            botnextAccountId: contaId,
            sessionId: sessaoId,
            status: BotnextConversationStatus.ACTIVE,
            lastMessageAt: agora,
          },
        });

        await transaction.botnextConversationMessage.create({
          data: {
            id: mensagemId,
            conversationId: conversaId,
            externalMessageId: mensagemId,
            role: BotnextConversationMessageRole.CUSTOMER,
            messageType: "TEXT",
            text: textoDoCliente,
            eventDate: agora,
          },
        });

        await transaction.botnextPedidoExtracao.create({
          data: {
            id: extracaoId,
            tenantId,
            conversationId: conversaId,
            sourceMessageId: mensagemId,
            status: BotnextPedidoExtracaoStatus.EXTRAIDO,
            sourceHash,
            inputText: textoDoCliente,
            itensExtraidos: JSON.parse(
              JSON.stringify(resultadoExtracao),
            ),
            observacoes: resultadoExtracao.observacaoPedido,
            extractorModel: resultadoExtracao.modelo,
            extractorVersion: resultadoExtracao.versaoExtractor,
            promptVersion: resultadoExtracao.versaoPrompt,
            confianca: resultadoExtracao.confiancaIa,
            extractedAt: agora,
          },
        });

        await transaction.produto.create({
          data: {
            id: produtoId,
            tenantId,
            arbrainId: `arb-p-teste-dispatch-${tenantId}`,
            sku: -9902,
            nome: "Cachaça Premium",
            syncedAt: agora,
            lastSeenAt: agora,
          },
        });

        // PRONTO (sem hint) exige as DUAS fontes contribuindo e PRODUTO
        // vencendo por rank estritamente maior (NOME_EXATO 3 > TOKENS 2).
        await transaction.cerveja.create({
          data: {
            id: cervejaId,
            tenantId,
            arbrainId: `arb-c-teste-dispatch-${tenantId}`,
            sku: -9903,
            nome: "Cachaça Premium Malbec",
            syncedAt: agora,
            lastSeenAt: agora,
          },
        });
      },
    );

    registrosCriados = true;

    console.log(
      "Fixtures isoladas criadas (tenant, conversa, mensagem, extração, catálogo, cliente).",
    );

    // ------------------------------------------------------- 1) rascunho
    const construcao = await criarServicoConstrucaoRascunho({
      catalogo: criarCatalogoRepositoryPrisma(prisma),
    })({ tenantId, extracaoId });

    assert.equal(
      construcao.situacao,
      "RASCUNHO_CRIADO",
    );

    if (construcao.situacao !== "RASCUNHO_CRIADO") {
      throw new Error(
        `Rascunho não criado: ${construcao.situacao}`,
      );
    }

    rascunhoId = construcao.rascunhoId;

    console.log(
      `Rascunho criado: status=${construcao.status}, total=${construcao.totalItens}, resolvidos=${construcao.itensResolvidos}, naoResolvidos=${construcao.itensNaoResolvidos}.`,
    );

    console.log(
      "Conteúdo do rascunho:",
      JSON.stringify(construcao.conteudo, null, 2),
    );

    assert.equal(
      construcao.status,
      BotnextPedidoRascunhoStatus.PRONTO,
      "O rascunho deveria ficar PRONTO (0 pendências).",
    );

    assert.equal(
      construcao.itensNaoResolvidos,
      0,
    );

    assert.equal(
      construcao.totalItens,
      1,
    );

    console.log(
      `Rascunho PRONTO criado: ${construcao.rascunhoId} (${construcao.totalItens} item, 0 pendências).`,
    );

    // ------------------------------------------------------- 2) confirmação
    const confirmacao = await criarServicoConfirmacaoRascunho()({
      tenantId,
      rascunhoId: construcao.rascunhoId,
    });

    assert.equal(
      confirmacao.situacao,
      "CONFIRMADO",
    );

    console.log(
      `Pedido CONFIRMADO: dispatchKey=${confirmacao.dispatchKey}, revision=${confirmacao.revision}.`,
    );

    // -------------------------------------------- 3) habilita só o processo
    // Reforça BOTNEXT_PEDIDO_DISPATCH_ENABLED=true neste processo.
    process.env.BOTNEXT_PEDIDO_DISPATCH_ENABLED = "true";

    // 4) Observabilidade: conta TODAS as chamadas HTTP do processo (via fetch
    // global) para provar que existe só 1 POST, apenas para a URL do webhook.
    fetchGlobalOriginal = globalThis.fetch;
    let chamadasFetch = 0;
    const urlsFetch: string[] = [];
    globalThis.fetch = (async (
      ...args: Parameters<typeof fetch>
    ) => {
      chamadasFetch += 1;
      urlsFetch.push(String(args[0]));
      return fetchGlobalOriginal!(...args);
    }) as unknown as typeof fetch;

    // 5) Wrapper de log no cliente HTTP injetável — imprime o payload REAL e a
    // resposta REAL do n8n, sem alterar o contrato do dispatcher.
    const postagens: Array<{
      url: string;
      resultado: number | string;
      corpo: unknown;
    }> = [];

    const enviadorHttpComLog: EnviadorHttp = async (req) => {
      console.log(
        "Payload PEDIDO_CONFIRMADO_V1 enviado:",
        JSON.stringify(req.corpo, null, 2),
      );

      const resposta = await enviarJsonComFetch(req);

      if (resposta.tipo === "RESPOSTA") {
        postagens.push({
          url: req.url,
          resultado: resposta.status,
          corpo: resposta.corpo,
        });
        console.log("STATUS HTTP recebido:", resposta.status);
        console.log(
          "RESPOSTA do n8n:",
          JSON.stringify(resposta.corpo ?? null),
        );
      } else {
        postagens.push({
          url: req.url,
          resultado: resposta.tipo,
          corpo: resposta,
        });
        console.log(
          "Sem resposta HTTP (tipo de envio):",
          JSON.stringify(resposta),
        );
      }

      return resposta;
    };

    console.log(
      `Enviando 1 POST real para ${urlWebhook}...`,
    );

    // -------------------------------------------- 6) dispatch real (1 POST)
    const dispatch = await criarServicoDispatchPedido({
      enviadorHttp: enviadorHttpComLog,
    })({
      tenantId,
      rascunhoId: construcao.rascunhoId,
    });

    console.log(
      `Resultado primeira tentativa: ${dispatch.situacao}`,
    );

    assert.equal(
      dispatch.situacao,
      "ENVIADO",
      "O teste real espera 2xx do webhook neste cenário.",
    );

    const rascunhoPersistido =
      await prisma.botnextPedidoRascunho.findUniqueOrThrow({
        where: {
          tenantId_extracaoId: { tenantId, extracaoId },
        },
      });

    assert.equal(
      rascunhoPersistido.status,
      BotnextPedidoRascunhoStatus.DESPACHADO,
    );

    assert.ok(
      rascunhoPersistido.dispatchedAt instanceof Date,
    );

    assert.equal(
      rascunhoPersistido.dispatchAttempts,
      1,
    );

    console.log(
      "OK: status DESPACHADO + dispatchedAt persistidos após o POST.",
    );

    // ------------------------------ 7) repetição: sem segundo POST real
    const repeticao = await criarServicoDispatchPedido({
      enviadorHttp: enviadorHttpComLog,
    })({
      tenantId,
      rascunhoId: construcao.rascunhoId,
    });

    console.log(
      `Resultado segunda tentativa: ${repeticao.situacao}`,
    );

    assert.equal(
      repeticao.situacao,
      "JA_DESPACHADO",
    );

    const aposRepeticao =
      await prisma.botnextPedidoRascunho.findUniqueOrThrow({
        where: {
          tenantId_extracaoId: { tenantId, extracaoId },
        },
      });

    assert.equal(
      aposRepeticao.dispatchAttempts,
      1,
      "A repetição não deveria ter feito um segundo POST.",
    );

    // ------------------------------------------- 8) provas de isolamento
    assert.equal(
      postagens.length,
      1,
      "Deveria existir exatamente 1 POST enviado ao webhook.",
    );

    assert.equal(
      postagens[0]!.url,
      urlWebhook,
      "O único POST deveria ir para a URL do webhook.",
    );

    assert.equal(
      chamadasFetch,
      1,
      "Nenhuma outra chamada HTTP (OpenAI/ArBrain/BotNext) deveria existir.",
    );

    assert.ok(
      urlsFetch[0] === urlWebhook,
      "A única chamada HTTP do processo deveria ser o webhook do n8n.",
    );

    console.log(
      `POSTs efetivos realizados: ${postagens.length}`,
    );

    console.log(
      "OK: repetição retornou JA_DESPACHADO sem segundo POST (idempotência).",
    );

    console.log(
      "Teste real do dispatch ao n8n aprovado.",
    );
  } finally {
    if (fetchGlobalOriginal !== null) {
      globalThis.fetch = fetchGlobalOriginal;
      fetchGlobalOriginal = null;
    }

    if (configuracaoOriginalEnv === undefined) {
      delete process.env.BOTNEXT_PEDIDO_DISPATCH_ENABLED;
    } else {
      process.env.BOTNEXT_PEDIDO_DISPATCH_ENABLED =
        configuracaoOriginalEnv;
    }

    if (registrosCriados) {
      const limpeza = [];

      if (rascunhoId) {
        limpeza.push(
          prisma.botnextPedidoRascunho.deleteMany({
            where: { id: rascunhoId, tenantId },
          }),
        );
      }

      limpeza.push(
        prisma.botnextPedidoExtracao.deleteMany({
          where: { id: extracaoId, tenantId },
        }),

        prisma.botnextConversationMessage.deleteMany({
          where: { id: mensagemId, conversationId: conversaId },
        }),

        prisma.produto.deleteMany({
          where: { id: produtoId, tenantId },
        }),

        prisma.cerveja.deleteMany({
          where: { id: cervejaId, tenantId },
        }),

        prisma.botnextConversation.deleteMany({
          where: { id: conversaId, tenantId },
        }),

        prisma.cliente.deleteMany({
          where: { id: clienteId, tenantId },
        }),

        prisma.botnextAccount.deleteMany({
          where: { id: contaId, tenantId },
        }),

        prisma.tenant.deleteMany({
          where: { id: tenantId, slug, active: false },
        }),
      );

      await prisma.$transaction(limpeza);

      console.log(
        "OK: fixtures temporárias do teste foram removidas.",
      );
    }
  }
}

executarTeste()
  .catch((error: unknown) => {
    console.error(
      "Falha no teste:",
      error instanceof Error
        ? error.message
        : "Erro desconhecido",
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });