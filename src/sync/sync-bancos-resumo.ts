import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { prisma } from "../database/prisma.js";

import { listarBancos } from "../integrations/arbrain/arbrain-bancos.js";

import {
  concluirSyncRun,
  falharSyncRun,
  iniciarSyncRun,
} from "./sync-run-service.js";

import type {
  ArbrainBancoResumo,
} from "../integrations/arbrain/arbrain-types.js";

const ENTIDADE_SINCRONIZADA = "bancos";

function gerarPayloadHash(
  banco: ArbrainBancoResumo,
): string {
  const payloadNormalizado = {
    id: banco.id,
    nome: banco.nome.trim(),
    sku: banco.sku,
  };

  return createHash("sha256")
    .update(JSON.stringify(payloadNormalizado))
    .digest("hex");
}

function validarBancos(
  bancos: ArbrainBancoResumo[],
): void {
  const idsEncontrados = new Set<number>();

  for (const banco of bancos) {
    if (!Number.isInteger(banco.id)) {
      throw new Error("Foi encontrado um banco com ID inválido.");
    }

    if (!banco.nome.trim()) {
      throw new Error(
        `Banco ${banco.id} está sem nome.`,
      );
    }

    if (!Number.isInteger(banco.sku)) {
      throw new Error(
        `Banco ${banco.id} possui SKU inválido.`,
      );
    }

    if (idsEncontrados.has(banco.id)) {
      throw new Error(
        `ID de banco duplicado: ${banco.id}`,
      );
    }

    idsEncontrados.add(banco.id);
  }
}

export async function sincronizarBancosResumo(): Promise<void> {
  console.log(
    "Iniciando sincronização dos bancos resumidos...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const bancos = await listarBancos();

  validarBancos(bancos);

  console.log(
    `Bancos recebidos e validados: ${bancos.length}`,
  );

  const bancosLocais = await prisma.banco.findMany({
    where: {
      tenantId: tenant.id,
    },
    select: {
      arbrainId: true,
      payloadHash: true,
    },
  });

  const hashesLocais = new Map(
    bancosLocais.map((banco) => [
      banco.arbrainId,
      banco.payloadHash,
    ]),
  );

  const syncRun = await iniciarSyncRun({
    tenantId: tenant.id,
    entity: ENTIDADE_SINCRONIZADA,
    totalRecords: bancos.length,
  });

  console.log(
    `Auditoria iniciada: ${syncRun.status}`,
  );

  let processados = 0;
  let alterados = 0;
  let semAlteracao = 0;

  try {
    for (const banco of bancos) {
      const agora = new Date();
      const arbrainId = String(banco.id);
      const novoHash = gerarPayloadHash(banco);
      const hashLocal = hashesLocais.get(arbrainId);

      if (hashLocal === novoHash) {
        await prisma.banco.update({
          where: {
            tenantId_arbrainId: {
              tenantId: tenant.id,
              arbrainId,
            },
          },
          data: {
            lastSeenAt: agora,
          },
        });

        semAlteracao += 1;
      } else {
        await prisma.banco.upsert({
          where: {
            tenantId_arbrainId: {
              tenantId: tenant.id,
              arbrainId,
            },
          },
          update: {
            sku: banco.sku,
            nome: banco.nome.trim(),
            payloadHash: novoHash,
            syncedAt: agora,
            lastSeenAt: agora,
          },
          create: {
            tenantId: tenant.id,
            arbrainId,
            sku: banco.sku,
            nome: banco.nome.trim(),
            payloadHash: novoHash,
            syncedAt: agora,
            lastSeenAt: agora,
          },
        });

        alterados += 1;
      }

      processados += 1;

      console.log(
        `Progresso: ${processados}/${bancos.length}`,
      );
    }

    await concluirSyncRun({
      syncRunId: syncRun.id,
      tenantId: tenant.id,
      entity: ENTIDADE_SINCRONIZADA,
      totalRecords: bancos.length,
      processedRecords: processados,
      changedRecords: alterados,
      unchangedRecords: semAlteracao,
    });

    console.log("Sincronização de bancos concluída.");
    console.log(`Bancos processados: ${processados}`);
    console.log(`Bancos alterados: ${alterados}`);
    console.log(
      `Bancos sem alteração: ${semAlteracao}`,
    );
    console.log("Auditoria finalizada com SUCCESS.");
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
    await sincronizarBancosResumo();
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