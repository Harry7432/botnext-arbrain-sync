import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { prisma } from "../database/prisma.js";

import { listarEmpresas } from "../integrations/arbrain/arbrain-empresas.js";

import {
  concluirSyncRun,
  falharSyncRun,
  iniciarSyncRun,
} from "./sync-run-service.js";

import type {
  ArbrainEmpresaResumo,
} from "../integrations/arbrain/arbrain-types.js";

const ENTIDADE_SINCRONIZADA = "empresas";

function gerarPayloadHash(
  empresa: ArbrainEmpresaResumo,
): string {
  const payloadNormalizado = {
    id: empresa.id.trim(),
    sku: empresa.sku,
    nome: empresa.nome.trim(),
  };

  return createHash("sha256")
    .update(JSON.stringify(payloadNormalizado))
    .digest("hex");
}

function validarEmpresas(
  empresas: ArbrainEmpresaResumo[],
): void {
  const ids = new Set<string>();
  const skus = new Set<number>();

  for (const empresa of empresas) {
    if (!empresa.id.trim()) {
      throw new Error(
        "Foi encontrada uma empresa sem ID.",
      );
    }

    if (!empresa.nome.trim()) {
      throw new Error(
        `Empresa ${empresa.id} está sem nome.`,
      );
    }

    if (!Number.isInteger(empresa.sku)) {
      throw new Error(
        `Empresa ${empresa.id} possui SKU inválido.`,
      );
    }

    if (ids.has(empresa.id)) {
      throw new Error(
        `ID de empresa duplicado: ${empresa.id}`,
      );
    }

    if (skus.has(empresa.sku)) {
      throw new Error(
        `SKU de empresa duplicado: ${empresa.sku}`,
      );
    }

    ids.add(empresa.id);
    skus.add(empresa.sku);
  }
}

export async function sincronizarEmpresasResumo(): Promise<void> {
  console.log(
    "Iniciando sincronização das empresas resumidas...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const empresas = await listarEmpresas();

  validarEmpresas(empresas);

  console.log(
    `Empresas recebidas e validadas: ${empresas.length}`,
  );

  const empresasLocais = await prisma.empresa.findMany({
    where: {
      tenantId: tenant.id,
    },
    select: {
      arbrainId: true,
      payloadHash: true,
    },
  });

  const hashesLocais = new Map(
    empresasLocais.map((empresa) => [
      empresa.arbrainId,
      empresa.payloadHash,
    ]),
  );

  const syncRun = await iniciarSyncRun({
    tenantId: tenant.id,
    entity: ENTIDADE_SINCRONIZADA,
    totalRecords: empresas.length,
  });

  console.log(`Auditoria iniciada: ${syncRun.status}`);

  let processados = 0;
  let alterados = 0;
  let semAlteracao = 0;

  try {
    for (const empresa of empresas) {
      const agora = new Date();
      const novoHash = gerarPayloadHash(empresa);
      const hashLocal = hashesLocais.get(empresa.id);

      if (hashLocal === novoHash) {
        await prisma.empresa.update({
          where: {
            tenantId_arbrainId: {
              tenantId: tenant.id,
              arbrainId: empresa.id,
            },
          },
          data: {
            lastSeenAt: agora,
          },
        });

        semAlteracao += 1;
      } else {
        await prisma.empresa.upsert({
          where: {
            tenantId_arbrainId: {
              tenantId: tenant.id,
              arbrainId: empresa.id,
            },
          },
          update: {
            sku: empresa.sku,
            nome: empresa.nome.trim(),
            payloadHash: novoHash,
            syncedAt: agora,
            lastSeenAt: agora,
          },
          create: {
            tenantId: tenant.id,
            arbrainId: empresa.id,
            sku: empresa.sku,
            nome: empresa.nome.trim(),
            payloadHash: novoHash,
            syncedAt: agora,
            lastSeenAt: agora,
          },
        });

        alterados += 1;
      }

      processados += 1;

      console.log(
        `Progresso: ${processados}/${empresas.length}`,
      );
    }

    await concluirSyncRun({
      syncRunId: syncRun.id,
      tenantId: tenant.id,
      entity: ENTIDADE_SINCRONIZADA,
      totalRecords: empresas.length,
      processedRecords: processados,
      changedRecords: alterados,
      unchangedRecords: semAlteracao,
    });

    console.log("Sincronização de empresas concluída.");
    console.log(`Empresas processadas: ${processados}`);
    console.log(`Empresas alteradas: ${alterados}`);
    console.log(
      `Empresas sem alteração: ${semAlteracao}`,
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
    await sincronizarEmpresasResumo();
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