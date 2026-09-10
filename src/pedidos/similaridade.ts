// Similaridade de strings para o estágio FUZZY.
//
// Coeficiente de Sørensen–Dice sobre bigramas de caracteres. Escolhido por ser:
//  - determinístico e simétrico (dice(a,b) === dice(b,a));
//  - no intervalo fechado [0,1];
//  - tolerante a erros de digitação, ordem de palavras e palavras extras;
//  - implementável em poucas linhas, sem dependências.
//
// As entradas devem vir JÁ normalizadas (ver normalizarTexto).

function bigramas(texto: string): Map<string, number> {
  const contagem = new Map<string, number>();

  for (let i = 0; i < texto.length - 1; i += 1) {
    const par = texto.slice(i, i + 2);
    contagem.set(par, (contagem.get(par) ?? 0) + 1);
  }

  return contagem;
}

/**
 * dice(a,b) = 2 * |interseção de bigramas| / (|bigramas(a)| + |bigramas(b)|)
 *
 * Casos de borda determinísticos:
 *  - strings iguais → 1;
 *  - alguma string com menos de 2 caracteres → 1 se forem iguais, senão 0
 *    (não há bigramas para comparar).
 */
export function coeficienteDice(a: string, b: string): number {
  if (a === b) {
    return 1;
  }

  if (a.length < 2 || b.length < 2) {
    return 0;
  }

  const bigramasA = bigramas(a);
  const bigramasB = bigramas(b);

  let totalA = 0;
  for (const n of bigramasA.values()) {
    totalA += n;
  }

  let totalB = 0;
  for (const n of bigramasB.values()) {
    totalB += n;
  }

  let intersecao = 0;
  for (const [par, quantidadeA] of bigramasA) {
    const quantidadeB = bigramasB.get(par) ?? 0;
    intersecao += Math.min(quantidadeA, quantidadeB);
  }

  return (2 * intersecao) / (totalA + totalB);
}
