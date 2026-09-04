import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { prisma } from "../database/prisma.js";

import { listarCervejas } from "../integrations/arbrain/arbrain-cervejas.js";

import {
  concluirSyncRun,
  falharSyncRun,
  iniciarSyncRun,
} from "./sync-run-service.js";

import type {
  ArbrainCervejaResumo,
} from "../integrations/arbrain/arbrain-types.js";

const ENTIDADE_SINCRONIZADA = "cervejas";

function gerarPayloadHash(
  cerveja: ArbrainCervejaResumo,
): string {
  const payloadNormalizado = {
    id: cerveja.id.trim(),
    nome: cerveja.nome.trim(),
    sku: cerveja.sku,
  };

  return createHash("sha256")
    .update(JSON.stringify(payloadNormalizado))
    .digest("hex");
}

function validarCervejas(
  cervejas: ArbrainCervejaResumo[],
): void {
  const ids = new Set<string>();
  const skus = new Set<number>();

  for (const cerveja of cervejas) {
    if (!cerveja.id.trim()) {
      throw new Error(
        "Foi encontrada uma cerveja sem ID.",
      );
    }

    if (!cerveja.nome.trim()) {
      throw new Error(
        `Cerveja ${cerveja.id} está sem nome.`,
      );
    }

    if (!Number.isInteger(cerveja.sku)) {
      throw new Error(
        `Cerveja ${cerveja.id} possui SKU inválido.`,
      );
    }

    if (ids.has(cerveja.id)) {
      throw new Error(
        `ID de cerveja duplicado: ${cerveja.id}`,
      );
    }

    if (skus.has(cerveja.sku)) {
      throw new Error(
        `SKU de cerveja duplicado: ${cerveja.sku}`,
      );
    }

    ids.add(cerveja.id);
    skus.add(cerveja.sku);
  }
}

export async function sincronizarCervejasResumo(): Promise<void> {
  console.log(
    "Iniciando sincronização das cervejas resumidas...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const cervejas = await listarCervejas();

  validarCervejas(cervejas);

  console.log(
    `Cervejas recebidas e validadas: ${cervejas.length}`,
  );

  const cervejasLocais =
    await prisma.cerveja.findMany({
      where: {
        tenantId: tenant.id,
      },
      select: {
        arbrainId: true,
        payloadHash: true,
      },
    });

  const hashesLocais = new Map(
    cervejasLocais.map((cerveja) => [
      cerveja.arbrainId,
      cerveja.payloadHash,
    ]),
  );

  const syncRun = await iniciarSyncRun({
    tenantId: tenant.id,
    entity: ENTIDADE_SINCRONIZADA,
    totalRecords: cervejas.length,
  });

  console.log(
    `Auditoria iniciada: ${syncRun.status}`,
  );

  let processadas = 0;
  let alteradas = 0;
  let semAlteracao = 0;

  try {
    for (const cerveja of cervejas) {
      const agora = new Date();
      const novoHash = gerarPayloadHash(cerveja);

      const hashLocal =
        hashesLocais.get(cerveja.id);

      if (hashLocal === novoHash) {
        await prisma.cerveja.update({
          where: {
            tenantId_arbrainId: {
              tenantId: tenant.id,
              arbrainId: cerveja.id,
            },
          },
          data: {
            lastSeenAt: agora,
          },
        });

        semAlteracao += 1;
      } else {
        await prisma.cerveja.upsert({
          where: {
            tenantId_arbrainId: {
              tenantId: tenant.id,
              arbrainId: cerveja.id,
            },
          },
          update: {
            sku: cerveja.sku,
            nome: cerveja.nome.trim(),
            payloadHash: novoHash,
            syncedAt: agora,
            lastSeenAt: agora,
          },
          create: {
            tenantId: tenant.id,
            arbrainId: cerveja.id,
            sku: cerveja.sku,
            nome: cerveja.nome.trim(),
            payloadHash: novoHash,
            syncedAt: agora,
            lastSeenAt: agora,
          },
        });

        alteradas += 1;
      }

      processadas += 1;

      if (
        processadas % 10 === 0 ||
        processadas === cervejas.length
      ) {
        console.log(
          `Progresso: ${processadas}/${cervejas.length}`,
        );
      }
    }

    await concluirSyncRun({
      syncRunId: syncRun.id,
      tenantId: tenant.id,
      entity: ENTIDADE_SINCRONIZADA,
      totalRecords: cervejas.length,
      processedRecords: processadas,
      changedRecords: alteradas,
      unchangedRecords: semAlteracao,
    });

    console.log(
      "Sincronização de cervejas concluída.",
    );

    console.log(
      `Cervejas processadas: ${processadas}`,
    );

    console.log(`Cervejas alteradas: ${alteradas}`);

    console.log(
      `Cervejas sem alteração: ${semAlteracao}`,
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
        processedRecords: processadas,
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
    await sincronizarCervejasResumo();
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