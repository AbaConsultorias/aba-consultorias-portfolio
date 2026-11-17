import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

// Liberar e ocultar documentos em lote (tela Documentos do admin): schema, plano puro e serviço com a sessão simulada.
// Rota e tela dependem do Supabase e do navegador: a regra da rota é conferida por testar-permissoes-rotas.mjs e testar-permissoes-http.mjs.
// Uso: node scripts/testar-documentos-lote.mjs

const raiz = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const modulos = new Map();

const substitutos = {
  "server-only": {},
  "react": { cache: (fn) => fn },
  "@/lib/supabase/server": { createClient: async () => { throw new Error("o teste injeta a sessão"); } },
  "@/lib/portal/comum/opcoes": { listarOpcoesEmpreendimentos: async () => [] },
};

function carregar(caminho) {
  const arquivo = resolve(raiz, caminho);
  if (modulos.has(arquivo)) return modulos.get(arquivo).exports;
  const modulo = { exports: {} };
  modulos.set(arquivo, modulo);
  const codigo = ts.transpileModule(readFileSync(arquivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: arquivo,
  }).outputText;
  const importar = (nome) => {
    if (Object.hasOwn(substitutos, nome)) return substitutos[nome];
    if (nome.startsWith("@/")) return carregar(`src/${nome.slice(2)}.ts`);
    if (nome.startsWith(".")) return carregar(`${resolve(dirname(arquivo), nome)}.ts`);
    return require(nome);
  };
  runInThisContext(`(function(require, module, exports) {${codigo}\n})`, { filename: arquivo })(importar, modulo, modulo.exports);
  return modulo.exports;
}

const PASTA = "src/app/api/(modules)/adm-interno/portal/documentos/lote";
const { loteSchema } = carregar(`${PASTA}/schema.ts`);
const { alterarLiberacaoEmLote } = carregar(`${PASTA}/service.ts`);
const { criadoDepois, normalizarCriadoEm, planejarAlteracaoEmLote, resumirLote } = carregar("src/lib/portal/documentos/lote.ts");
const { MAXIMO_LOTE } = carregar("src/lib/portal/conector/fila.ts");
const { ForbiddenError, InternalServerError } = carregar("src/app/api/HttpErrors.ts");

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PDF = "application/pdf";
const ids = (total) => Array.from({ length: total }, (_, i) => uuid(i + 1));

// ---------------------------------------------------------------------------------------------------------------
// Validação do corpo.
// ---------------------------------------------------------------------------------------------------------------

assert.equal(MAXIMO_LOTE, 100);
assert.equal(loteSchema.safeParse({ ids: ids(1), liberado: true }).success, true);
assert.equal(loteSchema.safeParse({ ids: ids(1), liberado: false }).success, true, "ocultar");
assert.equal(loteSchema.safeParse({ ids: ids(100), liberado: true }).success, true);
assert.equal(loteSchema.safeParse({ ids: ids(101), liberado: true }).success, false, "máximo 100 por chamada");
assert.equal(loteSchema.safeParse({ ids: [], liberado: true }).success, false, "vazio");
assert.equal(loteSchema.safeParse({ ids: [uuid(1), uuid(1)], liberado: true }).success, false, "repetidos");
assert.equal(loteSchema.safeParse({ ids: ["abc"], liberado: true }).success, false, "id que não é uuid");
assert.equal(loteSchema.safeParse({ ids: ids(2), liberado: true, titulo: "x" }).success, false, "campo extra");
assert.equal(loteSchema.safeParse({ ids: ids(2) }).success, false, "sem liberado");
assert.equal(loteSchema.safeParse({ ids: ids(2), liberado: "true" }).success, false, "liberado tem de ser booleano de verdade");
assert.equal(loteSchema.safeParse({ liberado: true }).success, false, "sem ids");
assert.equal(loteSchema.safeParse(null).success, false);
assert.deepEqual(loteSchema.parse({ ids: [uuid(1)], liberado: false }), { ids: [uuid(1)], liberado: false });

// ---------------------------------------------------------------------------------------------------------------
// Plano puro.
// ---------------------------------------------------------------------------------------------------------------

