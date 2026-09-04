export interface ArbrainClienteResumo {
  nome: string;
  id: string;
  sku: number;
}

export interface ArbrainClienteCompleto {
  id: string;
  sku: number;
  tipo: string;
  identificador: string;
  numeroDocumento: string;
  razaoSocial: string;
  nomeFantasia: string;
  clienteConsumidorFinal: boolean;
  insicaoEstadual: string;
  modalidade: string | null;
  uf: string | null;
  cep: string;
  cidade: string;
  bairro: string;
  logradouro: string;
  numero: string;
  complemento: string;
  telefone: string;
  celular: string;
  email: string;
  nomeResponsavel: string;
  diaVisitaPrimario: string;
  diaVisitaSecundario: string;
  periodicidadeDaVisita: string;
  ordenacaoDaVisita: string;
  indexDeSequenciamentoDaVisita: number;
  informacoesComplementares: string;
  dataNascimento: string | null;
  descontoPadrao: number;
  limiteDeCredito: number;
  segmentacao: string;
  idGrupoCliente: string;
  idTabelaDePrecoPrimaria: string;
  idTabelaDePrecoSecundaria: string;
  idCondicaoDePagamentoPadrao: string;
  idVendedor: string;
  clienteAtivo: boolean;
  clienteBloqueado: boolean;
  preCadastro: boolean;
}
export interface ArbrainProdutoResumo {
  nome: string;
  id: string;
  sku: number;
}
export interface ArbrainCervejaResumo {
  nome: string;
  id: string;
  sku: number;
}
export interface ArbrainPagamentoResumo {
  id: string;
  nome: string;
  sku: number;
  possuiVinculoBancario: boolean;
}
export interface ArbrainBancoResumo {
  id: number;
  nome: string;
  sku: number;
}
export type ArbrainEmpresaResumo = {
  nome: string;
  id: string;
  sku: number;
};