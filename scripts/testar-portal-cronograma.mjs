import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const modulos = new Map();
let sessaoAtual;

const substitutos = {
  "server-only": {},
  react: { cache: (fn) => fn },
  "@/lib/supabase/server": { createClient: async () => sessaoAtual },
};

// Transpila os módulos reais em memória; só as fronteiras externas são simuladas.
function carregar(caminho) {
  const arquivo = resolve(raiz, caminho);
  if (modulos.has(arquivo)) return modulos.get(arquivo).exports;
  const modulo = { exports: {} };
  modulos.set(arquivo, modulo);
  const codigo = ts.transpileModule(readFileSync(arquivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true },
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

const { montarCronograma, mesValido, rotuloMesAbreviado, rotuloMesCompleto, LIMITE_COLUNAS_CRONOGRAMA } = carregar("src/lib/portal/cronograma/regras.ts");
const { resumir, somarCentavos, formatarBRL } = carregar("src/lib/portal/financeiro/regras.ts");

const HOJE = "2026-11-15";
let contador = 0;
const idDe = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const parcela = (sobrescrever = {}) => ({
  id: idDe(++contador), itemId: idDe(900), numero: null, nome: null, vencimento: "2026-12-10",
  valorPrevistoCentavos: "10000", valorPagoCentavos: "0", dataPagamento: null,
  gatilho: "data", eventoTipo: null, eventoProjetoId: null, eventoDescricao: null, diasApos: 0, eventoId: null, ...sobrescrever,
});
const item = (parcelas = [], sobrescrever = {}) => ({
  id: idDe(++contador + 5000), descricao: "Item", fornecedorId: null, fornecedorNome: null,
  observacao: null, valorContratadoCentavos: "0",
  codigo: null, versao: null, assinadoEm: null, documentoId: null, atualizadoEm: "2026-11-01T12:00:00.000Z", projetos: [],
  parcelas, ...sobrescrever,
});
const aguardaEvento = (sobrescrever = {}) => parcela({ vencimento: null, gatilho: "evento", eventoTipo: "aprovacao", ...sobrescrever });
const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);
const montar = (itens, opcoes = {}) => montarCronograma(itens, { hoje: HOJE, ...opcoes });

teste("grade vazia: sem itens não há linhas nem meses", () => {
  const cronograma = montar([]);
  assert.deepEqual(cronograma.meses, []);
  assert.deepEqual(cronograma.anos, []);
  assert.deepEqual(cronograma.linhas, []);
  assert.deepEqual(cronograma.totaisPorMes, {});
  assert.equal(cronograma.totalGeral.previstoCentavos, "0");
  assert.equal(cronograma.truncado, false);
  assert.deepEqual(cronograma.aguardandoEvento, { quantidade: 0, pendenteCentavos: "0" });
});

teste("grade vazia com filtro ainda mostra o mês pedido, zerado", () => {
  assert.deepEqual(montar([], { de: "2026-03", ate: "2026-04" }).meses, ["2026-03", "2026-04"]);
});

teste("item sem parcela aparece como linha zerada", () => {
  const cronograma = montar([item([], { descricao: "Sem parcela", valorContratadoCentavos: "50000" })]);
  assert.equal(cronograma.linhas.length, 1);
  const [linha] = cronograma.linhas;
  assert.equal(linha.totalPrevistoCentavos, "0");
  assert.equal(linha.totalPendenteCentavos, "0");
  assert.equal(linha.contratadoCentavos, "50000");
  assert.equal(linha.diferencaPrevistoCentavos, "50000");
  assert.deepEqual(linha.celulas, {});
  assert.deepEqual(cronograma.meses, []);
});

teste("item sem parcela convive com outro que tem parcela", () => {
  const cronograma = montar([item([]), item([parcela({ vencimento: "2026-12-01" })])]);
  assert.equal(cronograma.linhas.length, 2);
  assert.deepEqual(cronograma.meses, ["2026-12"]);
  assert.deepEqual(cronograma.linhas[0].celulas, {});
});

teste("vários itens: mantém a ordem recebida e soma por mês", () => {
  const a = item([parcela({ vencimento: "2026-12-05", valorPrevistoCentavos: "1000" })], { descricao: "A", fornecedorNome: "Forn A" });
  const b = item([parcela({ vencimento: "2026-12-20", valorPrevistoCentavos: "2500" }), parcela({ vencimento: "2027-01-20", valorPrevistoCentavos: "300" })], { descricao: "B" });
  const cronograma = montar([a, b]);
  assert.deepEqual(cronograma.linhas.map((l) => l.descricao), ["A", "B"]);
  assert.equal(cronograma.linhas[0].fornecedorNome, "Forn A");
  assert.equal(cronograma.totaisPorMes["2026-12"].previstoCentavos, "3500");
  assert.equal(cronograma.totaisPorMes["2027-01"].previstoCentavos, "300");
  assert.equal(cronograma.totalGeral.previstoCentavos, "3800");
});

teste("parcelas do mesmo mês no mesmo item viram uma célula ordenada", () => {
  const p2 = parcela({ id: idDe(2), vencimento: "2026-12-20", valorPrevistoCentavos: "200" });
  const p1 = parcela({ id: idDe(1), vencimento: "2026-12-05", valorPrevistoCentavos: "100" });
  const cronograma = montar([item([p2, p1])]);
  const celula = cronograma.linhas[0].celulas["2026-12"];
  assert.equal(celula.previstoCentavos, "300");
  assert.deepEqual(celula.parcelas.map((p) => p.id), [idDe(1), idDe(2)]);
  assert.equal(celula.mes, "2026-12");
});

teste("na célula, o número da parcela manda na ordem antes do vencimento", () => {
  const segunda = parcela({ id: idDe(21), numero: 2, vencimento: "2026-12-05" });
  const primeira = parcela({ id: idDe(22), numero: 1, vencimento: "2026-12-20" });
  const semNumero = parcela({ id: idDe(20), numero: null, vencimento: "2026-12-01" });
  for (const entrada of [[semNumero, segunda, primeira], [primeira, semNumero, segunda]]) {
    const celula = montar([item(entrada)]).linhas[0].celulas["2026-12"];
    assert.deepEqual(celula.parcelas.map((p) => p.id), [idDe(22), idDe(21), idDe(20)]);
  }
});

teste("parcela aguardando evento fica fora dos meses, das células e dos totais, e entra em aguardandoEvento", () => {
  const datada = parcela({ vencimento: "2026-12-10", valorPrevistoCentavos: "1000" });
  const aguarda = aguardaEvento({ valorPrevistoCentavos: "7000", valorPagoCentavos: "2000" });
  const cronograma = montar([item([datada, aguarda], { valorContratadoCentavos: "8000" })]);
  assert.deepEqual(cronograma.meses, ["2026-12"]);
  assert.deepEqual(Object.keys(cronograma.linhas[0].celulas), ["2026-12"]);
  assert.deepEqual(cronograma.linhas[0].celulas["2026-12"].parcelas.map((p) => p.id), [datada.id]);
  assert.equal(cronograma.totalGeral.previstoCentavos, "1000");
  assert.equal(cronograma.linhas[0].totalPrevistoCentavos, "1000");
  assert.equal(cronograma.linhas[0].totalPendenteCentavos, "1000");
  assert.deepEqual(cronograma.aguardandoEvento, { quantidade: 1, pendenteCentavos: "5000" });
  assert.equal(cronograma.linhas[0].diferencaPrevistoCentavos, "0");
});

teste("só parcelas aguardando evento: sem meses, mas contadas e somadas entre itens", () => {
  const cronograma = montar([
    item([aguardaEvento({ valorPrevistoCentavos: "300" })]),
    item([aguardaEvento({ valorPrevistoCentavos: "200", valorPagoCentavos: "50" }), aguardaEvento({ valorPrevistoCentavos: "100", dataPagamento: "2026-11-01" })]),
  ]);
  assert.deepEqual(cronograma.meses, []);
  assert.deepEqual(cronograma.anos, []);
  assert.deepEqual(cronograma.linhas.map((l) => l.celulas), [{}, {}]);
  assert.deepEqual(cronograma.aguardandoEvento, { quantidade: 2, pendenteCentavos: "450" });
});

teste("aguardandoEvento ignora o filtro de meses e não conta parcela quitada", () => {
  const cronograma = montar([item([aguardaEvento(), aguardaEvento({ valorPagoCentavos: "10000" }), parcela({ vencimento: "2026-12-10" })])], { de: "2027-03", ate: "2027-03" });
  assert.deepEqual(cronograma.meses, ["2027-03"]);
  assert.deepEqual(cronograma.aguardandoEvento, { quantidade: 1, pendenteCentavos: "10000" });
});

teste("a célula não muda com a janela de 15 dias: a 15 e a 16 dias de hoje continuam a pagar", () => {
  const cronograma = montar([item([parcela({ vencimento: "2026-11-30" }), parcela({ vencimento: "2026-12-01" })])]);
  assert.equal(cronograma.linhas[0].celulas["2026-11"].situacao, "aberta");
  assert.equal(cronograma.linhas[0].celulas["2026-12"].situacao, "aberta");
});

teste("empate de vencimento desempata pelo id, em qualquer ordem de entrada", () => {
  const a = parcela({ id: idDe(10), vencimento: "2026-12-05" });
  const b = parcela({ id: idDe(11), vencimento: "2026-12-05" });
  for (const entrada of [[a, b], [b, a]]) {
    const celula = montar([item(entrada)]).linhas[0].celulas["2026-12"];
    assert.deepEqual(celula.parcelas.map((p) => p.id), [idDe(10), idDe(11)]);
  }
});

teste("quitada por data, mesmo sem valor pago, mesmo vencida no calendário", () => {
  const cronograma = montar([item([parcela({ vencimento: "2026-01-10", dataPagamento: "2026-01-12" })])]);
  const celula = cronograma.linhas[0].celulas["2026-01"];
  assert.equal(celula.situacao, "quitada");
  assert.equal(cronograma.linhas[0].totalPendenteCentavos, "10000");
});

teste("quitada por valor pago igual ou maior que o previsto", () => {
  const cronograma = montar([item([parcela({ vencimento: "2026-12-10", valorPagoCentavos: "10000" })])]);
  assert.equal(cronograma.linhas[0].celulas["2026-12"].situacao, "quitada");
  assert.equal(cronograma.linhas[0].totalPendenteCentavos, "0");
});

teste("parcial: pago menor que o previsto, ainda no prazo", () => {
  const cronograma = montar([item([parcela({ vencimento: "2026-12-10", valorPagoCentavos: "4000" })])]);
  const celula = cronograma.linhas[0].celulas["2026-12"];
  assert.equal(celula.situacao, "parcial");
  assert.equal(celula.pagoCentavos, "4000");
  assert.equal(cronograma.linhas[0].totalPendenteCentavos, "6000");
});

teste("parcial também quando uma parcela do mês está quitada e outra aberta", () => {
  const cronograma = montar([item([
    parcela({ vencimento: "2026-12-05", valorPagoCentavos: "10000" }),
    parcela({ vencimento: "2026-12-25" }),
  ])]);
  assert.equal(cronograma.linhas[0].celulas["2026-12"].situacao, "parcial");
});

teste("a pagar: dentro do prazo e sem pagamento (inclui vence em breve e hoje)", () => {
  const cronograma = montar([item([
    parcela({ vencimento: "2026-12-10" }),
    parcela({ vencimento: HOJE }),
  ])]);
  assert.equal(cronograma.linhas[0].celulas["2026-12"].situacao, "aberta");
  assert.equal(cronograma.linhas[0].celulas["2026-11"].situacao, "aberta");
});

teste("vencida: prazo passado sem quitação, mesmo com pagamento parcial", () => {
  const cronograma = montar([item([
    parcela({ vencimento: "2026-10-10" }),
    parcela({ vencimento: "2026-09-10", valorPagoCentavos: "3000" }),
  ])]);
  assert.equal(cronograma.linhas[0].celulas["2026-10"].situacao, "vencida");
  assert.equal(cronograma.linhas[0].celulas["2026-09"].situacao, "vencida");
});

teste("vencida vence parcial e quitada dentro da mesma célula", () => {
  const cronograma = montar([item([
    parcela({ vencimento: "2026-10-01", valorPagoCentavos: "10000" }),
    parcela({ vencimento: "2026-10-02" }),
  ])]);
  assert.equal(cronograma.linhas[0].celulas["2026-10"].situacao, "vencida");
});

teste("mês sem parcela entre duas: coluna existe e a célula não", () => {
  const cronograma = montar([item([parcela({ vencimento: "2026-12-10" }), parcela({ vencimento: "2027-03-10" })])]);
  assert.deepEqual(cronograma.meses, ["2026-12", "2027-01", "2027-02", "2027-03"]);
  assert.equal(cronograma.linhas[0].celulas["2027-01"], undefined);
  assert.deepEqual(cronograma.totaisPorMes["2027-01"], { previstoCentavos: "0", pagoCentavos: "0", pendenteCentavos: "0" });
});

teste("virada de ano agrupa colunas por ano", () => {
  const cronograma = montar([item([parcela({ vencimento: "2026-11-30" }), parcela({ vencimento: "2027-02-01" })])]);
  assert.deepEqual(cronograma.anos, [
    { ano: 2026, meses: ["2026-11", "2026-12"] },
    { ano: 2027, meses: ["2027-01", "2027-02"] },
  ]);
});

teste("o pago entra no mês previsto, não no da data do pagamento", () => {
  const cronograma = montar([item([parcela({ vencimento: "2026-05-10", dataPagamento: "2026-07-01", valorPagoCentavos: "10000" })])]);
  assert.equal(cronograma.linhas[0].celulas["2026-05"].pagoCentavos, "10000");
  assert.equal(cronograma.linhas[0].celulas["2026-07"], undefined);
  assert.deepEqual(cronograma.meses, ["2026-05"]);
});

const tresMeses = () => [item([
  parcela({ vencimento: "2026-01-10", valorPrevistoCentavos: "100" }),
  parcela({ vencimento: "2026-02-10", valorPrevistoCentavos: "200" }),
  parcela({ vencimento: "2026-03-10", valorPrevistoCentavos: "400" }),
], { valorContratadoCentavos: "1000" })];

teste("filtro válido recorta colunas e totais, mas não o contratado", () => {
  const cronograma = montar(tresMeses(), { de: "2026-02", ate: "2026-02" });
  assert.deepEqual(cronograma.meses, ["2026-02"]);
  assert.equal(cronograma.linhas[0].totalPrevistoCentavos, "200");
  assert.equal(cronograma.totalGeral.previstoCentavos, "200");
  assert.equal(cronograma.linhas[0].contratadoCentavos, "1000");
  assert.equal(cronograma.linhas[0].diferencaPrevistoCentavos, "300");
});

teste("filtro só com início ou só com fim", () => {
  assert.deepEqual(montar(tresMeses(), { de: "2026-02" }).meses, ["2026-02", "2026-03"]);
  assert.deepEqual(montar(tresMeses(), { ate: "2026-02" }).meses, ["2026-01", "2026-02"]);
});

teste("filtro fora dos dados mostra colunas zeradas, nunca quebra", () => {
  assert.deepEqual(montar(tresMeses(), { de: "2027-01" }).meses, ["2027-01"]);
  assert.deepEqual(montar(tresMeses(), { ate: "2025-06" }).meses, ["2025-06"]);
  assert.deepEqual(montar(tresMeses(), { de: "2030-01", ate: "2030-02" }).meses, ["2030-01", "2030-02"]);
});

teste("filtro inválido é ignorado", () => {
  for (const ruim of ["2026-13", "2026-00", "26-01", "2026-1", "abc", "", "2026-02-01", " 2026-02"]) {
    assert.deepEqual(montar(tresMeses(), { de: ruim, ate: ruim }).meses, ["2026-01", "2026-02", "2026-03"], ruim);
  }
  assert.deepEqual(montar(tresMeses(), { de: undefined, ate: null }).meses.length, 3);
  assert.equal(mesValido("2026-02"), true);
  assert.equal(mesValido("2026-13"), false);
  assert.equal(mesValido(202602), false);
});

teste("filtro invertido (de > até) é trocado", () => {
  const cronograma = montar(tresMeses(), { de: "2026-03", ate: "2026-01" });
  assert.deepEqual(cronograma.meses, ["2026-01", "2026-02", "2026-03"]);
});

teste("truncamento em 120 colunas", () => {
  const longo = item([parcela({ vencimento: "2020-01-10" }), parcela({ vencimento: "2040-12-10" })]);
  const cronograma = montar([longo]);
  assert.equal(LIMITE_COLUNAS_CRONOGRAMA, 120);
  assert.equal(cronograma.meses.length, 120);
  assert.equal(cronograma.meses[0], "2020-01");
  assert.equal(cronograma.meses[119], "2029-12");
  assert.equal(cronograma.truncado, true);
  assert.equal(cronograma.linhas[0].totalPrevistoCentavos, "10000");
  assert.equal(cronograma.anos.reduce((soma, a) => soma + a.meses.length, 0), 120);
});

teste("exatamente 120 meses não trunca; 121 trunca", () => {
  const com = (fim) => montar([item([parcela({ vencimento: "2020-01-10" }), parcela({ vencimento: fim })])]);
  assert.equal(com("2029-12-31").truncado, false);
  assert.equal(com("2029-12-31").meses.length, 120);
  assert.equal(com("2030-01-01").truncado, true);
  assert.equal(com("2030-01-01").meses.length, 120);
});

teste("filtro enorme também trunca sem travar", () => {
  const cronograma = montar([item([])], { de: "0001-01", ate: "9999-12" });
  assert.equal(cronograma.meses.length, 120);
  assert.equal(cronograma.truncado, true);
});

teste("bigint além de 2^53 sem perda e sem number intermediário", () => {
  const maximo = "9223372036854775807";
  const a = item([parcela({ vencimento: "2026-12-10", valorPrevistoCentavos: maximo, valorPagoCentavos: "9007199254740993" })], { valorContratadoCentavos: maximo });
  const b = item([parcela({ vencimento: "2026-12-11", valorPrevistoCentavos: maximo })], { valorContratadoCentavos: maximo });
  const cronograma = montar([a, b]);
  assert.equal(cronograma.linhas[0].celulas["2026-12"].pagoCentavos, "9007199254740993");
  assert.equal(cronograma.linhas[0].totalPendenteCentavos, (BigInt(maximo) - BigInt("9007199254740993")).toString());
  assert.equal(cronograma.totaisPorMes["2026-12"].previstoCentavos, (BigInt(maximo) * BigInt(2)).toString());
  assert.equal(cronograma.totalGeral.previstoCentavos, "18446744073709551614");
  assert.equal(cronograma.linhas[0].diferencaPrevistoCentavos, "0");
  assert.equal(formatarBRL(cronograma.totalGeral.previstoCentavos), "R$ 184.467.440.737.095.516,14");
});

teste("centavos exatos: 0,01 + 0,02 e valores string", () => {
  const cronograma = montar([item([parcela({ vencimento: "2026-12-10", valorPrevistoCentavos: "1" }), parcela({ vencimento: "2026-12-11", valorPrevistoCentavos: "2" })])]);
  assert.equal(cronograma.linhas[0].celulas["2026-12"].previstoCentavos, "3");
  for (const valor of [cronograma.totalGeral.previstoCentavos, cronograma.totalGeral.pagoCentavos, cronograma.totalGeral.pendenteCentavos]) assert.equal(typeof valor, "string");
});

teste("diferença negativa quando o previsto passa do contratado", () => {
  const cronograma = montar([item([parcela({ valorPrevistoCentavos: "15000" })], { valorContratadoCentavos: "10000" })]);
  assert.equal(cronograma.linhas[0].diferencaPrevistoCentavos, "-5000");
});

teste("totais coerentes com resumir (sem filtro)", () => {
  const itens = [
    item([
      parcela({ vencimento: "2026-09-10", valorPrevistoCentavos: "5000", valorPagoCentavos: "5000" }),
      parcela({ vencimento: "2026-12-10", valorPrevistoCentavos: "7000", valorPagoCentavos: "2000" }),
    ], { valorContratadoCentavos: "12000" }),
    item([parcela({ vencimento: "2027-02-10", valorPrevistoCentavos: "3000" })], { valorContratadoCentavos: "3000" }),
    item([], { valorContratadoCentavos: "900" }),
  ];
  const cronograma = montar(itens);
  const resumo = resumir(itens);
  assert.equal(cronograma.totalGeral.pagoCentavos, resumo.pagoCentavos);
  const somaPrevistoLinhas = somarCentavos(cronograma.linhas.map((l) => l.totalPrevistoCentavos));
  assert.equal(somaPrevistoLinhas, cronograma.totalGeral.previstoCentavos);
  assert.equal(somarCentavos(cronograma.meses.map((m) => cronograma.totaisPorMes[m].previstoCentavos)), somaPrevistoLinhas);
  assert.equal(somarCentavos(cronograma.meses.map((m) => cronograma.totaisPorMes[m].pendenteCentavos)), cronograma.totalGeral.pendenteCentavos);
  // contratado - pago = saldo; programado + falta programar = contratado.
  const contratado = somarCentavos(cronograma.linhas.map((l) => l.contratadoCentavos));
  assert.equal(contratado, resumo.contratadoCentavos);
  const falta = somarCentavos(cronograma.linhas.map((l) => l.diferencaPrevistoCentavos));
  assert.equal((BigInt(cronograma.totalGeral.previstoCentavos) + BigInt(falta)).toString(), contratado);
  assert.equal(resumo.saldoCentavos, (BigInt(contratado) - BigInt(resumo.pagoCentavos)).toString());
});

teste("entrada não é alterada pela montagem", () => {
  const original = [item([parcela({ id: idDe(70), vencimento: "2026-12-20" }), parcela({ id: idDe(69), vencimento: "2026-12-01" })])];
  const copia = JSON.parse(JSON.stringify(original));
  montar(original);
  assert.deepEqual(original, copia);
});

teste("rótulos de mês em português", () => {
  assert.equal(rotuloMesAbreviado("2026-03"), "mar");
  assert.equal(rotuloMesCompleto("2026-03"), "março de 2026");
  assert.equal(rotuloMesAbreviado("2026-12"), "dez");
});

teste("acesso: páginas só para cliente/staff, no servidor, sem loading nem API nova", () => {
  const ler = (caminho) => readFileSync(resolve(raiz, caminho), "utf8");
  const cliente = ler("src/app/cliente/empreendimentos/[id]/cronograma/page.tsx");
  const admin = ler("src/app/adm-interno/(protegido)/portal/cronograma/page.tsx");
  assert.match(cliente, /exigirPapel\(\["cliente"\]/);
  assert.match(admin, /await exigirRegraPagina\("financeiro\.ver"\)/);
  assert.doesNotMatch(admin, /PAPEIS_STAFF|exigirPapel\(/);
  assert.ok(admin.indexOf('exigirRegraPagina("financeiro.ver")') < admin.indexOf("listarOpcoesEmpreendimentos()"));
  assert.ok(admin.indexOf('exigirRegraPagina("financeiro.ver")') < admin.indexOf("obterCronograma("));
  for (const pagina of [cliente, admin]) {
    assert.match(pagina, /force-dynamic/);
    assert.doesNotMatch(pagina, /fornecedor|empreiteiro|Suspense/);
  }
  assert.match(cliente, /robots/);
  for (const pasta of [
    "src/app/cliente/empreendimentos/[id]/cronograma",
    "src/app/adm-interno/(protegido)/portal/cronograma",
  ]) {
    assert.equal(existsSync(resolve(raiz, pasta, "loading.tsx")), false);
  }
  assert.equal(existsSync(resolve(raiz, "src/app/api/(modules)/adm-interno/portal/cronograma")), false);
  const consultas = ler("src/lib/portal/cronograma/consultas.ts");
  assert.match(consultas, /^import "server-only";/);
  assert.doesNotMatch(consultas, /secret|createAdminClient|admin/i);
});

teste("regras do cronograma não usam literal bigint nem server-only", () => {
  const fonte = readFileSync(resolve(raiz, "src/lib/portal/cronograma/regras.ts"), "utf8");
  assert.doesNotMatch(fonte, /\b\d+n\b/);
  assert.doesNotMatch(fonte, /server-only/);
  assert.doesNotMatch(fonte, /parseInt|parseFloat|Number\(parcela|Number\(item/);
});

teste("obterCronograma usa a sessão e o financeiro existente", async () => {
  const { obterCronograma } = carregar("src/lib/portal/cronograma/consultas.ts");
  const consultado = [];
  const itemLido = {
    id: idDe(3001), descricao: "Contrato", fornecedorId: null, observacao: null, valorContratadoCentavos: "30000",
    codigo: null, versao: null, assinadoEm: null, documentoId: null, atualizadoEm: "2026-11-01T12:00:00Z",
  };
  const parcelaLida = {
    itemId: itemLido.id, nome: null, valorPrevistoCentavos: "10000", valorPagoCentavos: "0", dataPagamento: null,
    gatilho: "data", eventoTipo: null, eventoProjetoId: null, eventoDescricao: null, diasApos: 0, eventoId: null,
  };
  const tabelas = {
    itens_financeiros: [itemLido],
    parcelas: [
      { ...parcelaLida, id: idDe(3002), numero: 1, vencimento: "2026-02-10" },
      { ...parcelaLida, id: idDe(3003), numero: 2, vencimento: null, gatilho: "evento", eventoTipo: "aprovacao" },
    ],
    item_financeiro_projetos: [{ itemId: itemLido.id, projetos: { id: idDe(3004), nome: "SAA" } }],
  };
  const consulta = (tabela) => {
    const construtor = {
      select: () => construtor, eq: () => construtor, order: () => construtor,
      range: async (inicio, fim) => ({ data: tabelas[tabela].slice(inicio, fim + 1), error: null }),
    };
    consultado.push(tabela);
    return construtor;
  };
  sessaoAtual = { from: consulta, rpc: async () => ({ data: null, error: null }) };
  const cronograma = await obterCronograma(idDe(1), { de: "2026-01", ate: "2026-02" });
  assert.deepEqual(consultado, ["itens_financeiros", "parcelas", "item_financeiro_projetos"]);
  assert.deepEqual(cronograma.meses, ["2026-01", "2026-02"]);
  assert.deepEqual(Object.keys(cronograma.linhas[0].celulas), ["2026-02"]);
  assert.deepEqual(cronograma.aguardandoEvento, { quantidade: 1, pendenteCentavos: "10000" });
  assert.deepEqual((await obterCronograma("não-é-uuid")).linhas, []);
});

for (const [nome, fn] of testes) {
  try {
    await fn();
    console.log(`ok - ${nome}`);
  } catch (erro) {
    console.error(`FALHA - ${nome}`);
    throw erro;
  }
}
console.log(`\n${testes.length} testes do cronograma passaram.`);