const linha = (n, extra = {}) => ({
  id: uuid(n), familiaId: uuid(n), criadoEm: `2026-11-0${n}T10:00:00.000Z`, mime: PDF, liberado: false, temVersaoMaisNova: false, ...extra,
});
const motivoDe = (plano, n) => plano.ignorados.find((item) => item.id === uuid(n))?.motivo;

{
  const plano = planejarAlteracaoEmLote(
    [uuid(1), uuid(2), uuid(3), uuid(4), uuid(404)],
    [linha(1), linha(2, { liberado: true }), linha(3, { mime: "image/png" }), linha(4, { temVersaoMaisNova: true })],
    true,
  );
  assert.deepEqual(plano.alterar, [uuid(1)]);
  assert.equal(motivoDe(plano, 2), "Já está liberado.");
  assert.equal(motivoDe(plano, 3), "Só PDF pode ser liberado.");
  assert.equal(motivoDe(plano, 4), "Existe uma versão mais nova deste arquivo.");
  assert.equal(motivoDe(plano, 404), "Documento não encontrado.");
}
{
  // Ocultar não olha mime nem família.
  const plano = planejarAlteracaoEmLote(
    [uuid(1), uuid(2), uuid(3)],
    [linha(1, { liberado: true }), linha(2), linha(3, { liberado: true, mime: "image/png", temVersaoMaisNova: true })],
    false,
  );
  assert.deepEqual(plano.alterar, [uuid(1), uuid(3)]);
  assert.equal(motivoDe(plano, 2), "Já está oculto.");
}
{
  // Mesmo sem a marca vinda do banco, a versão mais velha da seleção não sobe.
  const familia = uuid(50);
  const plano = planejarAlteracaoEmLote([uuid(1), uuid(2)], [
    linha(1, { familiaId: familia, criadoEm: "2026-11-01T10:00:00.000Z" }),
    linha(2, { familiaId: familia, criadoEm: "2026-11-02T10:00:00.000Z" }),
  ], true);
  assert.deepEqual(plano.alterar, [uuid(2)]);
  assert.equal(motivoDe(plano, 1), "Existe uma versão mais nova na seleção.");
}
{
  // Mesma data: o id maior ganha, nunca sobem as duas.
  const familia = uuid(50);
  const mesmaData = "2026-11-05T10:00:00.000Z";
  const plano = planejarAlteracaoEmLote([uuid(7), uuid(8)], [
    linha(7, { familiaId: familia, criadoEm: mesmaData }),
    linha(8, { familiaId: familia, criadoEm: mesmaData }),
  ], true);
  assert.deepEqual(plano.alterar, [uuid(8)]);
  assert.equal(motivoDe(plano, 7), "Existe uma versão mais nova na seleção.");
}
{
  // Ocultar duas versões da mesma família oculta as duas.
  const familia = uuid(50);
  const plano = planejarAlteracaoEmLote([uuid(1), uuid(2)], [
    linha(1, { familiaId: familia, liberado: true }),
    linha(2, { familiaId: familia, liberado: true }),
  ], false);
  assert.deepEqual(plano.alterar, [uuid(1), uuid(2)]);
}
{
  // Microssegundos contam, e o id só desempata datas realmente iguais.
  const antiga = { id: uuid(9), criadoEm: "2026-11-05T10:00:00.000001+00:00" };
  const nova = { id: uuid(2), criadoEm: "2026-11-05T10:00:00.000002+00:00" };
  assert.equal(criadoDepois(nova, antiga), true);
  assert.equal(criadoDepois(antiga, nova), false);
  assert.equal(criadoDepois({ id: uuid(9), criadoEm: nova.criadoEm }, nova), true, "mesma data: o id maior");
  assert.equal(criadoDepois(nova, { ...nova }), false, "o mesmo documento não é mais novo que ele mesmo");
  const plano = planejarAlteracaoEmLote([uuid(9), uuid(2)], [
    linha(9, { familiaId: uuid(1), criadoEm: antiga.criadoEm }),
    linha(2, { familiaId: uuid(1), criadoEm: nova.criadoEm }),
  ], true);
  assert.deepEqual(plano.alterar, [uuid(2)]);
  assert.equal(motivoDe(plano, 9), "Existe uma versão mais nova na seleção.");
}
{
  // O Postgres omite zeros finais da fração e o deslocamento pode variar: tudo vira UTC com 6 casas.
  assert.equal(normalizarCriadoEm("2026-11-05T10:00:00.5+00:00"), "2026-11-05T10:00:00.500000Z");
  assert.equal(normalizarCriadoEm("2026-11-05T10:00:00+00:00"), "2026-11-05T10:00:00.000000Z");
  assert.equal(normalizarCriadoEm("2026-11-05 10:00:00.123456+00"), "2026-11-05T10:00:00.123456Z");
  assert.equal(normalizarCriadoEm("2026-11-05T07:00:00.000001-03:00"), "2026-11-05T10:00:00.000001Z");
  assert.equal(normalizarCriadoEm("2026-11-05T10:00:00.123456Z"), "2026-11-05T10:00:00.123456Z");
  assert.equal(normalizarCriadoEm("lixo"), "lixo");
  assert.equal(criadoDepois({ id: uuid(1), criadoEm: "2026-11-05T10:00:00.5+00:00" }, { id: uuid(2), criadoEm: "2026-11-05T10:00:00.49+00:00" }), true);
  assert.equal(criadoDepois({ id: uuid(1), criadoEm: "2026-11-05T07:00:00.000000-03:00" }, { id: uuid(2), criadoEm: "2026-11-05T09:59:59.999999+00:00" }), true);
}
assert.deepEqual(planejarAlteracaoEmLote([], [], true), { alterar: [], ignorados: [] });

