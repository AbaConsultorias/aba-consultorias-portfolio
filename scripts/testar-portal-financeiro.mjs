import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const {
  parcelaQuitada, calcularSaldo, proximoPagamento, parcelaEmAtraso, resumir, formatarBRL,
  converterReaisParaCentavos, centavosParaCampo, saldoDaParcela, diferencaPrevisto, dataCivilDeHoje,
  nomeParcela, percentualDoContratado, valorDoPercentual, situacaoDoItem,
  situacaoVisualParcela, parcelaAguardaEvento, parcelaVenceEmBreve, parcelasAVencer, compararParcelas, DIAS_VENCE_EM_BREVE,
} = carregar("src/lib/portal/financeiro/regras.ts");

let contador = 0;
const idDe = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const parcela = (sobrescrever = {}) => ({
  id: idDe(++contador), itemId: idDe(900), numero: null, nome: null, vencimento: "2026-12-10",
  valorPrevistoCentavos: "10000", valorPagoCentavos: "0", dataPagamento: null,
  gatilho: "data", eventoTipo: null, eventoProjetoId: null, eventoDescricao: null, diasApos: 0, eventoId: null, ...sobrescrever,
});
const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

teste("quitação por data, mesmo sem valor", () => {
  assert.equal(parcelaQuitada(parcela({ dataPagamento: "2026-11-01" })), true);
  assert.equal(parcelaQuitada(parcela({ dataPagamento: "2026-11-01", valorPagoCentavos: "5000" })), true);
});
teste("previsto zero está quitada", () => {
  assert.equal(parcelaQuitada(parcela({ valorPrevistoCentavos: "0" })), true);
});
teste("pagamento parcial não quita e não tem data", () => {
  const p = parcela({ valorPagoCentavos: "9999" });
  assert.equal(parcelaQuitada(p), false);
  assert.equal(saldoDaParcela(p), "1");
});
teste("pago exato e em excesso quitam", () => {
  assert.equal(parcelaQuitada(parcela({ valorPagoCentavos: "10000" })), true);
  const excesso = parcela({ valorPagoCentavos: "10001" });
  assert.equal(parcelaQuitada(excesso), true);
  assert.equal(saldoDaParcela(excesso), "0");
});
teste("saldo soma todos os pagamentos e pode ficar negativo", () => {
  const parcelas = [parcela({ valorPagoCentavos: "7000" }), parcela({ valorPagoCentavos: "5000", dataPagamento: "2026-10-01" })];
  assert.equal(calcularSaldo("10000", parcelas), "-2000");
  assert.equal(calcularSaldo("10000", []), "10000");
  assert.equal(calcularSaldo("0", []), "0");
});
teste("pagamento em parcela não quitada entra no saldo", () => {
  assert.equal(calcularSaldo("30000", [parcela({ valorPagoCentavos: "250" })]), "29750");
});
teste("atraso depende da data e não altera a quitação", () => {
  const vencida = parcela({ vencimento: "2026-10-27" });
  assert.equal(parcelaEmAtraso(vencida, "2026-10-28"), true);
  assert.equal(parcelaEmAtraso(vencida, "2026-10-27"), false);
  assert.equal(parcelaQuitada(vencida), false);
  assert.equal(parcelaEmAtraso(parcela({ vencimento: "2026-10-27", dataPagamento: "2026-10-27" }), "2026-10-28"), false);
  assert.equal(parcelaEmAtraso(parcela({ vencimento: "2026-10-27", valorPagoCentavos: "10000" }), "2026-10-28"), false);
});
teste("situação do item sem parcelas, futuro, hoje e pagamento parcial", () => {
  const hoje = "2026-10-28";
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "10000", parcelas: [] }, hoje), "em-dia");
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "10000", parcelas: [parcela()] }, hoje), "em-dia");
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "10000", parcelas: [parcela({ vencimento: hoje, valorPagoCentavos: "500" })] }, hoje), "vence-em-breve");
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "10000", parcelas: [parcela({ valorPagoCentavos: "500" })] }, hoje), "parcial");
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "10000", parcelas: [parcela({ vencimento: "2026-10-27", valorPagoCentavos: "500" })] }, hoje), "atraso");
});
teste("situação do item exige todas as parcelas quitadas, por data ou valor", () => {
  const hoje = "2026-10-28";
  const quitadas = [
    parcela({ vencimento: "2026-10-01", dataPagamento: hoje }),
    parcela({ valorPagoCentavos: "10000" }),
    parcela({ valorPagoCentavos: "10001" }),
    parcela({ valorPrevistoCentavos: "0" }),
  ];
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "20001", parcelas: quitadas }, hoje), "quitado");
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "30001", parcelas: [...quitadas, parcela()] }, hoje), "em-dia");
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "30001", parcelas: [...quitadas, parcela({ vencimento: "2026-10-01" })] }, hoje), "atraso");
});
teste("parcelas quitadas não quitam um item com saldo positivo", () => {
  const hoje = "2026-10-28";
  const parcelas = [parcela({ valorPrevistoCentavos: "5000000", valorPagoCentavos: "5000000", dataPagamento: hoje })];
  assert.equal(calcularSaldo("10000000", parcelas), "5000000");
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "10000000", parcelas }, hoje), "em-dia");
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "5000000", parcelas }, hoje), "quitado");
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "4999999", parcelas }, hoje), "quitado");
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "10000", parcelas: [parcela({ dataPagamento: hoje })] }, hoje), "em-dia");
  const grande = [parcela({ valorPrevistoCentavos: "9007199254740992", valorPagoCentavos: "9007199254740992" })];
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "9007199254740993", parcelas: grande }, hoje), "em-dia");
});
teste("atraso prevalece mesmo com saldo do item negativo; mantém precisão bigint", () => {
  const parcelas = [parcela({ valorPagoCentavos: "9007199254740993" }), parcela({ vencimento: "2026-10-01" })];
  assert.equal(calcularSaldo("10000", parcelas), "-9007199254730993");
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "10000", parcelas }, "2026-10-28"), "atraso");
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "9007199254740993", parcelas: [parcela({
    valorPrevistoCentavos: "9007199254740993", valorPagoCentavos: "9007199254740992",
  })] }, "2026-10-28"), "parcial");
});
teste("situação visual da parcela: quitada, vencida, vence hoje, em 15 e em 16 dias, parcial e aberta", () => {
  const hoje = "2026-10-28";
  assert.equal(situacaoVisualParcela(parcela({ dataPagamento: "2026-10-01", vencimento: "2026-09-01" }), hoje), "quitada");
  assert.equal(situacaoVisualParcela(parcela({ valorPagoCentavos: "10000", vencimento: "2026-09-01" }), hoje), "quitada");
  assert.equal(situacaoVisualParcela(parcela({ vencimento: "2026-10-27" }), hoje), "vencida");
  assert.equal(situacaoVisualParcela(parcela({ vencimento: hoje }), hoje), "vence-em-breve");
  assert.equal(situacaoVisualParcela(parcela({ vencimento: "2026-11-12" }), hoje), "vence-em-breve");
  assert.equal(situacaoVisualParcela(parcela({ vencimento: "2026-11-13" }), hoje), "aberta");
  assert.equal(situacaoVisualParcela(parcela({ vencimento: "2026-11-30", valorPagoCentavos: "1" }), hoje), "parcial");
  assert.equal(situacaoVisualParcela(parcela({ vencimento: "2026-11-30" }), hoje), "aberta");
});
teste("situação visual atravessa virada de mês e de ano", () => {
  assert.equal(situacaoVisualParcela(parcela({ vencimento: "2027-01-12" }), "2026-12-28"), "vence-em-breve");
  assert.equal(situacaoVisualParcela(parcela({ vencimento: "2027-01-13" }), "2026-12-28"), "aberta");
  assert.equal(situacaoVisualParcela(parcela({ vencimento: "2026-03-09" }), "2026-02-22"), "vence-em-breve");
  assert.equal(situacaoVisualParcela(parcela({ vencimento: "2026-03-10" }), "2026-02-22"), "aberta");
});
teste("prioridade da situação visual: quitada > vencida > vence em breve > parcial > aberta", () => {
  const hoje = "2026-10-28";
  assert.equal(situacaoVisualParcela(parcela({ vencimento: "2026-10-01", valorPagoCentavos: "500" }), hoje), "vencida");
  assert.equal(situacaoVisualParcela(parcela({ vencimento: "2026-10-01", valorPagoCentavos: "10000" }), hoje), "quitada");
  assert.equal(situacaoVisualParcela(parcela({ vencimento: hoje, valorPagoCentavos: "500" }), hoje), "vence-em-breve");
  assert.equal(situacaoVisualParcela(parcela({ vencimento: "2026-11-12", valorPagoCentavos: "500" }), hoje), "vence-em-breve");
  assert.equal(situacaoVisualParcela(parcela({ vencimento: "2026-11-13", valorPagoCentavos: "500" }), hoje), "parcial");
  assert.equal(situacaoVisualParcela(parcela({ vencimento: hoje, dataPagamento: hoje }), hoje), "quitada");
  assert.equal(situacaoVisualParcela(parcela({ valorPrevistoCentavos: "0", vencimento: "2026-10-01" }), hoje), "quitada");
});
teste("pior situação do item: vencida > vence em breve > parcial > em aberto; quitado só com saldo <= 0", () => {
  const hoje = "2026-10-28";
  const quitada = parcela({ vencimento: "2026-10-01", dataPagamento: "2026-10-01", valorPagoCentavos: "10000" });
  const breve = parcela({ vencimento: "2026-11-02" });
  const parcial = parcela({ vencimento: "2026-12-01", valorPagoCentavos: "500" });
  const vencida = parcela({ vencimento: "2026-10-20" });
  const aberta = parcela({ vencimento: "2026-12-10" });
  const item = (parcelas, contratado = "100000") => situacaoDoItem({ valorContratadoCentavos: contratado, parcelas }, hoje);
  assert.equal(item([quitada, breve, parcial, vencida, aberta]), "atraso");
  assert.equal(item([quitada, breve, parcial, aberta]), "vence-em-breve");
  assert.equal(item([quitada, parcial, aberta]), "parcial");
  assert.equal(item([quitada, aberta]), "em-dia");
  assert.equal(item([quitada], "10000"), "quitado");
  assert.equal(item([quitada], "20000"), "em-dia");
});
teste("janela de vence em breve é de 15 dias, inclusive", () => {
  const hoje = "2026-10-28";
  assert.equal(DIAS_VENCE_EM_BREVE, 15);
  assert.equal(parcelaVenceEmBreve(parcela({ vencimento: "2026-11-12" }), hoje), true);
  assert.equal(parcelaVenceEmBreve(parcela({ vencimento: "2026-11-13" }), hoje), false);
  assert.equal(parcelaVenceEmBreve(parcela({ vencimento: "2026-10-27" }), hoje), false);
  assert.equal(parcelaVenceEmBreve(parcela({ vencimento: "2026-11-12", dataPagamento: hoje }), hoje), false);
  const item = (vencimento) => situacaoDoItem({ valorContratadoCentavos: "10000", parcelas: [parcela({ vencimento })] }, hoje);
  assert.equal(item("2026-11-12"), "vence-em-breve");
  assert.equal(item("2026-11-13"), "em-dia");
  const a = parcela({ vencimento: "2026-11-12" });
  const b = parcela({ vencimento: "2026-11-13" });
  assert.deepEqual(parcelasAVencer([b, a], hoje), [a]);
  assert.deepEqual(parcelasAVencer([b, a], hoje, 16), [a, b]);
});
teste("parcela aguardando evento (vencimento nulo) fica fora do atraso, do vence em breve e do próximo pagamento", () => {
  const hoje = "2026-10-28";
  const aguarda = parcela({ vencimento: null, gatilho: "evento", eventoTipo: "aprovacao" });
  assert.equal(parcelaAguardaEvento(aguarda), true);
  assert.equal(situacaoVisualParcela(aguarda, hoje), "aguarda-evento");
  assert.equal(parcelaEmAtraso(aguarda, hoje), false);
  assert.equal(parcelaVenceEmBreve(aguarda, hoje), false);
  assert.deepEqual(parcelasAVencer([aguarda], hoje), []);
  assert.equal(proximoPagamento([aguarda]), null);
  const futura = parcela({ vencimento: "2027-05-01" });
  assert.equal(proximoPagamento([aguarda, futura]), futura);
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "10000", parcelas: [aguarda] }, hoje), "em-dia");
  assert.equal(situacaoDoItem({ valorContratadoCentavos: "20000", parcelas: [aguarda, parcela({ vencimento: "2026-10-01" })] }, hoje), "atraso");
  assert.equal(resumir([{ valorContratadoCentavos: "10000", parcelas: [aguarda] }]).proximoPagamento, null);
});
teste("parcela de vencimento nulo quitada deixa de aguardar evento; pagamento parcial não", () => {
  const hoje = "2026-10-28";
  assert.equal(situacaoVisualParcela(parcela({ vencimento: null, dataPagamento: hoje }), hoje), "quitada");
  assert.equal(situacaoVisualParcela(parcela({ vencimento: null, valorPagoCentavos: "10000" }), hoje), "quitada");
  assert.equal(parcelaAguardaEvento(parcela({ vencimento: null, dataPagamento: hoje })), false);
  assert.equal(situacaoVisualParcela(parcela({ vencimento: null, valorPagoCentavos: "1" }), hoje), "aguarda-evento");
  assert.equal(parcelaAguardaEvento(parcela({ vencimento: "2026-12-01" })), false);
});
teste("parcelas ordenam por número, depois vencimento e id, com nulos por último", () => {
  const n2 = parcela({ numero: 2, vencimento: "2026-11-01" });
  const n1 = parcela({ numero: 1, vencimento: "2026-12-01" });
  const semNumeroCedo = parcela({ numero: null, vencimento: "2026-01-01" });
  const semNumeroTarde = parcela({ numero: null, vencimento: "2026-02-01" });
  const semNumeroSemData = parcela({ numero: null, vencimento: null });
  const mesmoNumeroSemData = parcela({ numero: 2, vencimento: null });
  const esperado = [n1, n2, mesmoNumeroSemData, semNumeroCedo, semNumeroTarde, semNumeroSemData];
  assert.deepEqual([...esperado].reverse().sort(compararParcelas), esperado);
  assert.deepEqual([semNumeroTarde, n2, semNumeroSemData, mesmoNumeroSemData, n1, semNumeroCedo].sort(compararParcelas), esperado);
  const a = parcela({ id: idDe(20), numero: 1, vencimento: "2026-12-01" });
  const b = parcela({ id: idDe(10), numero: 1, vencimento: "2026-12-01" });
  assert.deepEqual([a, b].sort(compararParcelas), [b, a]);
});
teste("próximo pagamento inclui atrasadas e ignora quitadas", () => {
  const atrasada = parcela({ vencimento: "2026-01-05" });
  const quitada = parcela({ vencimento: "2025-12-01", dataPagamento: "2025-12-01" });
  const futura = parcela({ vencimento: "2027-01-05" });
  assert.equal(proximoPagamento([futura, quitada, atrasada]), atrasada);
});
teste("próximo pagamento desempata por id", () => {
  const maior = parcela({ id: idDe(50), vencimento: "2026-12-01" });
  const menor = parcela({ id: idDe(20), vencimento: "2026-12-01" });
  assert.equal(proximoPagamento([maior, menor]), menor);
  assert.equal(proximoPagamento([menor, maior]), menor);
});
teste("próximo pagamento vazio ou tudo quitado é null", () => {
  assert.equal(proximoPagamento([]), null);
  assert.equal(proximoPagamento([parcela({ dataPagamento: "2026-01-01" })]), null);
});
teste("bigint além de 2^53 sem perda", () => {
  const grande = "9223372036854775807";
  const p = parcela({ valorPagoCentavos: grande, valorPrevistoCentavos: grande });
  assert.equal(calcularSaldo(grande, [p]), "0");
  assert.equal(calcularSaldo(grande, [p, parcela({ valorPagoCentavos: "1" })]), "-1");
  assert.equal(calcularSaldo("9007199254740993", []), "9007199254740993");
  assert.equal(parcelaQuitada(parcela({ valorPrevistoCentavos: "9007199254740993", valorPagoCentavos: "9007199254740992" })), false);
  assert.equal(formatarBRL("9223372036854775807"), "R$ 92.233.720.368.547.758,07");
  const itens = [1, 2].map((n) => ({
    id: idDe(n), descricao: "x", fornecedorId: null, fornecedorNome: null, observacao: null,
    valorContratadoCentavos: grande, parcelas: [parcela({ valorPagoCentavos: grande, valorPrevistoCentavos: grande })],
  }));
  const resumo = resumir(itens);
  assert.equal(resumo.contratadoCentavos, "18446744073709551614");
  assert.equal(resumo.pagoCentavos, "18446744073709551614");
  assert.equal(resumo.saldoCentavos, "0");
});
teste("resumo agrega itens e parcelas", () => {
  const abertaCedo = parcela({ vencimento: "2026-02-01", valorPagoCentavos: "100" });
  const itens = [
    { id: idDe(1), descricao: "a", fornecedorId: null, fornecedorNome: null, observacao: null, valorContratadoCentavos: "20000", parcelas: [abertaCedo] },
    { id: idDe(2), descricao: "b", fornecedorId: null, fornecedorNome: null, observacao: null, valorContratadoCentavos: "1000", parcelas: [parcela({ valorPagoCentavos: "3000", dataPagamento: "2026-01-01" })] },
  ];
  const resumo = resumir(itens);
  assert.deepEqual([resumo.contratadoCentavos, resumo.pagoCentavos, resumo.saldoCentavos], ["21000", "3100", "17900"]);
  assert.equal(resumo.proximoPagamento, abertaCedo);
  assert.deepEqual(resumir([]), { contratadoCentavos: "0", pagoCentavos: "0", saldoCentavos: "0", proximoPagamento: null });
});
teste("diferença entre contratado e previsto", () => {
  assert.equal(diferencaPrevisto("25000", [parcela(), parcela()]), "5000");
  assert.equal(diferencaPrevisto("5000", [parcela()]), "-5000");
});
teste("formatação BRL mantém centavos", () => {
  assert.equal(formatarBRL("0"), "R$ 0,00");
  assert.equal(formatarBRL("1"), "R$ 0,01");
  assert.equal(formatarBRL("99"), "R$ 0,99");
  assert.equal(formatarBRL("123456789"), "R$ 1.234.567,89");
  assert.equal(formatarBRL("-150"), "-R$ 1,50");
});
teste("entrada em reais vira centavos exatos", () => {
  assert.equal(converterReaisParaCentavos("1.250,00"), "125000");
  assert.equal(converterReaisParaCentavos("R$ 0,5"), "50");
  assert.equal(converterReaisParaCentavos("12,34"), "1234");
  assert.equal(converterReaisParaCentavos("12.5"), "1250");
  assert.equal(converterReaisParaCentavos("7"), "700");
  assert.equal(converterReaisParaCentavos("92233720368547758,07"), "9223372036854775807");
  assert.equal(converterReaisParaCentavos("92233720368547758,08"), null);
  for (const invalido of ["", "abc", "1,234", "-1", "1,2,3"]) assert.equal(converterReaisParaCentavos(invalido), null);
  assert.equal(centavosParaCampo("125000"), "1250,00");
  assert.equal(centavosParaCampo("5"), "0,05");
});
teste("data civil de hoje usa o fuso de São Paulo", () => {
  assert.equal(dataCivilDeHoje(new Date("2026-10-28T02:30:00Z")), "2026-10-27");
  assert.equal(dataCivilDeHoje(new Date("2026-10-28T12:00:00Z")), "2026-10-28");
});

