import assert from "node:assert/strict";

import { env } from "./config/env.js";
import { montarTemplateDeTeste } from "./integrations/botnext/botnext-template.js";

function testarTemplate(): void {
  assert.ok(
    env.BOTNEXT_TEST_MODE && !env.BOTNEXT_SEND_ENABLED,
    "Mantenha modo de teste ativo e envio desabilitado.",
  );

  const mensagem = montarTemplateDeTeste();

  assert.ok(
    mensagem.to === env.BOTNEXT_TEST_TO,
    "Destinatario diferente do numero de teste.",
  );

  assert.ok(
    mensagem.from === env.BOTNEXT_FROM,
    "Remetente diferente do configurado.",
  );

  assert.ok(
    mensagem.body.templateId === env.BOTNEXT_TEMPLATE_ID,
    "Template diferente do configurado.",
  );

  assert.ok(
    mensagem.options.forceStartSession === false,
    "Nao devemos forcar um novo atendimento.",
  );

  console.log("Montagem do template validada.");
  console.log("Destinatario restrito ao numero de teste.");
  console.log(
    "Quantidade de parametros:",
    Object.keys(mensagem.body.parameters ?? {}).length,
  );
  console.log("Nenhuma chamada HTTP ou escrita no banco realizada.");
}

try {
  testarTemplate();
} catch (error: unknown) {
  console.error(
    error instanceof Error ? error.message : "Falha no teste.",
  );
  process.exitCode = 1;
}