assert.equal(
  resumirLote({ alterados: [uuid(1), uuid(2)], ignorados: [], falhas: [] }, true),
  "2 liberado(s)",
);
assert.equal(
  resumirLote({
    alterados: [uuid(1)],
    ignorados: [{ id: uuid(2), motivo: "Já está oculto." }, { id: uuid(3), motivo: "Já está oculto." }],
    falhas: [uuid(4)],
  }, false),
  "1 ocultado(s) · 2 não alterado(s): Já está oculto. · 1 com falha (tente de novo)",
);

// ---------------------------------------------------------------------------------------------------------------
// Serviço com a sessão simulada.
// ---------------------------------------------------------------------------------------------------------------

// Banco em memória só com o que o serviço usa: select(...).in(campo, valores)[.is(campo, null)][.order(campo).range(de, ate)] e
// update(...).eq("id").select("id").maybeSingle(). Como o PostgREST, nenhuma resposta passa de 1000 linhas (o resto é cortado
// sem aviso), e `cortes` conta quantas vezes isso aconteceu.
// `invisiveis` faz o papel do RLS; `erros` e `semEfeito` simulam recusa do banco e UPDATE que não alcança a linha.
const LIMITE_POSTGREST = 1000;

function criarBanco(documentos, extra = {}) {
  return { documentos, invisiveis: new Set(), erros: {}, semEfeito: new Set(), erroLeitura: false, gravacoes: [], leituras: [], cortes: 0, ...extra };
}

