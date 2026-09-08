import { pathToFileURL } from "node:url";

import cron from "node-cron";

import { reconciliarTodosOsClientes } from "./sync/reconcile-clientes.js";
import { sincronizarClientesResumidos } from "./sync/sync-clientes-resumo.js";
import { sincronizarProdutosResumo } from "./sync/sync-produtos-resumo.js";
import { sincronizarCervejasResumo } from "./sync/sync-cervejas-resumo.js";
import { sincronizarPagamentosResumo } from "./sync/sync-pagamentos-resumo.js";
import { sincronizarBancosResumo } from "./sync/sync-bancos-resumo.js";
import { sincronizarEmpresasResumo } from "./sync/sync-empresas-resumo.js";

const EXPRESSAO_MEIA_NOITE = "0 0 * * *";
const TIMEZONE = "America/Sao_Paulo";

export async function executarSincronizacaoDiaria(): Promise<void> {
  const inicio = new Date();

  console.log(
    `Sincronização agendada iniciada em ${inicio.toISOString()}.`,
  );

  try {
    await sincronizarClientesResumidos();
    await reconciliarTodosOsClientes();
    await sincronizarProdutosResumo();
    await sincronizarCervejasResumo();
    await sincronizarPagamentosResumo();
    await sincronizarBancosResumo();
    await sincronizarEmpresasResumo();

    const fim = new Date();

    console.log(
      `Sincronização agendada concluída em ${fim.toISOString()}.`,
    );
  } catch (error: unknown) {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido";

    console.error(
      `Falha na sincronização agendada: ${mensagem}`,
    );
  }
}

export function iniciarAgendador(): void {
  console.log("Agendador BotNext + ArBrain iniciado.");
  console.log(
    `Sincronização programada para 00:00 — ${TIMEZONE}.`,
  );

  cron.schedule(EXPRESSAO_MEIA_NOITE, executarSincronizacaoDiaria, {
    name: "sincronizacao-arbrain-diaria",
    timezone: TIMEZONE,
    noOverlap: true,
  });
}

const caminhoExecutado = process.argv[1];

const arquivoExecutadoDiretamente =
  caminhoExecutado !== undefined &&
  import.meta.url === pathToFileURL(caminhoExecutado).href;

if (arquivoExecutadoDiretamente) {
  iniciarAgendador();
}
