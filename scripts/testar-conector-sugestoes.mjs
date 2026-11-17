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

const { sugerirRegras, validarPrefixoDeRegra, pastasDaArvore, TAMANHO_MAXIMO_PREFIXO } = carregar("src/lib/conector/sugestoes.ts");

const PROJETOS = [
  { id: "p-saa", nome: "SAA - Abastecimento" },
  { id: "p-ses", nome: "SES Esgoto" },
  { id: "p-per", nome: "Projeto PER" },
  { id: "p-pec1", nome: "PEC Norte" },
  { id: "p-pec2", nome: "PEC Sul" },
  { id: "p-est", nome: "Projeto Estrutural" },
  { id: "p-rede", nome: "Rede de drenagem" },
];

const sugerir = (pastas, projetos = PROJETOS, regrasExistentes = []) => sugerirRegras({ pastas, projetos, regrasExistentes });
const caminhos = (sugestoes) => sugestoes.map((s) => s.caminhoPrefixo);

// --- SAA: prefere a subpasta aprovada (D2) e liga ao único projeto SAA ---------------------------------------------
{
  const resultado = sugerir(["03 - PRODUTOS", "03 - PRODUTOS/SAA", "03 - PRODUTOS/SAA/APROVADO", "03 - PRODUTOS/SAA/RASCUNHO"]);
  assert.deepEqual(caminhos(resultado), ["03 - PRODUTOS/SAA/APROVADO"]);
  assert.equal(resultado[0].projetoId, "p-saa");
  assert.equal(resultado[0].grupo, null);
  assert.equal(resultado[0].pastaFinal, true);
  assert.equal(resultado[0].rotulo, "SAA");
}

// Sem subpasta final, a própria pasta casada é a sugestão. Pasta final mais funda não vira regra no lugar da mais rasa.
{
  assert.deepEqual(caminhos(sugerir(["03 - PRODUTOS/SAA", "03 - PRODUTOS/SAA/RASCUNHO"])), ["03 - PRODUTOS/SAA"]);
  assert.equal(sugerir(["03 - PRODUTOS/SAA", "03 - PRODUTOS/SAA/RASCUNHO"])[0].pastaFinal, false);
  assert.deepEqual(caminhos(sugerir(["SAA", "SAA/APROVADO NO INTERLIGA", "SAA/APROVADO NO INTERLIGA/03 - PDF"])), ["SAA/APROVADO NO INTERLIGA"]);
  // Árvore sem a pasta intermediária: o prefixo é derivado até a primeira pasta final.
  assert.deepEqual(caminhos(sugerir(["X/SAA/APROVADO/PDF"])), ["X/SAA/APROVADO"]);
}

// --- PROPOSTA-CONTRATO → grupo contratos, subpastas finais (PDF, ASSINADOS) ----------------------------------------
{
  const resultado = sugerir([
    "01 - FINANCEIRO",
    "01 - FINANCEIRO/01 - PROPOSTA-CONTRATO",
    "01 - FINANCEIRO/01 - PROPOSTA-CONTRATO/03 - PDF",
    "01 - FINANCEIRO/01 - PROPOSTA-CONTRATO/01 - ASSINADOS",
    "01 - FINANCEIRO/01 - PROPOSTA-CONTRATO/02 - RASCUNHOS",
  ]);
  assert.deepEqual(caminhos(resultado), ["01 - FINANCEIRO/01 - PROPOSTA-CONTRATO/01 - ASSINADOS", "01 - FINANCEIRO/01 - PROPOSTA-CONTRATO/03 - PDF"]);
  for (const sugestao of resultado) {
    assert.equal(sugestao.grupo, "contratos");
    assert.equal(sugestao.projetoId, null);
  }
  assert.deepEqual(caminhos(sugerir(["01 - FINANCEIRO/PROPOSTA E CONTRATO"])), ["01 - FINANCEIRO/PROPOSTA E CONTRATO"]);
}

// --- ORÇAMENTOS DE 3 → grupo orcamentos; acento, NFD e caixa ----------------------------------------------------------
{
  const resultado = sugerir(["ORÇAMENTOS DE 3º"]);
  assert.deepEqual(caminhos(resultado), ["ORÇAMENTOS DE 3º"]);
  assert.equal(resultado[0].grupo, "orcamentos");
  assert.equal(resultado[0].projetoId, null);
  assert.deepEqual(caminhos(sugerir(["orcamento de 3 fornecedores"])), ["orcamento de 3 fornecedores"]);
  assert.deepEqual(caminhos(sugerir(["ORÇAMENTOS DE 30 ITENS"])), [], "3 seguido de outro dígito não é 'de 3'");

  const nfd = "ORÇAMENTOS DE 3º".normalize("NFD");
  assert.notEqual(nfd, "ORÇAMENTOS DE 3º");
  const doNfd = sugerir([nfd]);
  assert.deepEqual(caminhos(doNfd), ["ORÇAMENTOS DE 3º"], "a sugestão sai em NFC");
  assert.equal(caminhos(doNfd)[0].normalize("NFC"), caminhos(doNfd)[0]);
}

