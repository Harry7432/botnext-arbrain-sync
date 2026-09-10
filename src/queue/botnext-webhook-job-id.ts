export function criarJobIdEventoBotnext(
  eventoId: string,
  enqueueToken?: string,
): string {
  if (!enqueueToken) {
    return eventoId;
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      enqueueToken,
    )
  ) {
    throw new Error("enqueueToken deve ser um UUID válido.");
  }

  return `${eventoId}-recovery-${enqueueToken}`;
}
