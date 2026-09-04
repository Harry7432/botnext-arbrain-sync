import { createHash } from "node:crypto";

import { prisma } from "./database/prisma.js";

import { listarProdutos } from "./integrations/arbrain/arbrain-produtos.js";

import type {
  ArbrainProdutoResumo,
} from "./integrations/arbrain/arbrain-types.js";

function gerarPayloadHash(
  produto: ArbrainProdutoResumo,
): string {
  return createHash("sha256")
    .update(JSON.stringify(produto))
    .digest("hex");
}

async function testarHashes(): Promise<void> {
  console.log(
    "Diagnosticando os hashes dos produtos...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const produtosArbrain = await listarProdutos();

  const produtosLocais = await prisma.produto.findMany({
    where: {
      tenantId: tenant.id,
    },
    select: {
      arbrainId: true,
      payloadHash: true,
    },
  });

  const hashesLocais = new Map(
    produtosLocais.map((produto) => [
      produto.arbrainId,
      produto.payloadHash,
    ]),
  );

  let iguais = 0;
  let diferentes = 0;
  let naoEncontrados = 0;

  for (const produto of produtosArbrain) {
    const hashAtual = gerarPayloadHash(produto);
    const hashLocal = hashesLocais.get(produto.id);

    if (hashLocal === undefined) {
      naoEncontrados += 1;
    } else if (hashLocal === hashAtual) {
      iguais += 1;
    } else {
      diferentes += 1;
    }
  }

  console.log(
    `Produtos recebidos do ArBrain: ${produtosArbrain.length}`,
  );

  console.log(
    `Produtos encontrados no banco: ${produtosLocais.length}`,
  );

  console.log(`Hashes iguais: ${iguais}`);
  console.log(`Hashes diferentes: ${diferentes}`);

  console.log(
    `Produtos não encontrados: ${naoEncontrados}`,
  );

  console.log(
    "Diagnóstico concluído sem alterar dados.",
  );
}

testarHashes()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido";

    console.error(
      `Falha no diagnóstico: ${mensagem}`,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
  