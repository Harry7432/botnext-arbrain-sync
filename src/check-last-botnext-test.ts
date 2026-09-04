import {
  prisma,
} from "./database/prisma.js";

async function consultar():
  Promise<void> {
  const evento =
    await prisma.botnextWebhookEvent.findFirst({
      where: {
        messageText:
          "Primeira mensagem do teste completo",
      },
      orderBy: {
        createdAt:
          "desc",
      },
      select: {
        id:
          true,

        status:
          true,

        processedAt:
          true,

        errorMessage:
          true,

        botnextAccountId:
          true,

        conversationMessage: {
          select: {
            conversationId:
              true,
          },
        },
      },
    });

  console.log(
    JSON.stringify(
      evento,
      null,
      2,
    ),
  );
}

consultar()
  .catch(
    (
      error: unknown,
    ) => {
      const mensagem =
        error instanceof Error
          ? error.message
          : "Erro desconhecido";

      console.error(
        `Falha na consulta: ${mensagem}`,
      );

      process.exitCode = 1;
    },
  )
  .finally(
    async () => {
      await prisma.$disconnect();
    },
  );