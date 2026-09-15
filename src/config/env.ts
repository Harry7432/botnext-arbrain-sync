import "dotenv/config";
import { z } from "zod";
import { normalizarTelefoneBrasil } from "../visitas/telefone-service.js";

// Aceita números brasileiros com 55 + DDD + número.
// Use somente dígitos, sem espaços, parênteses ou "+".
const telefoneSchema = z
  .string()
  .trim()
  .transform((valor, ctx) => {
    const normalizado = normalizarTelefoneBrasil(valor);
    if (!normalizado) {
      ctx.addIssue({
        code: "custom",
        message: "Informe um telefone brasileiro válido.",
      });
      return z.NEVER;
    }

    return normalizado.numeroComCodigoPais;
  });

// Converte o JSON do .env em um objeto de parâmetros.
const parametrosTemplateSchema = z
  .string()
  .default("{}")
  .transform((texto, ctx): unknown => {
    try {
      return JSON.parse(texto);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Parametros do template devem ser um JSON valido.",
      });

      return z.NEVER;
    }
  })
  .pipe(
    z.record(
      z.string(),
      z.string().nullable(),
    ),
  );

const envSchema = z.object({
  // ArBrain: configurações existentes.
  ARBRAIN_BASE_URL: z.string().trim().url(),
  ARBRAIN_API_KEY: z.string().trim().min(1),
  ARBRAIN_DATA_ID: z.coerce.number().int().positive(),
  ARBRAIN_TIMEOUT_SECONDS: z.coerce.number().int().positive(),

    // Redis: fila local no desenvolvimento e privada no Coolify.
  REDIS_URL: z
    .string()
    .trim()
    .url("REDIS_URL deve ser uma URL válida.")
    .refine(
      (valor) =>
        valor.startsWith("redis://") ||
        valor.startsWith("rediss://"),
      "REDIS_URL deve começar com redis:// ou rediss://.",
    ),
  // BotNext: endereço da API.
  BOTNEXT_BASE_URL: z
    .string()
    .trim()
    .url()
    .startsWith("https://", "A URL do BotNext deve usar HTTPS."),

  // Informe somente o token, sem o prefixo Bearer.
  BOTNEXT_API_TOKEN: z
    .string()
    .trim()
    .min(1, "Informe o token do BotNext.")
    .refine(
      (token) => !/^Bearer\s/i.test(token),
      "Informe somente o token, sem Bearer.",
    ),
    BOTNEXT_COMPANY_ID: z
  .string()
  .trim()
  .uuid("BOTNEXT_COMPANY_ID deve ser um UUID válido."),

  BOTNEXT_FROM: telefoneSchema,
  BOTNEXT_TEST_TO: telefoneSchema,

  BOTNEXT_TEMPLATE_ID: z
    .string()
    .trim()
    .min(1, "Informe o ID do template."),

  BOTNEXT_TEMPLATE_PARAMETERS_JSON: parametrosTemplateSchema,

  // Converte explicitamente os textos em booleanos.
  // Se omitidas, as opções mantêm teste ativo e envio desativado.
  BOTNEXT_TEST_MODE: z
    .enum(["true", "false"])
    .default("true")
    .transform((valor) => valor === "true"),

  BOTNEXT_SEND_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((valor) => valor === "true"),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Configuracoes de ambiente invalidas.");

  // Exibe somente os nomes das configurações com problema.
  // Não imprime tokens, telefones ou valores dos parâmetros.
  const camposInvalidos = [
    ...new Set(
      result.error.issues.map(
        (issue) => String(issue.path[0] ?? "configuracao"),
      ),
    ),
  ];

  console.error("Revise no .env:", camposInvalidos.join(", "));

  throw new Error("Falha ao validar as configuracoes.");
}

export const env = result.data;
