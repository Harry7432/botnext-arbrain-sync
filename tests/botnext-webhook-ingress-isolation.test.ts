import { describe, expect, it, vi } from "vitest";

import {
  receberEventoWebhookBotnext,
  respostaIngressoWebhookBotnext,
} from "../src/integrations/botnext/botnext-webhook-ingress-service.js";

const evento = {
  eventType: "MESSAGE_RECEIVED",
  externalMessageId: "mensagem-1",
  companyId: "empresa-1",
  sessionId: "sessao-1",
  messageType: "TEXT",
  direction: "FROM_HUB",
  senderPhone: "+55 (11) 98888-0001",
  recipientPhone: "5511977770000",
  messageText: "Quero dois produtos",
  eventDate: new Date("2026-09-11T10:00:00.000Z"),
  payload: { seguro: true },
};

describe("ingresso webhook com isolamento de teste", () => {
  it("telefone autorizado segue para persistência e fila", async () => {
    const obterConta = vi.fn().mockResolvedValue({
      id: "conta-1",
      tenantId: "tenant-1",
    });
    const salvarEvento = vi.fn().mockResolvedValue({
      persistido: true,
      duplicado: false,
      eventoId: "evento-1",
    });
    const enfileirarEvento = vi.fn().mockResolvedValue(undefined);

    const resultado = await receberEventoWebhookBotnext(evento, {
      salvarEvento,
      enfileirarEvento,
      obterConta,
      configuracaoEscopo: {
        modoTeste: true,
        telefoneTeste: "5511988880001",
      },
    });

    expect(resultado).toMatchObject({ situacao: "ACEITO" });
    expect(salvarEvento).toHaveBeenCalledOnce();
    expect(obterConta).toHaveBeenCalledWith("empresa-1");
    expect(enfileirarEvento).toHaveBeenCalledWith("evento-1");
  });

  it("telefone não autorizado retorna sucesso controlado sem persistir ou enfileirar", async () => {
    const obterConta = vi.fn().mockResolvedValue({
      id: "conta-1",
      tenantId: "tenant-1",
    });
    const salvarEvento = vi.fn();
    const enfileirarEvento = vi.fn();

    const resultado = await receberEventoWebhookBotnext(evento, {
      salvarEvento,
      enfileirarEvento,
      obterConta,
      configuracaoEscopo: {
        modoTeste: true,
        telefoneTeste: "5511988880002",
      },
    });
    const resposta = respostaIngressoWebhookBotnext(resultado);

    expect(resposta).toEqual({
      status: 200,
      corpo: {
        recebido: true,
        ignorado: true,
        motivo: "fora_do_escopo_de_teste",
      },
    });
    expect(salvarEvento).not.toHaveBeenCalled();
    expect(obterConta).toHaveBeenCalledWith("empresa-1");
    expect(enfileirarEvento).not.toHaveBeenCalled();
    expect(JSON.stringify(resposta)).not.toContain("5511988880002");
  });

  it("configuração de teste ausente bloqueia persistência e fila", async () => {
    const salvarEvento = vi.fn();
    const enfileirarEvento = vi.fn();
    const obterConta = vi.fn().mockResolvedValue({
      id: "conta-1",
      tenantId: "tenant-1",
    });

    const resultado = await receberEventoWebhookBotnext(evento, {
      salvarEvento,
      enfileirarEvento,
      obterConta,
      configuracaoEscopo: {
        modoTeste: true,
        telefoneTeste: undefined,
      },
    });

    expect(resultado).toEqual({ situacao: "IGNORADO_FORA_DO_ESCOPO" });
    expect(salvarEvento).not.toHaveBeenCalled();
    expect(enfileirarEvento).not.toHaveBeenCalled();
  });
});
