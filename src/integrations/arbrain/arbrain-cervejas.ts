import { arbrainGet } from "./arbrain-client.js";

import type {
  ArbrainCervejaResumo,
} from "./arbrain-types.js";

export async function listarCervejas(): Promise<
  ArbrainCervejaResumo[]
> {
  return arbrainGet<ArbrainCervejaResumo[]>(
    "/v1/Cadastros/Cervejas",
  );
}