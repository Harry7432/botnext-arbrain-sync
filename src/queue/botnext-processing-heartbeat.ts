import {
  renovarLeaseEventoBotnext,
} from "./botnext-processing-lease-service.js";

export type LeaseAtivaBotnext = {
  eventoId: string;
  processingToken: string;
  readonly possuiPosse: boolean;
};

type LeaseInterna = LeaseAtivaBotnext & {
  ativa: boolean;
  validadeLocalAte: number;
};

type RenovarLease = typeof renovarLeaseEventoBotnext;

export function criarGerenciadorHeartbeatBotnext(params: {
  intervaloMs: number;
  duracaoLeaseMs: number;
  renovarLease?: RenovarLease;
  registrarErro?: () => void;
}) {
  const leases = new Map<string, LeaseInterna>();
  const renovarLease =
    params.renovarLease ?? renovarLeaseEventoBotnext;
  const registrarErro =
    params.registrarErro ?? (() => {
      console.error("Falha temporária ao renovar lease BotNext.");
    });
  let timer: NodeJS.Timeout | null = null;
  let heartbeatEmAndamento: Promise<void> | null = null;

  function pararTimerSeVazio(): void {
    if (leases.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function renovarLeasesAtivas(): Promise<void> {
    await Promise.all(
      [...leases.values()].map(async (lease) => {
        const inicioRenovacao = performance.now();

        try {
          const resultado = await renovarLease({
            eventoId: lease.eventoId,
            processingToken: lease.processingToken,
            duracaoLeaseMs: params.duracaoLeaseMs,
          });

          if (resultado === "LEASE_LOST") {
            lease.ativa = false;
            leases.delete(lease.processingToken);
          } else {
            lease.validadeLocalAte =
              inicioRenovacao + params.duracaoLeaseMs;
          }
        } catch {
          if (performance.now() >= lease.validadeLocalAte) {
            lease.ativa = false;
            leases.delete(lease.processingToken);
          }

          try {
            registrarErro();
          } catch {
            // Falha de observabilidade não pode derrubar o heartbeat.
          }
        }
      }),
    );

    pararTimerSeVazio();
  }

  async function executarHeartbeat(): Promise<void> {
    if (heartbeatEmAndamento) {
      return heartbeatEmAndamento;
    }

    const heartbeat = renovarLeasesAtivas();
    heartbeatEmAndamento = heartbeat;

    try {
      await heartbeat;
    } finally {
      if (heartbeatEmAndamento === heartbeat) {
        heartbeatEmAndamento = null;
      }
    }
  }

  function acompanhar(
    eventoId: string,
    processingToken: string,
  ): LeaseAtivaBotnext {
    const lease: LeaseInterna = {
      eventoId,
      processingToken,
      ativa: true,
      validadeLocalAte:
        performance.now() + params.duracaoLeaseMs,
      get possuiPosse() {
        return this.ativa &&
          performance.now() < this.validadeLocalAte;
      },
    };

    leases.set(processingToken, lease);

    if (!timer) {
      timer = setInterval(() => {
        void executarHeartbeat();
      }, params.intervaloMs);
    }

    return lease;
  }

  function remover(processingToken: string): void {
    const lease = leases.get(processingToken);

    if (lease) {
      lease.ativa = false;
    }

    leases.delete(processingToken);
    pararTimerSeVazio();
  }

  async function encerrar(): Promise<void> {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    for (const lease of leases.values()) {
      lease.ativa = false;
    }

    leases.clear();

    if (heartbeatEmAndamento) {
      await heartbeatEmAndamento;
    }
  }

  return {
    acompanhar,
    remover,
    executarHeartbeat,
    encerrar,
    quantidadeAtiva: () => leases.size,
  };
}
