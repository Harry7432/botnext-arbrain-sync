import { arbrainGet } from "./arbrain-client.js";

import type {
  ArbrainBancoResumo,
} from "./arbrain-types.js";

const ENDPOINT_BANCOS = "/v1/Cadastros/Bancos";

export async function listarBancos(): Promise<
  ArbrainBancoResumo[]
> {
  return arbrainGet<ArbrainBancoResumo[]>(
    ENDPOINT_BANCOS,
  );
}