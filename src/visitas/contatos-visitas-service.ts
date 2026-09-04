import {
  listarClientesComVisitaSemanal,
} from "./visitas-semanais-service.js";

import {
  normalizarTelefoneBrasil,
} from "./telefone-service.js";

import type {
  TelefoneNormalizado,
} from "./telefone-service.js";

export type ContatoDeVisita = {
  clienteId: string;
  arbrainId: string;
  sku: number;
  nome: string;
  telefone: TelefoneNormalizado;
};

export type ResultadoContatosDeVisita = {
  clientesAnalisados: number;
  contatosProntos: ContatoDeVisita[];
  contatosDuplicados: ContatoDeVisita[];
  clientesSemContato: number;
  contatosInvalidos: number;
};

function possuiValor(
  valor: string | null,
): boolean {
  return valor !== null && valor.trim().length > 0;
}

function obterNomeDoCliente(
  nomeFantasia: string | null,
  razaoSocial: string | null,
  sku: number,
): string {
  if (possuiValor(nomeFantasia)) {
    return nomeFantasia!.trim();
  }

  if (possuiValor(razaoSocial)) {
    return razaoSocial!.trim();
  }

  return `Cliente ${sku}`;
}

export async function prepararContatosDeVisitasSemanais(
  tenantId: string,
  data: Date = new Date(),
): Promise<ResultadoContatosDeVisita> {
  const clientes =
    await listarClientesComVisitaSemanal(
      tenantId,
      data,
    );

  const contatosValidos: ContatoDeVisita[] = [];

  let clientesSemContato = 0;
  let contatosInvalidos = 0;

  for (const cliente of clientes) {
    const contatoEscolhido = possuiValor(cliente.celular)
      ? cliente.celular
      : cliente.telefone;

    if (!possuiValor(contatoEscolhido)) {
      clientesSemContato += 1;
      continue;
    }

    const telefone =
      normalizarTelefoneBrasil(contatoEscolhido);

    if (!telefone) {
      contatosInvalidos += 1;
      continue;
    }

    contatosValidos.push({
      clienteId: cliente.id,
      arbrainId: cliente.arbrainId,
      sku: cliente.sku,
      nome: obterNomeDoCliente(
        cliente.nomeFantasia,
        cliente.razaoSocial,
        cliente.sku,
      ),
      telefone,
    });
  }

  const quantidadePorNumero = new Map<string, number>();

  for (const contato of contatosValidos) {
    const numero =
      contato.telefone.numeroComCodigoPais;

    quantidadePorNumero.set(
      numero,
      (quantidadePorNumero.get(numero) ?? 0) + 1,
    );
  }

  const contatosProntos = contatosValidos.filter(
    (contato) =>
      quantidadePorNumero.get(
        contato.telefone.numeroComCodigoPais,
      ) === 1,
  );

  const contatosDuplicados = contatosValidos.filter(
    (contato) =>
      (quantidadePorNumero.get(
        contato.telefone.numeroComCodigoPais,
      ) ?? 0) > 1,
  );

  return {
    clientesAnalisados: clientes.length,
    contatosProntos,
    contatosDuplicados,
    clientesSemContato,
    contatosInvalidos,
  };
}