import { pathToFileURL } from "node:url";

import { prisma } from "../database/prisma.js";
import { listarClientes } from "../integrations/arbrain/arbrain-clientes.js";

import {
  concluirSyncRun,
  falharSyncRun,
  iniciarSyncRun,
} from "./sync-run-service.js";

import type {
  ArbrainClienteResumo,
} from "../integrations/arbrain/arbrain-types.js";

const TAMANHO_DO_LOTE = 100;
const ENTIDADE_SINCRONIZADA = "clientes_resumo";

interface ClienteResumoNormalizado {
  arbrainId: string;
  nomeFantasia: string;
  sku: number;
}

interface ClienteLocalResumo {
  arbrainId: string;
  nomeFantasia: string | null;
  sku: number;
}

function validarENormalizarClientes(
  clientes: ArbrainClienteResumo[],
): ClienteResumoNormalizado[] {
  const ids = new Set<string>();
  const skus = new Set<number>();

  return clientes.map((cliente, indice) => {
    if (typeof cliente.id !== "string" || !cliente.id.trim()) {
      throw new Error(
        `Cliente na posição ${indice} está sem ID válido.`,
      );
    }

    if (
      typeof cliente.nome !== "string" ||
      !cliente.nome.trim()
    ) {
      throw new Error(
        `Cliente na posição ${indice} está sem nome válido.`,
      );
    }

    if (!Number.isInteger(cliente.sku)) {
      throw new Error(
        `Cliente na posição ${indice} possui SKU inválido.`,
      );
    }

    const arbrainId = cliente.id.trim();

    if (ids.has(arbrainId)) {
      throw new Error(
        "ID de cliente duplicado na resposta da ArBrain.",
      );
    }

    if (skus.has(cliente.sku)) {
      throw new Error(
        `SKU de cliente duplicado na resposta da ArBrain: ${cliente.sku}.`,
      );
    }

    ids.add(arbrainId);
    skus.add(cliente.sku);

    return {
      arbrainId,
      nomeFantasia: cliente.nome.trim(),
      sku: cliente.sku,
    };
  });
}

function validarConflitosDeSku(
  clientes: ClienteResumoNormalizado[],
  clientesLocais: ClienteLocalResumo[],
): void {
  const proprietariosLocais = new Map(
    clientesLocais.map((cliente) => [
      cliente.sku,
      cliente.arbrainId,
    ]),
  );

  for (const cliente of clientes) {
    const proprietario = proprietariosLocais.get(cliente.sku);

    if (
      proprietario !== undefined &&
      proprietario !== cliente.arbrainId
    ) {
      throw new Error(
        `Conflito de SKU ${cliente.sku}: o SKU já pertence a outro cliente local.`,
      );
    }
  }
}

export async function sincronizarClientesResumidos(): Promise<void> {
  console.log("Iniciando sincronização de clientes resumidos...");

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const syncRun = await iniciarSyncRun({
    tenantId: tenant.id,
    entity: ENTIDADE_SINCRONIZADA,
    totalRecords: 0,
  });

  console.log(`Auditoria iniciada: ${syncRun.status}`);

  let totalRegistros = 0;
  let processados = 0;
  let alterados = 0;
  let semAlteracao = 0;

  try {
    const respostaArbrain = await listarClientes();
    const clientes = validarENormalizarClientes(respostaArbrain);

    totalRegistros = clientes.length;

    console.log(
      `Clientes recebidos e validados: ${totalRegistros}`,
    );

    const clientesLocais = await prisma.cliente.findMany({
      where: {
        tenantId: tenant.id,
      },
      select: {
        arbrainId: true,
        sku: true,
        nomeFantasia: true,
      },
    });

    validarConflitosDeSku(clientes, clientesLocais);

    const clientesLocaisPorId = new Map(
      clientesLocais.map((cliente) => [
        cliente.arbrainId,
        cliente,
      ]),
    );

    for (
      let inicio = 0;
      inicio < clientes.length;
      inicio += TAMANHO_DO_LOTE
    ) {
      const lote = clientes.slice(
        inicio,
        inicio + TAMANHO_DO_LOTE,
      );
      const agora = new Date();
      let alteradosNoLote = 0;
      let semAlteracaoNoLote = 0;

      const operacoes = lote.map((cliente) => {
        const clienteLocal = clientesLocaisPorId.get(
          cliente.arbrainId,
        );
        const clienteSemAlteracao =
          clienteLocal !== undefined &&
          clienteLocal.sku === cliente.sku &&
          clienteLocal.nomeFantasia === cliente.nomeFantasia;

        if (clienteSemAlteracao) {
          semAlteracaoNoLote += 1;

          return prisma.cliente.update({
            where: {
              tenantId_arbrainId: {
                tenantId: tenant.id,
                arbrainId: cliente.arbrainId,
              },
            },
            data: {
              lastSeenAt: agora,
            },
          });
        }

        alteradosNoLote += 1;

        return prisma.cliente.upsert({
          where: {
            tenantId_arbrainId: {
              tenantId: tenant.id,
              arbrainId: cliente.arbrainId,
            },
          },
          update: {
            sku: cliente.sku,
            nomeFantasia: cliente.nomeFantasia,
            syncedAt: agora,
            lastSeenAt: agora,
          },
          create: {
            tenantId: tenant.id,
            arbrainId: cliente.arbrainId,
            sku: cliente.sku,
            nomeFantasia: cliente.nomeFantasia,
            syncedAt: agora,
            lastSeenAt: agora,
            payloadHash: null,
          },
        });
      });

      await prisma.$transaction(operacoes);

      processados += lote.length;
      alterados += alteradosNoLote;
      semAlteracao += semAlteracaoNoLote;

      console.log(
        `Progresso: ${processados}/${totalRegistros}`,
      );
    }

    await concluirSyncRun({
      syncRunId: syncRun.id,
      tenantId: tenant.id,
      entity: ENTIDADE_SINCRONIZADA,
      totalRecords: totalRegistros,
      processedRecords: processados,
      changedRecords: alterados,
      unchangedRecords: semAlteracao,
    });

    console.log("Sincronização de clientes resumidos concluída.");
    console.log(`Clientes processados: ${processados}`);
    console.log(`Clientes alterados: ${alterados}`);
    console.log(`Clientes sem alteração: ${semAlteracao}`);
    console.log("Auditoria finalizada com SUCCESS.");
    console.log("Nenhuma escrita foi enviada ao ArBrain.");
  } catch (error: unknown) {
    try {
      await falharSyncRun({
        syncRunId: syncRun.id,
        totalRecords: totalRegistros,
        processedRecords: processados,
        changedRecords: alterados,
        unchangedRecords: semAlteracao,
        error,
      });

      console.error("Auditoria finalizada com FAILED.");
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
    await sincronizarClientesResumidos();
  } catch (error: unknown) {
    const mensagem =
      error instanceof Error ? error.message : "Erro desconhecido";

    console.error(`Falha na sincronização: ${mensagem}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

const caminhoExecutado = process.argv[1];

const arquivoExecutadoDiretamente =
  caminhoExecutado !== undefined &&
  import.meta.url === pathToFileURL(caminhoExecutado).href;

if (arquivoExecutadoDiretamente) {
  void executarPeloTerminal();
}
