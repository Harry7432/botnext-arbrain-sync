import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { prisma } from "../database/prisma.js";
import { listarProdutos } from "../integrations/arbrain/arbrain-produtos.js";

import {
  concluirSyncRun,
  falharSyncRun,
  iniciarSyncRun,
} from "./sync-run-service.js";

import type {
  ArbrainProdutoResumo,
} from "../integrations/arbrain/arbrain-types.js";

const ENTIDADE_SINCRONIZADA = "produtos";

function gerarPayloadHash(
  produto: ArbrainProdutoResumo,
): string {
  const payloadNormalizado = {
    id: produto.id.trim(),
    nome: produto.nome.trim(),
    sku: produto.sku,
  };

  return createHash("sha256")
    .update(JSON.stringify(payloadNormalizado))
    .digest("hex");
}

function validarProdutos(
  produtos: ArbrainProdutoResumo[],
): void {
  const ids = new Set<string>();
  const skus = new Set<number>();

  for (const produto of produtos) {
    if (!produto.id.trim()) {
      throw new Error(
        "Foi encontrado um produto sem ID.",
      );
    }

    if (!produto.nome.trim()) {
      throw new Error(
        `Produto ${produto.id} está sem nome.`,
      );
    }

    if (!Number.isInteger(produto.sku)) {
      throw new Error(
        `Produto ${produto.id} possui SKU inválido.`,
      );
    }

    if (ids.has(produto.id)) {
      throw new Error(
        `ID de produto duplicado: ${produto.id}`,
      );
    }

    if (skus.has(produto.sku)) {
      throw new Error(
        `SKU de produto duplicado: ${produto.sku}`,
      );
    }

    ids.add(produto.id);
    skus.add(produto.sku);
  }
}

export async function sincronizarProdutosResumo(): Promise<void> {
  console.log(
    "Iniciando sincronização dos produtos resumidos...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const produtos = await listarProdutos();

  validarProdutos(produtos);

  console.log(
    `Produtos recebidos e validados: ${produtos.length}`,
  );

  const produtosLocais = await prisma.produto.findMany({
    where: {
      tenantId: tenant.id,
    },
    select: {
      arbrainId: true,
      payloadHash: true,
    },
  });

  const hashesLocais = new Map(
    produtosLocais.map((produto) => [
      produto.arbrainId,
      produto.payloadHash,
    ]),
  );

  const syncRun = await iniciarSyncRun({
    tenantId: tenant.id,
    entity: ENTIDADE_SINCRONIZADA,
    totalRecords: produtos.length,
  });

  console.log(
    `Auditoria iniciada: ${syncRun.status}`,
  );

  let processados = 0;
  let alterados = 0;
  let semAlteracao = 0;

  try {
    for (const produto of produtos) {
      const agora = new Date();
      const novoHash = gerarPayloadHash(produto);
      const hashLocal = hashesLocais.get(produto.id);

      if (hashLocal === novoHash) {
        await prisma.produto.update({
          where: {
            tenantId_arbrainId: {
              tenantId: tenant.id,
              arbrainId: produto.id,
            },
          },
          data: {
            lastSeenAt: agora,
          },
        });

        semAlteracao += 1;
      } else {
        await prisma.produto.upsert({
          where: {
            tenantId_arbrainId: {
              tenantId: tenant.id,
              arbrainId: produto.id,
            },
          },
          update: {
            sku: produto.sku,
            nome: produto.nome.trim(),
            payloadHash: novoHash,
            syncedAt: agora,
            lastSeenAt: agora,
          },
          create: {
            tenantId: tenant.id,
            arbrainId: produto.id,
            sku: produto.sku,
            nome: produto.nome.trim(),
            payloadHash: novoHash,
            syncedAt: agora,
            lastSeenAt: agora,
          },
        });

        alterados += 1;
      }

      processados += 1;

      if (
        processados % 10 === 0 ||
        processados === produtos.length
      ) {
        console.log(
          `Progresso: ${processados}/${produtos.length}`,
        );
      }
    }

    await concluirSyncRun({
      syncRunId: syncRun.id,
      tenantId: tenant.id,
      entity: ENTIDADE_SINCRONIZADA,
      totalRecords: produtos.length,
      processedRecords: processados,
      changedRecords: alterados,
      unchangedRecords: semAlteracao,
    });

    console.log(
      "Sincronização de produtos concluída.",
    );

    console.log(
      `Produtos processados: ${processados}`,
    );

    console.log(
      `Produtos alterados: ${alterados}`,
    );

    console.log(
      `Produtos sem alteração: ${semAlteracao}`,
    );

    console.log(
      "Auditoria finalizada com SUCCESS.",
    );

    console.log(
      "Nenhuma escrita foi enviada ao ArBrain.",
    );
  } catch (error: unknown) {
    try {
      await falharSyncRun({
        syncRunId: syncRun.id,
        processedRecords: processados,
        error,
      });

      console.error(
        "Auditoria finalizada com FAILED.",
      );
    } catch (auditError: unknown) {
      const mensagemAuditoria =
        auditError instanceof Error
          ? auditError.message
          : "Erro desconhecido";

      console.error(
        `Falha ao registrar auditoria: ${mensagemAuditoria}`,
      );
    }

    throw error;
  }
}

async function executarPeloTerminal(): Promise<void> {
  try {
    await sincronizarProdutosResumo();
  } catch (error: unknown) {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido";

    console.error(
      `Falha na sincronização: ${mensagem}`,
    );

    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

const caminhoExecutado = process.argv[1];

const arquivoExecutadoDiretamente =
  caminhoExecutado !== undefined &&
  import.meta.url ===
    pathToFileURL(caminhoExecutado).href;

if (arquivoExecutadoDiretamente) {
  void executarPeloTerminal();
}