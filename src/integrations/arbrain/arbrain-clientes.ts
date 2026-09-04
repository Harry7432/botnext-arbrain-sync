import { arbrainGet } from "./arbrain-client.js";

import type {
  ArbrainClienteCompleto,
  ArbrainClienteResumo,
} from "./arbrain-types.js";

export async function listarClientes(): Promise<
  ArbrainClienteResumo[]
> {
  return arbrainGet<ArbrainClienteResumo[]>(
    "/v1/Cadastros/Clientes",
  );
}

export async function buscarClientePorId(
  clienteId: string,
): Promise<ArbrainClienteCompleto> {
  const idNormalizado = clienteId.trim();

  if (!idNormalizado) {
    throw new Error("O ID do cliente é obrigatório.");
  }

  const endpoint =
    `/v1/Clientes/${encodeURIComponent(idNormalizado)}`;

  return arbrainGet<ArbrainClienteCompleto>(endpoint);
}