// --- NFD e caixa nos nomes de projeto e de pasta --------------------------------------------------------------------------
{
  const projetos = [{ id: "p-doacao", nome: "Doação de áreas".normalize("NFD") }];
  const resultado = sugerir(["03 - PRODUTOS/doação".normalize("NFD")], projetos);
  assert.deepEqual(caminhos(resultado), ["03 - PRODUTOS/doação"]);
  assert.equal(resultado[0].projetoId, "p-doacao");
  assert.equal(sugerir(["produtos/saa/aprovado"])[0].projetoId, "p-saa");
  assert.equal(sugerir(["PRODUTOS/SAA/APROVADO"], [{ id: "p-minusculo", nome: "saa" }])[0].projetoId, "p-minusculo");
}

// --- demais nomes conhecidos -------------------------------------------------------------------------------------------------
{
  const casos = [
    ["02 - SES", "SES", "p-ses"],
    ["02 - PER", "PER", "p-per"],
    ["Projeto Estrutural", "ESTRUTURAL", "p-est"],
  ];
  for (const [pasta, rotulo, projetoId] of casos) {
    const [sugestao] = sugerir([pasta]);
    assert.equal(sugestao.rotulo, rotulo, pasta);
    assert.equal(sugestao.projetoId, projetoId, pasta);
  }
  const termo = sugerir(["TERMO DE ACORDO"], [{ id: "p-termo", nome: "Termo de Acordo - Prefeitura" }])[0];
  assert.equal(termo.projetoId, "p-termo");
  const ordem = sugerir(["ORDEM DE SERVIÇO"], [{ id: "p-os", nome: "Ordem de Servico" }])[0];
  assert.equal(ordem.projetoId, "p-os");
  // Projeto casado pelo nome do modelo (tipo) quando o nome não diz.
  assert.equal(sugerir(["SES"], [{ id: "p-rede", nome: "Rede de drenagem", modeloNome: "Modelo SES" }])[0].projetoId, "p-rede");
  // Nome por extenso do sistema.
  assert.equal(sugerir(["SAA"], [{ id: "p-ext", nome: "Sistema de Abastecimento de Água" }])[0].projetoId, "p-ext");
}

// --- destino em branco: nenhum ou mais de um candidato ----------------------------------------------------------------------
{
  const ambiguo = sugerir(["03 - PRODUTOS/PEC"]);
  assert.equal(ambiguo.length, 1);
  assert.equal(ambiguo[0].projetoId, null);
  assert.equal(ambiguo[0].grupo, null);
  assert.match(ambiguo[0].motivo, /Mais de um projeto/);
  const nenhum = sugerir(["DOAÇÃO"], PROJETOS);
  assert.equal(nenhum[0].projetoId, null);
  assert.match(nenhum[0].motivo, /Nenhum projeto/);
  assert.equal(sugerir(["SAA"], [])[0].projetoId, null);
}

// --- nomes que só contêm a sigla por dentro não casam -------------------------------------------------------------------------
{
  assert.deepEqual(caminhos(sugerir(["SAAD", "PERSONAL", "ESPECIFICACAO", "OPERACOES", "SESMT", "03 - PRODUTOS", "ORCAMENTOS"])), []);
  assert.deepEqual(caminhos(sugerir(["01 - SAA 2"])), ["01 - SAA 2"], "número e espaço são fronteira");
}

// --- pasta bloqueada nunca é sugerida, nem como subpasta final nem como base ---------------------------------------------
{
  assert.deepEqual(caminhos(sugerir(["03 - PRODUTOS/SAA/COMPROVANTE", "02 - DADOS DO EMPREENDEDOR/SAA", "02 - DADOS DO EMPREENDEDOR/SAA/APROVADO"])), []);
  const comBloqueada = sugerir(["03 - PRODUTOS/SAA", "03 - PRODUTOS/SAA/APROVADO - COMPROVANTES", "03 - PRODUTOS/SAA/NOTAS FISCAIS/PDF", "03 - PRODUTOS/SAA/planilha de custos"]);
  assert.deepEqual(caminhos(comBloqueada), ["03 - PRODUTOS/SAA"], "só a pasta casada; as bloqueadas somem");
  // Bloqueio sem acento e sem caixa.
  assert.deepEqual(caminhos(sugerir(["SAA", "SAA/Notas Fiscais", "Comprovante/SES", "PLANILHA/PER", "Notas Fiscais".normalize("NFD")])), ["SAA"]);
  assert.deepEqual(caminhos(sugerir(["SAA/notas fiscalizadas"])), ["SAA"], "texto parecido, mas não é o termo bloqueado");
}

