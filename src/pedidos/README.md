# src/pedidos — resolução de catálogo (Etapa 2 / 2.8)

Resolvedor **puro e determinístico** que casa um "item comercial" mencionado pelo
cliente contra o catálogo local do tenant. Sem OpenAI, sem ArBrain, sem escrita,
sem integração ao processor. Não cria rascunho, não chama n8n/BotNext, não resolve
embalagem/unidade/preço.

## Duas fontes de catálogo

A investigação real do ArBrain (Etapas 2.6/2.7) mostrou que a **linha de pedido é
polimórfica** — `POST /v1/Pedidos`, `itens[].{ idProduto | idCerveja | idEquipamento }`:

| Fonte | Cadastro ArBrain | Model Prisma | id da linha do pedido | `tipo` da linha |
|---|---|---|---|---|
| `PRODUTO` | `GET /v1/Cadastros/Produtos` | `Produto` (`produtos`) | `idProduto` | `PRODUTO` |
| `CERVEJA` | `GET /v1/Cadastros/Cervejas` | `Cerveja` (`cervejas`) | `idCerveja` | `GARRAFA` / `BARRIL` / `LATA` / … |

- Ambos os cadastros têm shape idêntico `{ id, nome, sku }`. **Não há endpoint de
  detalhe** (`/v1/Produtos/{id}` e `/v1/Cervejas/{id}` retornam 404).
- **`sku` é por catálogo, não global** (`sku=1` = "LICOR DE LIMAO" em produtos e
  "PILSEN HOFFNUNG" em cervejas). O identificador da linha é o **`arbrainId`**
  (string OPACA — formato varia por entidade, nunca parsear), com a `fonte` para
  desambiguar o namespace.
- **Embalagem/volume/unidade/preço** vêm de campos próprios da linha
  (`idEmbalagem`, `idUnidade`, `tipo`, `valorUnitario`) **sem cadastro legível** —
  fora de escopo desta etapa.

`unidadeMencionada` e `embalagemMencionada` da entrada continuam **preservadas e
fora do ranking** (NOME_EXATO / TOKENS / FUZZY) — nada no catálogo as valida.
Ex.: `"3 caixas de pilsen hoffnung"` → o extrator futuro separa
`produtoMencionado: "pilsen hoffnung"` + `unidadeMencionada: "caixa"`; o resolvedor
casa **apenas "pilsen hoffnung"** contra `Cerveja`.

## Arquivos

- `tipos.ts` — `FonteCatalogo`, `ItemCatalogo`, `ResultadoResolucao`,
  `EntradaResolucao` (com `fonteEsperada?`), config.
- `normalizacao.ts` — `normalizarTexto`, `tokenizar`, `conjuntoDeTokens` (inalterado).
- `similaridade.ts` — `coeficienteDice` (Sørensen–Dice sobre bigramas, inalterado).
- `resolver-nucleo.ts` — `resolverContraFonte(...)`: os 4 estágios, puro, **agnóstico
  de fonte**. Também exporta `RANK_ORIGEM`, `NIVEL_STATUS`, comparadores.
- `resolver-produto.ts` — `resolverProduto(entrada, deps)`: carrega `produtos` +
  `produto_aliases`, delega ao núcleo com `fonte:"PRODUTO"`.
- `resolver-cerveja.ts` — `resolverCerveja(entrada, deps)`: carrega `cervejas`
  (sem alias), delega ao núcleo com `fonte:"CERVEJA"`.
- `resolver-item-catalogo.ts` — `resolverItemCatalogo(entrada, deps)`: **entrypoint
  normal**; orquestra as duas fontes.
- `catalogo-repository.ts` / `catalogo-repository-prisma.ts` — camada de acesso
  (fake em memória / PostgreSQL). Prisma é o único a importar `@prisma/client`;
  `orderBy` fixo → ordem estável.

## Estratégia — núcleo por fonte (ordem fixa, para no 1º estágio conclusivo)

1. **ALIAS_DIRETO** — texto normalizado == `aliasNormalizado` de alias **ativo**.
   Só PRODUTO tem aliases nesta etapa (`resolver-cerveja` passa `[]` → estágio
   nunca dispara). Alias inativo → ignorado + `ALIAS_INATIVO_IGNORADO`; alias ativo
   → item inexistente no tenant → `SEM_CORRESPONDENCIA` + `ALIAS_PRODUTO_INVALIDO`.
2. **NOME_EXATO** — `normalizarTexto(nome) === consulta`. 1 → RESOLVIDO; ≥2 → AMBIGUO.
3. **TOKENS** — todos os tokens da consulta contidos no nome. 1 → RESOLVIDO; ≥2 → AMBIGUO.
4. **FUZZY** — Dice(consulta, nome). `< limiar` em todos → SEM_CORRESPONDENCIA;
   1 `>= limiar` → RESOLVIDO; ≥2 `>= limiar` e `topo-2º < margem` → AMBIGUO; senão → RESOLVIDO.

Parâmetros **inalterados**: `limiarFuzzy = 0.60`, `margemAmbiguidadeFuzzy = 0.05`.

