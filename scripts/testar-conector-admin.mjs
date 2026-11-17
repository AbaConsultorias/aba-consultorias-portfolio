import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

// Lógica pura do painel do conector (Etapa 7): aviso de silêncio, uso do R2, fila "Chegaram do servidor", lote e erros do ciclo.
// Rotas e telas dependem do Supabase e do navegador: ficam para a conferência manual.

const raiz = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const modulos = new Map();

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
    if (nome.startsWith("@/")) return carregar(`src/${nome.slice(2)}.ts`);
    if (nome.startsWith(".")) return carregar(`${resolve(dirname(arquivo), nome)}.ts`);
    return require(nome);
  };
  runInThisContext(`(function(require, module, exports) {${codigo}\n})`, { filename: arquivo })(importar, modulo, modulo.exports);
  return modulo.exports;
}

const { ehDiaUtilEmSaoPaulo, conectorSilencioso, LIMITE_SILENCIO_MS } = carregar("src/lib/portal/conector/alerta.ts");
const { avaliarUso, formatarGb, somarBalde, LIMITE_GRATIS_BYTES, AVISO_USO_BYTES } = carregar("src/lib/portal/conector/uso.ts");
const { montarFila, planejarLote, ehRevisao, MAXIMO_LOTE } = carregar("src/lib/portal/conector/fila.ts");
const { agruparErrosPorEmpreendimento } = carregar("src/lib/portal/conector/resumo.ts");
const { dataHoraSaoPaulo, haQuantoTempo, rotuloDaContagem } = carregar("src/lib/portal/conector/formato.ts");
const { liberarSchema, consultaSchema } = carregar("src/app/api/(modules)/adm-interno/portal/conector/chegaram/schema.ts");
const { alterarSchema } = carregar("src/app/api/(modules)/adm-interno/portal/conector/configuracao/schema.ts");

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------------------------------------------------------
// Dia útil e silêncio de 24 h no fuso de São Paulo (UTC-3, sem horário de verão).
// ---------------------------------------------------------------------------------------------------------------

assert.equal(ehDiaUtilEmSaoPaulo(new Date("2026-11-04T15:00:00Z")), true, "quarta");
assert.equal(ehDiaUtilEmSaoPaulo(new Date("2026-11-07T15:00:00Z")), false, "sábado");
assert.equal(ehDiaUtilEmSaoPaulo(new Date("2026-11-08T12:00:00Z")), false, "domingo");
assert.equal(ehDiaUtilEmSaoPaulo(new Date("2026-11-09T12:00:00Z")), true, "segunda");
assert.equal(ehDiaUtilEmSaoPaulo(new Date("2026-11-09T01:00:00Z")), false, "domingo 22h em São Paulo, já segunda em UTC");
assert.equal(ehDiaUtilEmSaoPaulo(new Date("2026-11-07T02:30:00Z")), true, "sexta 23h30 em São Paulo, já sábado em UTC");
assert.equal(ehDiaUtilEmSaoPaulo(new Date("2026-11-07T03:00:00Z")), false, "sábado 00h em São Paulo");

const contato = "2026-11-03T12:00:00.000Z";
const emissao = "2026-10-01T12:00:00.000Z";
assert.equal(LIMITE_SILENCIO_MS, 86_400_000);
assert.equal(conectorSilencioso({ ultimoContatoEm: contato, criadoEm: emissao }, new Date("2026-11-04T11:59:59.000Z")), false, "menos de 24 h");
assert.equal(conectorSilencioso({ ultimoContatoEm: contato, criadoEm: emissao }, new Date("2026-11-04T12:00:00.000Z")), false, "exatamente 24 h não avisa");
assert.equal(conectorSilencioso({ ultimoContatoEm: contato, criadoEm: emissao }, new Date("2026-11-04T12:00:01.000Z")), true, "passou de 24 h em dia útil");
assert.equal(conectorSilencioso({ ultimoContatoEm: contato, criadoEm: emissao }, new Date("2026-11-07T15:00:00.000Z")), false, "sábado nunca avisa");
assert.equal(conectorSilencioso({ ultimoContatoEm: null, criadoEm: emissao }, new Date("2026-11-04T12:00:00.000Z")), true, "sem contato conta desde a emissão");
assert.equal(conectorSilencioso({ ultimoContatoEm: null, criadoEm: "2026-11-04T10:00:00.000Z" }, new Date("2026-11-04T12:00:00.000Z")), false, "chave recém-emitida");
assert.equal(conectorSilencioso({ ultimoContatoEm: "não é data", criadoEm: emissao }, new Date("2026-11-04T12:00:00.000Z")), false, "data inválida não derruba nem avisa");

