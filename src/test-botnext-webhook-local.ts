import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

async function testarWebhookLocal(): Promise<void> {
  const segredo = process.env.BOTNEXT_WEBHOOK_SECRET?.trim();
  const porta = Number(process.env.BOTNEXT_WEBHOOK_PORT ?? "3333");

  if (!segredo || !/^[a-f0-9]{64}$/.test(segredo)) {
    throw new Error("Segredo não configurado corretamente.");
  }

  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    throw new Error("Porta inválida.");
  }

  // Endereço fixado no computador local, nunca na plataforma.
  const endereco = `http://127.0.0.1:${porta}/webhooks/botnext`;

  // Dados inteiramente fictícios, sem informações de clientes.
  const mensagem = {
    eventType: "MESSAGE_RECEIVED",
    content: {
      id: randomUUID(),
      companyId: randomUUID(),
      sessionId: randomUUID(),
      type: "TEXT",
      active: true,
      text: "Mensagem fictícia para teste local.",
      direction: "FROM_HUB",
      details: {
        from: "+5500000000001",
        to: "+5500000000002",
      },
    },
  };

  async function enviarLocal(chave: string, payload: unknown) {
    return fetch(`${endereco}/${chave}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
  }

  // 1. Segredo incorreto deve ser recusado.
  const segredoIncorreto =
    segredo === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64);

  const bloqueada = await enviarLocal(segredoIncorreto, mensagem);

  assert.equal(bloqueada.status, 403);
  await bloqueada.text();

  console.log("OK: segredo incorreto bloqueado.");

  // 2. Atualizações não devem ser tratadas como novas mensagens.
  const ignorada = await enviarLocal(segredo, {
    ...mensagem,
    eventType: "MESSAGE_UPDATED",
  });

  assert.equal(ignorada.status, 200);
  assert.deepEqual(await ignorada.json(), { ignorado: true });

  console.log("OK: MESSAGE_UPDATED ignorado.");

  // 3. Mensagem recebida com formato válido deve passar.
  const aceita = await enviarLocal(segredo, mensagem);

  assert.equal(aceita.status, 200);
  assert.deepEqual(await aceita.json(), {
    validado: true,
    modo: "validacao_local",
    persistido: false,
  });

  console.log("OK: MESSAGE_RECEIVED validado.");
  console.log("Teste local concluído.");
  console.log("Nenhum dado salvo e nenhuma mensagem enviada pelo BotNext.");
}

testarWebhookLocal().catch(() => {
  // Não imprimir o erro bruto: ele pode conter a URL com o segredo.
  console.error(
    "Teste falhou. Confira o servidor ativo, a porta e o segredo no .env.",
  );
  process.exitCode = 1;
});