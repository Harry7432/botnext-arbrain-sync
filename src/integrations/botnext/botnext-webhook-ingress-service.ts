import {
  obterContaBotnextAutorizada,
  salvarEventoBotnext,
  type ContaBotnextAutorizada,
  type ResultadoPersistenciaWebhook,
  type SalvarEventoBotnextParams,
} from "./botnext-webhook-inbox.js";
import { enfileirarEventoBotnext } from "../../queue/botnext-webhook-queue.js";
import {
  avaliarTelefoneNoEscopoBotnext,
  type ConfiguracaoEscopoTesteBotnext,
} from "./botnext-test-scope.js";

export type ResultadoIngressoWebhookBotnext =
  | { situacao: "IGNORADO_FORA_DO_ESCOPO" }
  | ({ situacao: "ACEITO" } & ResultadoPersistenciaWebhook);

export function respostaIngressoWebhookBotnext(
  resultado: ResultadoIngressoWebhookBotnext,
): { status: 200; corpo: Record<string, boolean | string> } {
  if (resultado.situacao === "IGNORADO_FORA_DO_ESCOPO") {
    return {
      status: 200,
      corpo: {
        recebido: true,
        ignorado: true,
        motivo: "fora_do_escopo_de_teste",
      },
    };
  }

  return {
    status: 200,
    corpo: {
      recebido: true,
      persistido: resultado.persistido,
      duplicado: resultado.duplicado,
      enfileirado: true,
    },
  };
}

export type DependenciasIngressoWebhookBotnext = {
  salvarEvento?: typeof salvarEventoBotnext;
  obterConta?: (companyId: string) => Promise<ContaBotnextAutorizada>;
  enfileirarEvento?: typeof enfileirarEventoBotnext;
  configuracaoEscopo?: ConfiguracaoEscopoTesteBotnext;
};

export async function receberEventoWebhookBotnext(
  evento: SalvarEventoBotnextParams,
  dependencias: DependenciasIngressoWebhookBotnext = {},
): Promise<ResultadoIngressoWebhookBotnext> {
  await (
    dependencias.obterConta ?? obterContaBotnextAutorizada
  )(evento.companyId);

  const escopo = avaliarTelefoneNoEscopoBotnext(
    evento.senderPhone,
    dependencias.configuracaoEscopo,
  );

  if (!escopo.permitido) {
    return { situacao: "IGNORADO_FORA_DO_ESCOPO" };
  }

  const persistencia = await (
    dependencias.salvarEvento ?? salvarEventoBotnext
  )(evento);

  if (!persistencia.eventoId) {
    throw new Error("Evento persistido sem identificador.");
  }

  await (dependencias.enfileirarEvento ?? enfileirarEventoBotnext)(
    persistencia.eventoId,
  );

  return { situacao: "ACEITO", ...persistencia };
}