function criarSessao(banco) {
  class Consulta {
    constructor() { this.operacao = "select"; this.filtros = []; this.ordenarPor = null; this.faixa = null; }
    select() { return this; }
    in(campo, valores) { banco.leituras.push(campo); this.filtros.push((doc) => valores.includes(doc[campo])); return this; }
    is(campo, valor) { this.filtros.push((doc) => doc[campo] === valor); return this; }
    eq(campo, valor) { this.filtros.push((doc) => doc[campo] === valor); return this; }
    order(campo) { this.ordenarPor = campo; return this; }
    range(de, ate) { this.faixa = [de, ate]; return this; }
    update(campos) { this.operacao = "update"; this.campos = campos; return this; }
    maybeSingle() { return this.executar(true); }
    then(resolver, rejeitar) { return this.executar(false).then(resolver, rejeitar); }
    async executar(unica) {
      if (this.operacao === "select") {
        if (banco.erroLeitura) return { data: null, error: { code: "TEST_LEITURA" } };
        const campo = this.ordenarPor;
        const achadas = banco.documentos.filter((doc) => !banco.invisiveis.has(doc.id) && this.filtros.every((filtro) => filtro(doc)));
        if (campo) achadas.sort((a, b) => (a[campo] < b[campo] ? -1 : a[campo] > b[campo] ? 1 : 0));
        const de = this.faixa?.[0] ?? 0;
        const ate = Math.min(this.faixa?.[1] ?? Infinity, de + LIMITE_POSTGREST - 1);
        if (achadas.length > de + LIMITE_POSTGREST && (this.faixa?.[1] ?? Infinity) >= de + LIMITE_POSTGREST) banco.cortes += 1;
        return { data: achadas.slice(de, ate + 1).map((doc) => ({ ...doc })), error: null };
      }
      const alvo = banco.documentos.find((doc) => !banco.invisiveis.has(doc.id) && this.filtros.every((filtro) => filtro(doc)));
      if (alvo && banco.erros[alvo.id]) return { data: null, error: { code: banco.erros[alvo.id] } };
      if (!alvo || banco.semEfeito.has(alvo.id)) return { data: null, error: null };
      banco.gravacoes.push([alvo.id, { ...this.campos }]);
      Object.assign(alvo, this.campos);
      // Trigger de família: liberar uma versão oculta as outras.
      if (this.campos.liberado_cliente === true) {
        for (const irma of banco.documentos) if (irma.familia_id === alvo.familia_id && irma.id !== alvo.id) irma.liberado_cliente = false;
      }
      return { data: unica ? { id: alvo.id } : [{ id: alvo.id }], error: null };
    }
  }
  return { from: (tabela) => { assert.equal(tabela, "documentos"); return new Consulta(); } };
}

const doc = (n, extra = {}) => ({
  id: uuid(n), familia_id: uuid(n), criado_em: `2026-11-0${n}T10:00:00.000000+00:00`, mime: PDF, liberado_cliente: false, substitui_id: null, ...extra,
});
// Revisão de verdade: aponta para a anterior (substitui_id) e herda a família dela.
const revisao = (n, anterior, extra = {}) => doc(n, { familia_id: uuid(anterior), substitui_id: uuid(anterior), ...extra });

const logs = [];
const consoleOriginal = console.error;
console.error = (...argumentos) => logs.push(argumentos);

async function executar(banco, corpo) {
  const sessao = criarSessao(banco);
  return alterarLiberacaoEmLote(corpo, { criarSessao: async () => sessao });
}