// --- pasta que já tem regra (ou está dentro de uma) não é sugerida -------------------------------------------------------------
{
  const arvore = ["03 - PRODUTOS/SAA", "03 - PRODUTOS/SAA/APROVADO", "03 - PRODUTOS/SES"];
  assert.deepEqual(caminhos(sugerir(arvore, PROJETOS, ["03 - PRODUTOS/SAA/APROVADO"])), ["03 - PRODUTOS/SES"]);
  assert.deepEqual(caminhos(sugerir(arvore, PROJETOS, ["03 - produtos/saa/aprovado"])), ["03 - PRODUTOS/SES"], "sem diferenciar caixa");
  assert.deepEqual(caminhos(sugerir(arvore, PROJETOS, ["03 - PRODUTOS/SAA"])), ["03 - PRODUTOS/SES"], "regra na pasta mãe cobre a subpasta");
  assert.deepEqual(caminhos(sugerir(arvore, PROJETOS, ["03 - PRODUTOS/SES"])), ["03 - PRODUTOS/SAA/APROVADO"]);
  // Regra em prefixo que só parece pai (sem fronteira de segmento) não cobre.
  assert.deepEqual(caminhos(sugerir(["03 - PRODUTOS/SES"], PROJETOS, ["03 - PRODUTOS/SE"])), ["03 - PRODUTOS/SES"]);
}

// --- caminhos inválidos, repetidos e longos ----------------------------------------------------------------------------------------
{
  assert.deepEqual(caminhos(sugerir(["../SAA", "/SAA", "C:/SAA", "SAA\\APROVADO", "SAA//APROVADO", "./SAA", "", "SAA/..", "SAA\u0000"])), []);
  assert.deepEqual(caminhos(sugerir(["SAA", "saa", "SAA/APROVADO", "saa/aprovado"])).length, 1, "caixa diferente é a mesma pasta");
  const longa = `${"A".repeat(260)}/${"B".repeat(260)}/SAA`;
  assert.deepEqual(caminhos(sugerir([longa])), [], "prefixo acima de 500 caracteres não é sugerido");
}

// --- ordem estável ---------------------------------------------------------------------------------------------------------------------
{
  const a = caminhos(sugerir(["SES", "SAA", "PER"]));
  const b = caminhos(sugerir(["PER", "SAA", "SES"]));
  assert.deepEqual(a, ["PER", "SAA", "SES"]);
  assert.deepEqual(a, b);
}

// --- validarPrefixoDeRegra --------------------------------------------------------------------------------------------------------------
{
  assert.deepEqual(validarPrefixoDeRegra("  03 - PRODUTOS/SAA/APROVADO  "), { valido: true, caminho: "03 - PRODUTOS/SAA/APROVADO" });
  assert.equal(validarPrefixoDeRegra("ORÇAMENTOS".normalize("NFD")).caminho, "ORÇAMENTOS");
  assert.equal(validarPrefixoDeRegra("a".repeat(TAMANHO_MAXIMO_PREFIXO)).valido, true);
  for (const ruim of ["", "   ", "/a", "a/", "a//b", "a/../b", "..", ".", "a/./b", "C:/a", "a:b", "a\\b", "\\\\srv\\a", "a".repeat(TAMANHO_MAXIMO_PREFIXO + 1), "a/\u0000b", "a/\u0007b", "a/\ud800b"]) {
    assert.equal(validarPrefixoDeRegra(ruim).valido, false, JSON.stringify(ruim));
  }
  for (const bloqueado of ["A/COMPROVANTE", "a/Notas Fiscais/x", "dados do empreendedor", "x/Planilha", "x/comprovantés", "NOTAS FISCAIS"]) {
    const resultado = validarPrefixoDeRegra(bloqueado);
    assert.equal(resultado.valido, false, bloqueado);
    assert.match(resultado.motivo, /nunca pode ter regra/);
  }
}

// --- pastasDaArvore --------------------------------------------------------------------------------------------------------------------------
{
  const arvore = {
    "250101": ["03 - PRODUTOS", "03 - PRODUTOS/SAA", "03 - produtos/saa", "03 - PRODUTOS/SAA/COMPROVANTE", "../x", "/x", "C:/x", "a\\b", "a//b", 7, null, "", "ORÇAMENTOS".normalize("NFD")],
    "250102": "não é lista",
    "250103": ["SES"],
  };
  assert.deepEqual(pastasDaArvore(arvore, "250101"), ["03 - PRODUTOS", "03 - PRODUTOS/SAA", "ORÇAMENTOS"]);
  assert.deepEqual(pastasDaArvore(arvore, "250102"), []);
  assert.deepEqual(pastasDaArvore(arvore, "999999"), [], "código sem árvore");
  assert.deepEqual(pastasDaArvore(arvore, "250103"), ["SES"]);
  for (const invalida of [null, undefined, "texto", 5, [], ["SES"]]) assert.deepEqual(pastasDaArvore(invalida, "250103"), []);
  assert.deepEqual(pastasDaArvore({}, "constructor"), [], "chave herdada do protótipo não vale");
  assert.equal(pastasDaArvore({ "250101": Array.from({ length: 6000 }, (_, i) => `pasta ${i}`) }, "250101").length, 5000);
}

console.log("testar-conector-sugestoes: OK");
