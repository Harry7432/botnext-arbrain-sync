import type { Prisma } from "@prisma/client";

import type {
  ArbrainClienteCompleto,
} from "../../integrations/arbrain/arbrain-types.js";

function normalizarTexto(
  valor: string | null | undefined,
): string | null {
  const textoNormalizado = valor?.trim();

  return textoNormalizado ? textoNormalizado : null;
}

export function mapearClienteCompleto(
  cliente: ArbrainClienteCompleto,
): Prisma.ClienteUncheckedUpdateInput {
  return {
    sku: cliente.sku,
    tipo: normalizarTexto(cliente.tipo),
    identificador: normalizarTexto(cliente.identificador),
    numeroDocumento: normalizarTexto(cliente.numeroDocumento),
    razaoSocial: normalizarTexto(cliente.razaoSocial),
    nomeFantasia: normalizarTexto(cliente.nomeFantasia),
    clienteConsumidorFinal: cliente.clienteConsumidorFinal,
    inscricaoEstadual: normalizarTexto(
      cliente.insicaoEstadual,
    ),
    modalidade: normalizarTexto(cliente.modalidade),
    uf: normalizarTexto(cliente.uf),
    cep: normalizarTexto(cliente.cep),
    cidade: normalizarTexto(cliente.cidade),
    bairro: normalizarTexto(cliente.bairro),
    logradouro: normalizarTexto(cliente.logradouro),
    numero: normalizarTexto(cliente.numero),
    complemento: normalizarTexto(cliente.complemento),
    telefone: normalizarTexto(cliente.telefone),
    celular: normalizarTexto(cliente.celular),
    email: normalizarTexto(cliente.email),
    nomeResponsavel: normalizarTexto(cliente.nomeResponsavel),
    diaVisitaPrimario: normalizarTexto(
      cliente.diaVisitaPrimario,
    ),
    diaVisitaSecundario: normalizarTexto(
      cliente.diaVisitaSecundario,
    ),
    periodicidadeDaVisita: normalizarTexto(
      cliente.periodicidadeDaVisita,
    ),
    ordenacaoDaVisita: normalizarTexto(
      cliente.ordenacaoDaVisita,
    ),
    indexSequenciamentoVisita:
      cliente.indexDeSequenciamentoDaVisita,
    informacoesComplementares: normalizarTexto(
      cliente.informacoesComplementares,
    ),
    dataNascimento: normalizarTexto(
      cliente.dataNascimento,
    ),
    descontoPadrao: cliente.descontoPadrao,
    limiteDeCredito: cliente.limiteDeCredito,
    segmentacao: normalizarTexto(cliente.segmentacao),
    idGrupoCliente: normalizarTexto(cliente.idGrupoCliente),
    idTabelaPrecoPrimaria: normalizarTexto(
      cliente.idTabelaDePrecoPrimaria,
    ),
    idTabelaPrecoSecundaria: normalizarTexto(
      cliente.idTabelaDePrecoSecundaria,
    ),
    idCondicaoPagamentoPadrao: normalizarTexto(
      cliente.idCondicaoDePagamentoPadrao,
    ),
    idVendedor: normalizarTexto(cliente.idVendedor),
    clienteAtivo: cliente.clienteAtivo,
    clienteBloqueado: cliente.clienteBloqueado,
    preCadastro: cliente.preCadastro,
  };
}