// Sessão simulada: devolve páginas por range, como o Supabase limitado a 100 por consulta.
function simularSessao({ itens, parcelas, nomes, vinculos = [], falhaRpc = false }) {
  const consultas = [];
  const tabelas = { itens_financeiros: itens, parcelas, item_financeiro_projetos: vinculos };
  return {
    consultas,
    from(tabela) {
      return {
        select(campos) { consultas.push({ tabela, campos, filtros: [] }); return this; },
        eq(campo, valor) { consultas.at(-1).filtros.push([campo, valor]); return this; },
        order() { return this; },
        async range(inicio, fim) {
          consultas.at(-1).faixa = [inicio, fim];
          return { data: tabelas[tabela].slice(inicio, fim + 1), error: null };
        },
      };
    },
    async rpc(nome, args) {
      consultas.push({ rpc: nome, args });
      return falhaRpc ? { data: null, error: { code: "TEST" } } : { data: nomes[args.p_fornecedor] ?? null, error: null };
    },
  };
}

teste("nome da parcela usa o próprio nome ou a posição", () => {
  assert.equal(nomeParcela(parcela(), 1), "1ª parcela");
  assert.equal(nomeParcela(parcela(), 12), "12ª parcela");
  assert.equal(nomeParcela(parcela({ nome: "Assinatura do contrato" }), 1), "Assinatura do contrato");
});
teste("percentual e valor previsto se convertem nos dois sentidos", () => {
  assert.equal(percentualDoContratado("3000000", "12000000"), "25");
  assert.equal(percentualDoContratado("1500000", "12000000"), "12,5");
  assert.equal(percentualDoContratado("1000000", "3000000"), "33,33");
  assert.equal(percentualDoContratado("100", "0"), null);
  assert.equal(valorDoPercentual("25", "12000000"), "3000000");
  assert.equal(valorDoPercentual("12,5%", "12000000"), "1500000");
  assert.equal(valorDoPercentual("33.33", "3000000"), "999900");
  assert.equal(valorDoPercentual("100", "9007199254740993"), "9007199254740993");
  assert.equal(valorDoPercentual("100,01", "100"), null);
  assert.equal(valorDoPercentual("abc", "100"), null);
});
teste("consulta lê todas as páginas, cai em RPC para nome e agrega bigint", async () => {
  const { obterFinanceiro } = carregar("src/lib/portal/financeiro/consultas.ts");
  const empreendimento = idDe(7);
  const fornecedorA = idDe(801);
  const itens = Array.from({ length: 205 }, (_, n) => ({
    id: idDe(1000 + n), descricao: `Item ${n}`, fornecedorId: n % 2 === 0 ? fornecedorA : null,
    observacao: null, valorContratadoCentavos: "9007199254740993",
    codigo: null, versao: null, assinadoEm: null, documentoId: null, atualizadoEm: "2026-11-01T12:00:00Z",
  }));
  const parcelas = Array.from({ length: 230 }, (_, n) => ({
    id: idDe(5000 + n), itemId: itens[n % 205].id, numero: null, nome: null, vencimento: "2027-01-10",
    valorPrevistoCentavos: "9007199254740993", valorPagoCentavos: n < 205 ? "9007199254740993" : "0", dataPagamento: null,
    gatilho: "data", eventoTipo: null, eventoProjetoId: null, eventoDescricao: null, diasApos: 0, eventoId: null,
  }));
  sessaoAtual = simularSessao({ itens, parcelas, nomes: { [fornecedorA]: "Fornecedor A" } });
  const { itens: lidos, resumo } = await obterFinanceiro(empreendimento);
  assert.equal(lidos.length, 205);
  assert.equal(lidos.reduce((total, item) => total + item.parcelas.length, 0), 230);
  assert.equal(lidos[0].fornecedorNome, "Fornecedor A");
  assert.equal(lidos[1].fornecedorNome, null);
  assert.equal(sessaoAtual.consultas.filter((c) => c.rpc === "nome_fornecedor").length, 1);
  assert.ok(sessaoAtual.consultas.some((c) => c.tabela === "itens_financeiros" && c.faixa[0] === 200));
  assert.ok(sessaoAtual.consultas.some((c) => c.tabela === "parcelas" && c.faixa[0] === 200));
  assert.ok(sessaoAtual.consultas.every((c) => !c.tabela || c.tabela === "item_financeiro_projetos" || /::text/.test(c.campos) || /observacao/.test(c.campos)));
  assert.equal(resumo.contratadoCentavos, (BigInt("9007199254740993") * BigInt(205)).toString());
  assert.equal(resumo.pagoCentavos, (BigInt("9007199254740993") * BigInt(205)).toString());
  assert.equal(resumo.saldoCentavos, "0");
});
teste("consulta ordena parcelas por número, projetos por nome e junta o vínculo do contrato", async () => {
  const { obterFinanceiro } = carregar("src/lib/portal/financeiro/consultas.ts");
  const item = {
    id: idDe(2001), descricao: "Contrato", fornecedorId: null, observacao: null, valorContratadoCentavos: "30000",
    codigo: "260703C", versao: 1, assinadoEm: null, documentoId: null, atualizadoEm: "2026-11-01T12:00:00Z",
  };
  const base = { itemId: item.id, nome: null, valorPrevistoCentavos: "10000", valorPagoCentavos: "0", dataPagamento: null,
    gatilho: "data", eventoTipo: null, eventoProjetoId: null, eventoDescricao: null, diasApos: 0, eventoId: null };
  const terceira = { ...base, id: idDe(3), numero: 3, vencimento: null, gatilho: "evento", eventoTipo: "aprovacao" };
  const primeira = { ...base, id: idDe(1), numero: 1, vencimento: "2027-01-10" };
  const segunda = { ...base, id: idDe(2), numero: 2, vencimento: "2026-12-10" };
  const vinculos = [
    { itemId: item.id, projetos: { id: idDe(11), nome: "SAA" } },
    { itemId: item.id, projetos: { id: idDe(12), nome: "DT" } },
    { itemId: item.id, projetos: null },
  ];
  sessaoAtual = simularSessao({ itens: [item], parcelas: [terceira, primeira, segunda], nomes: {}, vinculos });
  const { itens, resumo } = await obterFinanceiro(idDe(2000));
  assert.deepEqual(itens[0].parcelas.map((p) => p.numero), [1, 2, 3]);
  assert.deepEqual(itens[0].projetos.map((p) => p.nome), ["DT", "SAA"]);
  assert.equal(resumo.proximoPagamento.id, segunda.id);
  assert.equal(situacaoVisualParcela(itens[0].parcelas[2], "2026-10-28"), "aguarda-evento");
});
teste("consulta rejeita bigint fora do formato e erro de banco", async () => {
  const { obterFinanceiro } = carregar("src/lib/portal/financeiro/consultas.ts");
  const item = { id: idDe(1), descricao: "x", fornecedorId: null, observacao: null, valorContratadoCentavos: 100,
    codigo: null, versao: null, assinadoEm: null, documentoId: null, atualizadoEm: "2026-11-01T12:00:00Z" };
  sessaoAtual = simularSessao({ itens: [item], parcelas: [], nomes: {} });
  const silenciar = console.error;
  console.error = () => {};
  try {
    await assert.rejects(() => obterFinanceiro(idDe(8)), { status: 500 });
    sessaoAtual = simularSessao({ itens: [], parcelas: [], nomes: {} });
    assert.deepEqual((await obterFinanceiro(idDe(9))).itens, []);
    assert.deepEqual((await obterFinanceiro("não-é-uuid")).itens, []);
  } finally {
    console.error = silenciar;
  }
});

teste("esquemas validam centavos, datas e lista do seletor", () => {
  const { centavosSchema, dataCivilSchema } = carregar("src/lib/portal/financeiro/campos.ts");
  assert.equal(centavosSchema.safeParse("9223372036854775807").success, true);
  assert.equal(centavosSchema.safeParse("9223372036854775808").success, false);
  assert.equal(centavosSchema.safeParse("-1").success, false);
  assert.equal(centavosSchema.safeParse("1.5").success, false);
  assert.equal(dataCivilSchema.safeParse("2028-02-29").success, true);
  assert.equal(dataCivilSchema.safeParse("2027-02-29").success, false);
  assert.equal(dataCivilSchema.safeParse("2027-13-01").success, false);
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
console.log(`\n${testes.length} testes do financeiro passaram.`);
