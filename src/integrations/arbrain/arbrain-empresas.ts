import { arbrainGet } from "./arbrain-client.js";

import type {
  ArbrainEmpresaResumo,
} from "./arbrain-types.js";

export async function listarEmpresas(): Promise<
  ArbrainEmpresaResumo[]
> {
  return arbrainGet<ArbrainEmpresaResumo[]>(
    "/v1/Cadastros/Empresas",
  );
}