## Orquestração entre fontes (`resolverItemCatalogo`)

```
consulta vazia ................................... SEM_CORRESPONDENCIA + ENTRADA_VAZIA
fonteEsperada = "PRODUTO"|"CERVEJA" .............. só essa fonte é consultada
sem hint:
  P = resolverProduto ; C = resolverCerveja
  ambos SEM_CORRESPONDENCIA ...................... SEM_CORRESPONDENCIA (une sinais)
  só um ≠ SEM ................................... esse resultado; se RESOLVIDO, + SEM_CONTEXTO_DE_FONTE
  ambos contribuem:
    vencedorClaro(P,C) ........................... o vencedor (+ sinais do outro)
    empate / sem vencedor ....................... AMBIGUO entre fontes (candidatos unidos) + AMBIGUIDADE_ENTRE_FONTES
```

**vencedorClaro** — `rank`: `ALIAS_DIRETO`=4, `NOME_EXATO`=3, `TOKENS`=2, `FUZZY`=1:
- RESOLVIDO × RESOLVIDO → vence rank **estritamente** maior; empate → nenhum.
- RESOLVIDO × AMBIGUO → o RESOLVIDO vence só se `rank(RESOLVIDO) >= rank(AMBIGUO)`.
- AMBIGUO × AMBIGUO → nenhum.

### Como "stout" nunca vira COPO STOUT indevidamente

1. **`fonteEsperada="CERVEJA"`** (defesa primária, do extrator futuro): `produtos`
   não é consultado → `COPO STOUT` inalcançável.
2. **Cerveja "STOUT" (NOME_EXATO)** vence o produto `COPO STOUT` (TOKENS) por rank →
   resolve para a **cerveja**.
3. **Cerveja "Cerveja Stout" (TOKENS)** empata com `COPO STOUT` (TOKENS) → **AMBIGUO
   entre fontes** com `AMBIGUIDADE_ENTRE_FONTES`, candidatos das duas fontes, `item=null`.
4. **Sem cerveja stout alguma** → `COPO STOUT` resolve por TOKENS **+ sinal
   `SEM_CONTEXTO_DE_FONTE`** (a etapa de confirmação com o cliente decide). A regra
   do cliente só proíbe o copo "se houver cerveja STOUT **ou** contexto de cerveja".

## Formato do resultado

```ts
ResultadoResolucao {
  status: "RESOLVIDO" | "AMBIGUO" | "SEM_CORRESPONDENCIA";
  origemResolucao: "ALIAS_DIRETO" | "NOME_EXATO" | "TOKENS" | "FUZZY" | "SEM_CORRESPONDENCIA";
  fonteCatalogo: "PRODUTO" | "CERVEJA" | null;   // null se SEM_CORRESP. ou ambiguidade entre fontes
  item: { fonteCatalogo, id, tenantId, arbrainId, sku, nome } | null;   // só quando RESOLVIDO
  candidatos: { item, score }[];                  // ≥2 quando AMBIGUO; cada item traz sua fonteCatalogo
  score: number | null;                           // score do item resolvido (FUZZY)
  motivo: string;
  sinais: SinalAuditoria[];
}
```

`SinalAuditoria`: `ENTRADA_VAZIA`, `CATALOGO_VAZIO`, `ALIAS_INATIVO_IGNORADO`,
`ALIAS_PRODUTO_INVALIDO`, `PRODUTO_CROSS_TENANT_IGNORADO`,
`ALIAS_CROSS_TENANT_IGNORADO`, `CERVEJA_CROSS_TENANT_IGNORADO`,
`AMBIGUIDADE_ENTRE_FONTES`, `SEM_CONTEXTO_DE_FONTE`.

## Normalização / ranking / limiar

`NFKD` → remove marcas de combinação `U+0300–U+036F` → `toLowerCase()` →
`[^a-z0-9]+` vira espaço → `trim` → colapsa espaços. Sem stopwords.

Ordenação total de qualquer lista de saída: `fonte` ↑, `nome` normalizado ↑,
`sku` ↑, `id` ↑ (no FUZZY, `score` ↓ antes). Nunca depende da ordem do banco.

`limiarFuzzy = 0.60` fica na lacuna entre "mesmo item com typo" (Dice ~0.71+) e
"item diferente" (<0.2). `margemAmbiguidadeFuzzy = 0.05` para empate fuzzy.
`arbrainId` sempre tratado como string opaca.

## Alias — só PRODUTO nesta etapa

`produto_aliases` continua exclusivo de `Produto`. **Não bloqueia** o desenho: o
núcleo recebe `aliases` como parâmetro e `resolver-cerveja` passa `[]`.

**Futuro (Etapa 3):** `cerveja_aliases` espelhando `produto_aliases` (FK composta
`(tenant_id, cerveja_id) → cervejas(tenant_id, id)`, exigindo `@@unique([tenantId, id])`
em `Cerveja`) — ou um `catalogo_aliases` polimórfico (`fonte` + `refId`). Também
falta sincronizar `/v1/Cadastros/Equipamentos` (descoberto na Etapa 2.7).