// ---------------------------------------------------------------------------------------------------------------
// Uso do R2: soma paginada, teto de páginas, prazo e níveis do aviso.
// ---------------------------------------------------------------------------------------------------------------

assert.equal(LIMITE_GRATIS_BYTES, 10_000_000_000);
assert.equal(AVISO_USO_BYTES, 8_000_000_000);
assert.equal(avaliarUso(0).nivel, "normal");
assert.equal(avaliarUso(AVISO_USO_BYTES - 1).nivel, "normal");
assert.equal(avaliarUso(AVISO_USO_BYTES).nivel, "aviso");
assert.equal(avaliarUso(LIMITE_GRATIS_BYTES - 1).nivel, "aviso");
assert.equal(avaliarUso(LIMITE_GRATIS_BYTES).nivel, "cheio");
assert.equal(avaliarUso(7_900_000_000).porcentagem, 79);
assert.equal(avaliarUso(25_000_000_000).porcentagem, 100, "a barra nunca passa de 100%");
assert.equal(formatarGb(3_200_000_000), "3,2 GB");
assert.equal(formatarGb(0), "0,0 GB");

function balde(paginas) {
  const chamadas = [];
  const listarPagina = async (continuacao) => {
    chamadas.push(continuacao);
    const indice = continuacao === undefined ? 0 : Number(continuacao);
    return { objetos: paginas[indice].map((tamanho) => ({ tamanho })), proximo: indice + 1 < paginas.length ? String(indice + 1) : null };
  };
  return { listarPagina, chamadas };
}

{
  const { listarPagina, chamadas } = balde([[10, 20], [30], [40, 50, 60]]);
  assert.deepEqual(await somarBalde(listarPagina), { bytes: 210, objetos: 6, parcial: false });
  assert.deepEqual(chamadas, [undefined, "1", "2"], "cada chamada usa o token da anterior");
}
{
  const { listarPagina, chamadas } = balde([[10], [20], [30], [40]]);
  assert.deepEqual(await somarBalde(listarPagina, { maximoPaginas: 2 }), { bytes: 30, objetos: 2, parcial: true });
  assert.equal(chamadas.length, 2, "para no teto de páginas");
}
{
  const { listarPagina } = balde([[10], [20], [30]]);
  let agora = 0;
  const resultado = await somarBalde(listarPagina, { prazoMs: 100, agora: () => (agora += 60) });
  assert.equal(resultado.parcial, true, "estourar o prazo marca como parcial");
  assert.ok(resultado.bytes >= 10 && resultado.bytes < 60);
}
{
  const { listarPagina } = balde([[]]);
  assert.deepEqual(await somarBalde(listarPagina), { bytes: 0, objetos: 0, parcial: false }, "balde vazio");
}
await assert.rejects(somarBalde(async () => { throw new Error("r2 fora"); }), /r2 fora/, "falha do R2 não vira soma zerada");

// ---------------------------------------------------------------------------------------------------------------
// Fila "Chegaram do servidor".
// ---------------------------------------------------------------------------------------------------------------

const EMP = uuid(100);
const PROJ = uuid(200);
const CAT = uuid(300);
const linha = (n, extra = {}) => ({
  id: uuid(n), empreendimentoId: EMP, projetoId: null, categoriaId: null, grupo: null, titulo: `Documento ${n}`, tamanho: 1024 * n,
  criadoEm: `2026-11-0${n}T10:00:00.000Z`, substituiId: null, familiaId: uuid(n), caminhoRelativo: `03 - PRODUTOS\\LAN\\arquivo ${n}.pdf`, ...extra,
});
const contexto = (extra = {}) => ({
  empreendimentos: new Map([[EMP, "Vista Linda"]]),
  projetos: new Map([[PROJ, "Projeto Elétrico"]]),
  categorias: new Map([[CAT, "Aprovado"]]),
  comVersaoMaisNova: new Set(),
  visiveisPorFamilia: new Map(),
  ...extra,
});

