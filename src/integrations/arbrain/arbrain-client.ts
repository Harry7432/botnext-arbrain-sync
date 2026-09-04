import { env } from "../../config/env.js";
import { ArbrainApiError } from "./arbrain-error.js";

export async function arbrainGet<T>(
  endpoint: string,
): Promise<T> {
  const url = new URL(
    endpoint,
    `${env.ARBRAIN_BASE_URL}/`,
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        ApiKey: env.ARBRAIN_API_KEY,
        dataID: String(env.ARBRAIN_DATA_ID),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(
        env.ARBRAIN_TIMEOUT_SECONDS * 1000,
      ),
    });

    if (!response.ok) {
      throw new ArbrainApiError({
        message:
          `Erro na API ArBrain: HTTP ${response.status} ${response.statusText}`,
        code: "HTTP_ERROR",
        statusCode: response.status,
      });
    }

    return (await response.json()) as T;
  } catch (error: unknown) {
    if (error instanceof ArbrainApiError) {
      throw error;
    }

    if (
      error instanceof Error &&
      error.name === "TimeoutError"
    ) {
      throw new ArbrainApiError({
        message: "A API ArBrain excedeu o tempo limite.",
        code: "TIMEOUT",
      });
    }

    if (error instanceof TypeError) {
      throw new ArbrainApiError({
        message: "Não foi possível conectar à API ArBrain.",
        code: "NETWORK_ERROR",
      });
    }

    throw new ArbrainApiError({
      message: "Ocorreu um erro inesperado na API ArBrain.",
      code: "UNKNOWN_ERROR",
    });
  }
}