try {
  // Liberar: grava só liberado_cliente, na ordem pedida.
  {
    const banco = criarBanco([doc(1), doc(2), doc(3)]);
    const resultado = await executar(banco, { ids: [uuid(3), uuid(1), uuid(2)], liberado: true });
    assert.deepEqual(resultado, { alterados: [uuid(3), uuid(1), uuid(2)], ignorados: [], falhas: [] });
    assert.deepEqual(banco.gravacoes, [[uuid(3), { liberado_cliente: true }], [uuid(1), { liberado_cliente: true }], [uuid(2), { liberado_cliente: true }]]);
  }

  // Não-PDF não libera.
  {
    const banco = criarBanco([doc(1, { mime: "image/png" }), doc(2)]);
    const resultado = await executar(banco, { ids: [uuid(1), uuid(2)], liberado: true });
    assert.deepEqual(resultado.alterados, [uuid(2)]);
    assert.deepEqual(resultado.ignorados, [{ id: uuid(1), motivo: "Só PDF pode ser liberado." }]);
    assert.equal(banco.documentos[0].liberado_cliente, false);
  }

  // Já no estado pedido é ignorado, sem gravar.
  {
    const banco = criarBanco([doc(1, { liberado_cliente: true }), doc(2)]);
    const liberar = await executar(banco, { ids: [uuid(1)], liberado: true });
    assert.deepEqual(liberar, { alterados: [], ignorados: [{ id: uuid(1), motivo: "Já está liberado." }], falhas: [] });
    const ocultar = await executar(banco, { ids: [uuid(2)], liberado: false });
    assert.deepEqual(ocultar, { alterados: [], ignorados: [{ id: uuid(2), motivo: "Já está oculto." }], falhas: [] });
    assert.deepEqual(banco.gravacoes, []);
  }

  // O que a sessão não enxerga conta como não encontrado.
  {
    const banco = criarBanco([doc(1), doc(2)], { invisiveis: new Set([uuid(2)]) });
    const resultado = await executar(banco, { ids: [uuid(1), uuid(2), uuid(404)], liberado: true });
    assert.deepEqual(resultado.alterados, [uuid(1)]);
    assert.deepEqual(resultado.ignorados, [
      { id: uuid(2), motivo: "Documento não encontrado." },
      { id: uuid(404), motivo: "Documento não encontrado." },
    ]);
  }

  // Duas versões da mesma família na seleção: só a mais nova sobe, em qualquer ordem dos ids.
  for (const ordem of [[uuid(1), uuid(2)], [uuid(2), uuid(1)]]) {
    const familia = uuid(1);
    const banco = criarBanco([
      doc(1, { familia_id: familia, criado_em: "2026-11-01T10:00:00.000000+00:00" }),
      revisao(2, 1, { criado_em: "2026-11-02T10:00:00.000000+00:00" }),
    ]);
    const resultado = await executar(banco, { ids: ordem, liberado: true });
    assert.deepEqual(resultado.alterados, [uuid(2)]);
    assert.deepEqual(resultado.ignorados, [{ id: uuid(1), motivo: "Existe uma versão mais nova na seleção." }]);
    assert.deepEqual(banco.gravacoes.map(([id]) => id), [uuid(2)], "a antiga nunca é gravada");
  }

  // Três versões na seleção e empate de data: criado_em e, depois, o id maior.
  {
    const familia = uuid(1);
    const empate = "2026-11-03T10:00:00.000000+00:00";
    const banco = criarBanco([
      doc(1, { familia_id: familia, criado_em: "2026-11-01T10:00:00.000000+00:00" }),
      revisao(2, 1, { criado_em: empate }),
      revisao(3, 1, { criado_em: empate }),
    ]);
    const resultado = await executar(banco, { ids: [uuid(1), uuid(2), uuid(3)], liberado: true });
    assert.deepEqual(resultado.alterados, [uuid(3)]);
    assert.deepEqual(resultado.ignorados.map((item) => item.id).sort(), [uuid(1), uuid(2)].sort());
    assert.ok(resultado.ignorados.every((item) => item.motivo === "Existe uma versão mais nova na seleção."));
  }

  // Versão mais nova FORA da seleção: a antiga não é liberada.
  {
    const familia = uuid(1);
    const banco = criarBanco([
      doc(1, { familia_id: familia, criado_em: "2026-11-01T10:00:00.000000+00:00" }),
      revisao(2, 1, { criado_em: "2026-11-02T10:00:00.000000+00:00" }),
    ]);
    const resultado = await executar(banco, { ids: [uuid(1)], liberado: true });
    assert.deepEqual(resultado, { alterados: [], ignorados: [{ id: uuid(1), motivo: "Existe uma versão mais nova deste arquivo." }], falhas: [] });
    assert.deepEqual(banco.gravacoes, []);
    assert.ok(banco.leituras.includes("substitui_id"), "o sucessor é achado por substitui_id");
  }

  // A versão mais nova fora da seleção pode ser uma que o cliente já vê: a antiga continua de fora.
  {
    const familia = uuid(1);
    const banco = criarBanco([
      doc(1, { familia_id: familia, criado_em: "2026-11-01T10:00:00.000000+00:00" }),
      revisao(2, 1, { criado_em: "2026-11-02T10:00:00.000000+00:00", liberado_cliente: true }),
    ]);
    const resultado = await executar(banco, { ids: [uuid(1)], liberado: true });
    assert.equal(resultado.alterados.length, 0);
    assert.equal(banco.documentos[1].liberado_cliente, true, "a versão que o cliente vê continua visível");
  }

  // A mais nova dentro da seleção sobe e as antigas da família que estavam visíveis saem pelo trigger.
  {
    const familia = uuid(1);
    const banco = criarBanco([
      doc(1, { familia_id: familia, criado_em: "2026-11-01T10:00:00.000000+00:00", liberado_cliente: true }),
      revisao(2, 1, { criado_em: "2026-11-02T10:00:00.000000+00:00" }),
    ]);
    const resultado = await executar(banco, { ids: [uuid(2)], liberado: true });
    assert.deepEqual(resultado.alterados, [uuid(2)]);
    assert.equal(banco.documentos[0].liberado_cliente, false);
  }

  // Ramificação (duas candidatas da família sem sucessor, criado_em só difere nos microssegundos, id da antiga maior): a mais nova vence.
  for (const ordem of [[uuid(9), uuid(2)], [uuid(2), uuid(9)]]) {
    const banco = criarBanco([
      doc(1),
      doc(9, { familia_id: uuid(1), criado_em: "2026-11-05T10:00:00.000001+00:00" }),
      doc(2, { familia_id: uuid(1), criado_em: "2026-11-05T10:00:00.000002+00:00" }),
    ]);
    const resultado = await executar(banco, { ids: ordem, liberado: true });
    assert.deepEqual(resultado.alterados, [uuid(2)], "Date.parse empataria e o id maior (a antiga) venceria");
    assert.deepEqual(resultado.ignorados, [{ id: uuid(9), motivo: "Existe uma versão mais nova na seleção." }]);
  }

  // Muitos irmãos: a resposta do banco passa de 1000 linhas e o sucessor de outra candidata fica depois do corte.
  {
    const irmaos = Array.from({ length: 1200 }, (_, i) => revisao(1000 + i, 1, { criado_em: "2026-11-02T10:00:00.000000+00:00" }));
    const banco = criarBanco([doc(1), doc(2), ...irmaos, revisao(5000, 2, { criado_em: "2026-11-03T10:00:00.000000+00:00" })]);
    const resultado = await executar(banco, { ids: [uuid(1), uuid(2)], liberado: true });
    assert.deepEqual(resultado.alterados, [], "as duas têm sucessor, inclusive a que só aparece na segunda página");
    assert.deepEqual(resultado.ignorados.map((item) => item.id).sort(), [uuid(1), uuid(2)]);
    assert.equal(banco.cortes, 0, "nenhuma resposta foi cortada pelo teto de 1000 linhas");
    assert.deepEqual(banco.gravacoes, []);
  }

  // Muitos irmãos não atrapalham quem é a última versão da família.
  {
    const irmaos = Array.from({ length: 1200 }, (_, i) => revisao(1000 + i, 1, { criado_em: "2026-11-02T10:00:00.000000+00:00" }));
    const banco = criarBanco([doc(1), ...irmaos, revisao(5000, 1, { criado_em: "2026-11-08T10:00:00.000000+00:00" })]);
    const resultado = await executar(banco, { ids: [uuid(5000)], liberado: true });
    assert.deepEqual(resultado, { alterados: [uuid(5000)], ignorados: [], falhas: [] });
    assert.equal(banco.cortes, 0);
  }

  // Apagar uma versão do meio zera o substitui_id da seguinte (FK ON DELETE SET NULL): a revisão órfã criada depois ainda barra a antiga.
  {
    const banco = criarBanco([
      doc(1),
      doc(3, { familia_id: uuid(1), criado_em: "2026-11-03T10:00:00.000000+00:00" }),
    ]);
    const resultado = await executar(banco, { ids: [uuid(1)], liberado: true });
    assert.deepEqual(resultado, { alterados: [], ignorados: [{ id: uuid(1), motivo: "Existe uma versão mais nova deste arquivo." }], falhas: [] });
    // E uma órfã mais velha não barra quem é mais novo que ela.
    const outro = criarBanco([
      doc(1),
      doc(2, { familia_id: uuid(1), criado_em: "2026-11-02T10:00:00.000000+00:00" }),
      doc(3, { familia_id: uuid(1), criado_em: "2026-11-03T10:00:00.000000+00:00" }),
    ]);
    const liberada = await executar(outro, { ids: [uuid(3)], liberado: true });
    assert.deepEqual(liberada, { alterados: [uuid(3)], ignorados: [], falhas: [] });
  }

  // Famílias diferentes não se atrapalham.
  {
    const banco = criarBanco([doc(1), doc(2), revisao(3, 2, { criado_em: "2026-11-03T10:00:00.000000+00:00" })]);
    const resultado = await executar(banco, { ids: [uuid(1), uuid(2), uuid(3)], liberado: true });
    assert.equal(resultado.alterados.length, 2, "1 é da própria família; 3 é da família do 2 e é mais nova que ele");
    assert.deepEqual(resultado.ignorados.map((item) => item.id), [uuid(2)]);
  }

  // Falha de um documento não derruba o lote: erro do banco e UPDATE sem efeito viram "falhas".
  {
    logs.length = 0;
    const banco = criarBanco([doc(1), doc(2), doc(3), doc(4)], { erros: { [uuid(2)]: "XX000" }, semEfeito: new Set([uuid(3)]) });
    const resultado = await executar(banco, { ids: [uuid(1), uuid(2), uuid(3), uuid(4)], liberado: true });
    assert.deepEqual(resultado.alterados, [uuid(1), uuid(4)]);
    assert.deepEqual(resultado.falhas, [uuid(2), uuid(3)]);
    assert.deepEqual(resultado.ignorados, []);
    assert.equal(logs.length, 2, "cada falha vira uma linha de log");
    assert.ok(logs.flat().every((valor) => valor === undefined || typeof valor === "string"), "o log leva só o código do erro");
  }

  // Ocultar em lote: grava liberado_cliente=false, não olha versões e ignora o que já está oculto.
  {
    const banco = criarBanco([
      doc(1, { liberado_cliente: true }),
      doc(2, { liberado_cliente: true, mime: "image/png" }),
      doc(3),
      doc(4, { liberado_cliente: true, familia_id: uuid(1) }),
    ]);
    const resultado = await executar(banco, { ids: [uuid(1), uuid(2), uuid(3), uuid(4)], liberado: false });
    assert.deepEqual(resultado.alterados, [uuid(1), uuid(2), uuid(4)]);
    assert.deepEqual(resultado.ignorados, [{ id: uuid(3), motivo: "Já está oculto." }]);
    assert.deepEqual(banco.gravacoes.map(([, campos]) => campos), [{ liberado_cliente: false }, { liberado_cliente: false }, { liberado_cliente: false }]);
    assert.ok(banco.documentos.every((item) => item.liberado_cliente === false));
    assert.deepEqual(banco.leituras, ["id"], "ocultar não consulta versões");
  }

  // Cada id da entrada aparece exatamente uma vez na resposta.
  {
    const familia = uuid(1);
    const banco = criarBanco([
      doc(1, { familia_id: familia, criado_em: "2026-11-01T10:00:00.000000+00:00" }),
      revisao(2, 1, { criado_em: "2026-11-02T10:00:00.000000+00:00" }),
      doc(3, { liberado_cliente: true }),
      doc(4, { mime: "image/png" }),
      doc(5),
      doc(6),
    ], { erros: { [uuid(6)]: "XX000" } });
    const entrada = [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5), uuid(6), uuid(404)];
    const resultado = await executar(banco, { ids: entrada, liberado: true });
    const saida = [...resultado.alterados, ...resultado.ignorados.map((item) => item.id), ...resultado.falhas];
    assert.deepEqual(saida.sort(), [...entrada].sort());
  }

  // Erro de permissão do banco (trigger) vira 403; erro de leitura vira 500 sem detalhe.
  {
    const banco = criarBanco([doc(1)], { erros: { [uuid(1)]: "42501" } });
    await assert.rejects(executar(banco, { ids: [uuid(1)], liberado: true }), ForbiddenError);
    const quebrado = criarBanco([doc(1)], { erroLeitura: true });
    await assert.rejects(executar(quebrado, { ids: [uuid(1)], liberado: true }), InternalServerError);
  }
} finally {
  console.error = consoleOriginal;
}

// ---------------------------------------------------------------------------------------------------------------
// A rota pede documentos.liberar antes de ler o corpo (a varredura completa está em testar-permissoes-rotas.mjs).
// ---------------------------------------------------------------------------------------------------------------

{
  const rota = readFileSync(resolve(raiz, `${PASTA}/route.ts`), "utf8");
  const autorizar = rota.indexOf('autorizarPortal("escrita", "documentos.liberar")');
  assert.ok(autorizar > 0, "a rota pede documentos.liberar");
  assert.ok(autorizar < rota.indexOf("lerJsonLimitado("), "a autorização vem antes da leitura do corpo");
  assert.ok(!rota.includes("documentos.editar"), "documentos.editar não abre o lote");
}

console.log("testar-documentos-lote: OK");
