import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { prisma } from "../database/prisma.js";
import { listarPagamentos } from "../integrations/arbrain/arbrain-pagamentos.js";

import {
  concluirSyncRun,
  falharSyncRun,
  iniciarSyncRun,
} from "./sync-run-service.js";

import type {
  ArbrainPagamentoResumo,
} from "../integrations/arbrain/arbrain-types.js";

const ENTIDADE_SINCRONIZADA = "pagamentos";

function gerarPayloadHash(
  pagamento: ArbrainPagamentoResumo,
): string {
  const payloadNormalizado = {
    id: pagamento.id.trim(),
    nome: pagamento.nome.trim(),
    sku: pagamento.sku,
    possuiVinculoBancario:
      pagamento.possuiVinculoBancario,
  };

  return createHash("sha256")
    .update(JSON.stringify(payloadNormalizado))
    .digest("hex");
}

function validarPagamentos(
  pagamentos: ArbrainPagamentoResumo[],
): void {
  const ids = new Set<string>();

  for (const pagamento of pagamentos) {
    if (!pagamento.id.trim()) {
      throw new Error(
        "Foi encontrado um pagamento sem ID.",
      );
    }

    if (!pagamento.nome.trim()) {
      throw new Error(
        `Pagamento ${pagamento.id} está sem nome.`,
      );
    }

    if (!Number.isInteger(pagamento.sku)) {
      throw new Error(
        `Pagamento ${pagamento.id} possui SKU inválido.`,
      );
    }

    if (
      typeof pagamento.possuiVinculoBancario !==
      "boolean"
    ) {
      throw new Error(
        `Pagamento ${pagamento.id} possui vínculo bancário inválido.`,
      );
    }

    if (ids.has(pagamento.id)) {
      throw new Error(
        `ID de pagamento duplicado: ${pagamento.id}`,
      );
    }

    ids.add(pagamento.id);
  }
}
export async function sincronizarPagamentosResumo(): Promise<void> {
  console.log(
    "Iniciando sincronização dos pagamentos resumidos...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const pagamentos = await listarPagamentos();

  validarPagamentos(pagamentos);

  console.log(
    `Pagamentos recebidos e validados: ${pagamentos.length}`,
  );

  const pagamentosLocais =
    await prisma.pagamento.findMany({
      where: {
        tenantId: tenant.id,
      },
      select: {
        arbrainId: true,
        payloadHash: true,
      },
    });

  const hashesLocais = new Map(
    pagamentosLocais.map((pagamento) => [
      pagamento.arbrainId,
      pagamento.payloadHash,
    ]),
  );

  const syncRun = await iniciarSyncRun({
    tenantId: tenant.id,
    entity: ENTIDADE_SINCRONIZADA,
    totalRecords: pagamentos.length,
  });

  console.log(
    `Auditoria iniciada: ${syncRun.status}`,
  );

  let processados = 0;
  let alterados = 0;
  let semAlteracao = 0;

  try {
    for (const pagamento of pagamentos) {
      const agora = new Date();
      const novoHash = gerarPayloadHash(pagamento);
      const hashLocal = hashesLocais.get(pagamento.id);

      if (hashLocal === novoHash) {
        await prisma.pagamento.update({
          where: {
            tenantId_arbrainId: {
              tenantId: tenant.id,
              arbrainId: pagamento.id,
            },
          },
          data: {
            lastSeenAt: agora,
          },
        });

        semAlteracao += 1;
      } else {
        await prisma.pagamento.upsert({
          where: {
            tenantId_arbrainId: {
              tenantId: tenant.id,
              arbrainId: pagamento.id,
            },
          },
          update: {
            sku: pagamento.sku,
            nome: pagamento.nome.trim(),
            possuiVinculoBancario:
              pagamento.possuiVinculoBancario,
            payloadHash: novoHash,
            syncedAt: agora,
            lastSeenAt: agora,
          },
          create: {
            tenantId: tenant.id,
            arbrainId: pagamento.id.trim(),
            sku: pagamento.sku,
            nome: pagamento.nome.trim(),
            possuiVinculoBancario:
              pagamento.possuiVinculoBancario,
            payloadHash: novoHash,
            syncedAt: agora,
            lastSeenAt: agora,
          },
        });

        alterados += 1;
      }

      processados += 1;

      console.log(
        `Progresso: ${processados}/${pagamentos.length}`,
      );
    }

    await concluirSyncRun({
      syncRunId: syncRun.id,
      tenantId: tenant.id,
      entity: ENTIDADE_SINCRONIZADA,
      totalRecords: pagamentos.length,
      processedRecords: processados,
      changedRecords: alterados,
      unchangedRecords: semAlteracao,
    });

    console.log(
      "Sincronização de pagamentos concluída.",
    );

    console.log(
      `Pagamentos processados: ${processados}`,
    );

    console.log(
      `Pagamentos alterados: ${alterados}`,
    );

    console.log(
      `Pagamentos sem alteração: ${semAlteracao}`,
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
    await sincronizarPagamentosResumo();
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