{
  const fila = montarFila([
    linha(1, { projetoId: PROJ, categoriaId: CAT }),
    linha(2, { projetoId: PROJ }),
    linha(3, { grupo: "contratos" }),
    linha(4, { grupo: "orcamentos" }),
    linha(5),
    linha(6, { projetoId: uuid(999), categoriaId: uuid(998) }),
  ], contexto());
  assert.deepEqual(fila.map((item) => item.destino), [
    "Projeto Elétrico › Aprovado", "Projeto Elétrico", "Contratos", "Orçamentos", "Sem destino definido", "Projeto removido › Categoria removida",
  ]);
  assert.equal(fila[0].empreendimentoNome, "Vista Linda");
  assert.equal(fila[0].origem, "03 - PRODUTOS\\LAN\\arquivo 1.pdf");
  assert.equal(fila[0].downloadHref, `/api/portal/documentos/${uuid(1)}/download`);
  assert.equal(fila[0].revisao, null, "documento sem anterior não é revisão");
  assert.equal(montarFila([linha(1, { empreendimentoId: uuid(555) })], contexto())[0].empreendimentoNome, null);
  // Pasta de arquivo (Outros projetos): o destino leva o rótulo do cartão; sem rótulo cai no nome do grupo.
  assert.deepEqual(montarFila([linha(1, { grupo: "arquivo", pastaRotulo: "Projeto Urbanístico" }), linha(2, { grupo: "arquivo" })], contexto()).map((item) => item.destino),
    ["Outros projetos › Projeto Urbanístico", "Outros projetos"]);
}
{
  // Revisão: v1 (visível ao cliente) → v2 (na fila).
  const v1 = uuid(1);
  const v2 = linha(2, { substituiId: v1, familiaId: v1 });
  const visivel = { id: v1, titulo: "Planta aprovada", liberadoEm: "2026-11-01T12:00:00.000Z" };
  const [item] = montarFila([v2], contexto({ visiveisPorFamilia: new Map([[v1, visivel]]) }));
  assert.deepEqual(item.revisao, { visivel });
  assert.equal(ehRevisao(v2), true);
  // Revisão cuja anterior foi apagada continua revisão (substituiId zerado, familia ≠ id) e o cliente não vê nada.
  const orfa = linha(3, { substituiId: null, familiaId: uuid(77) });
  assert.equal(ehRevisao(orfa), true);
  assert.deepEqual(montarFila([orfa], contexto())[0].revisao, { visivel: null });
}
{
  // Versão antiga já substituída (ficou oculta quando a nova foi liberada) não volta para a fila.
  const fila = montarFila([linha(1), linha(2)], contexto({ comVersaoMaisNova: new Set([uuid(1)]) }));
  assert.deepEqual(fila.map((item) => item.id), [uuid(2)]);
}

// ---------------------------------------------------------------------------------------------------------------
// Plano do lote: revisão pela função do banco, uma versão por família, só o que está na fila.
// ---------------------------------------------------------------------------------------------------------------

const lote = (n, extra = {}) => ({
  id: uuid(n), familiaId: uuid(n), substituiId: null, criadoEm: `2026-11-0${n}T10:00:00.000Z`, mime: "application/pdf",
  liberado: false, temVersaoMaisNova: false, ...extra,
});

{
  const raiz1 = uuid(10);
  const plano = planejarLote(
    [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5), uuid(6), uuid(404)],
    [
      lote(1),
      lote(2, { substituiId: raiz1, familiaId: raiz1 }),
      lote(3, { liberado: true }),
      lote(4, { mime: "image/png" }),
      lote(5, { temVersaoMaisNova: true }),
      lote(6, { substituiId: null, familiaId: raiz1, criadoEm: "2026-11-06T10:00:00.000Z" }),
    ],
  );
  assert.deepEqual(plano.diretos, [uuid(1)]);
  // 2 e 6 são da mesma família: só a mais nova (6) sobe.
  assert.deepEqual(plano.revisoes, [uuid(6)]);
  assert.deepEqual(plano.ignorados.map((item) => item.id).sort(), [uuid(2), uuid(3), uuid(4), uuid(404), uuid(5)].sort());
  assert.match(plano.ignorados.find((item) => item.id === uuid(404)).motivo, /servidor/);
  assert.match(plano.ignorados.find((item) => item.id === uuid(2)).motivo, /mais nova/);
  assert.match(plano.ignorados.find((item) => item.id === uuid(3)).motivo, /liberado/);
}
{
  assert.deepEqual(planejarLote([], []), { revisoes: [], diretos: [], ignorados: [] });
  // Mesma data: o desempate é estável pelo id, nunca libera as duas.
  const f = uuid(50);
  const empate = planejarLote([uuid(7), uuid(8)], [
    lote(7, { familiaId: f, substituiId: f, criadoEm: "2026-11-05T10:00:00.000Z" }),
    lote(8, { familiaId: f, substituiId: f, criadoEm: "2026-11-05T10:00:00.000Z" }),
  ]);
  assert.equal(empate.revisoes.length, 1);
  assert.equal(empate.ignorados.length, 1);
}

// ---------------------------------------------------------------------------------------------------------------
// Validação do lote e da configuração.
// ---------------------------------------------------------------------------------------------------------------

assert.equal(MAXIMO_LOTE, 100);
const ids = (total) => Array.from({ length: total }, (_, i) => uuid(i + 1));
assert.equal(liberarSchema.safeParse({ ids: ids(1) }).success, true);
assert.equal(liberarSchema.safeParse({ ids: ids(100) }).success, true);
assert.equal(liberarSchema.safeParse({ ids: ids(101) }).success, false, "máximo 100 por chamada");
assert.equal(liberarSchema.safeParse({ ids: [] }).success, false);
assert.equal(liberarSchema.safeParse({ ids: [uuid(1), uuid(1)] }).success, false, "repetidos");
assert.equal(liberarSchema.safeParse({ ids: ["abc"] }).success, false);
assert.equal(liberarSchema.safeParse({ ids: ids(2), extra: true }).success, false, "campo extra");
assert.equal(liberarSchema.safeParse({}).success, false);
assert.equal(liberarSchema.safeParse(null).success, false);

assert.deepEqual(consultaSchema.parse({}), { pagina: 1, limite: 50 });
assert.equal(consultaSchema.parse({ pagina: "3", limite: "20", empreendimentoId: uuid(1) }).pagina, 3);
assert.equal(consultaSchema.safeParse({ empreendimentoId: "x" }).success, false);
assert.equal(consultaSchema.safeParse({ limite: "101" }).success, false);
assert.equal(consultaSchema.safeParse({ pagina: "0" }).success, false);

assert.equal(alterarSchema.safeParse({ liberacaoAutomaticaGeral: false }).success, true);
assert.equal(alterarSchema.safeParse({ liberacaoAutomaticaGeral: "false" }).success, false, "só booleano de verdade");
assert.equal(alterarSchema.safeParse({}).success, false);
assert.equal(alterarSchema.safeParse({ liberacaoAutomaticaGeral: true, outro: 1 }).success, false);

// ---------------------------------------------------------------------------------------------------------------
// Erros do ciclo por empreendimento (nome pelo codigo_pasta).
// ---------------------------------------------------------------------------------------------------------------

{
  const nomes = new Map([["250101", "Vista Linda"], ["250102", "Loteamento B"]]);
  const grupos = agruparErrosPorEmpreendimento([
    { codigoPasta: "250101", mensagem: "Duas pastas começam com 250101 - " },
    { codigoPasta: null, mensagem: "Sem rede" },
    { codigoPasta: "250102", mensagem: "Pasta não encontrada" },
    { codigoPasta: "250101", mensagem: "Arquivo ilegível" },
    { codigoPasta: "999999", mensagem: "Código desconhecido" },
  ], nomes);
  assert.deepEqual(grupos.map((grupo) => [grupo.codigoPasta, grupo.nome, grupo.mensagens.length]), [
    ["250101", "Vista Linda", 2],
    [null, null, 1],
    ["250102", "Loteamento B", 1],
    ["999999", null, 1],
  ]);
  assert.equal(new Set(grupos.map((grupo) => grupo.chave)).size, grupos.length, "chaves únicas para a lista da tela");
  assert.deepEqual(agruparErrosPorEmpreendimento([], nomes), []);
}

// ---------------------------------------------------------------------------------------------------------------
// Formatação (fuso fixo de São Paulo).
// ---------------------------------------------------------------------------------------------------------------

{
  const texto = dataHoraSaoPaulo("2026-11-04T15:30:00.000Z");
  assert.ok(texto.includes("04/11") && texto.includes("12:30"), `data/hora em São Paulo: ${texto}`);
  assert.equal(dataHoraSaoPaulo("lixo"), "—");
  const agora = new Date("2026-11-04T12:00:00.000Z");
  assert.equal(haQuantoTempo("2026-11-04T11:59:40.000Z", agora), "agora há pouco");
  assert.equal(haQuantoTempo("2026-11-04T11:15:00.000Z", agora), "há 45 min");
  assert.equal(haQuantoTempo("2026-11-04T07:00:00.000Z", agora), "há 5 h");
  assert.equal(haQuantoTempo("2026-11-01T12:00:00.000Z", agora), "há 3 dias");
  assert.equal(haQuantoTempo("2026-11-05T12:00:00.000Z", agora), "", "futuro não gera texto");
  assert.equal(rotuloDaContagem("ja_enviados"), "Já enviados antes");
  assert.equal(rotuloDaContagem("campo_novo"), "campo_novo");
}

console.log("testar-conector-admin: OK");
