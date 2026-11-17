// Testes da montagem de projetos e regras a partir das pastas do servidor (src/lib/conector/montagem.ts).
// Uso: node scripts/testar-montagem-pastas.mjs   (sai com código 1 se algo falhar; não precisa de banco nem de rede)
// Opcional: com scripts/fixtures/arvores-servidor.json (árvores reais do servidor, fora deste repositório) roda também
// a conferência contra os empreendimentos reais
// e imprime um resumo por empreendimento.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { exit } from "node:process";
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

const { montarPrevia, normalizarNome, resolverSelecao, prontoParaComplementares, regrasOrfasDaArvore } = carregar("src/lib/conector/montagem.ts");
const { caminhoBloqueado } = carregar("src/lib/conector/regras.ts");
const { pastaIgnorada } = carregar("src/lib/conector/sinais.ts");
const { validarPrefixoDeRegra } = carregar("src/lib/conector/sugestoes.ts");

const falhas = [];
function conferir(descricao, funcao) {
  try {
    funcao();
  } catch (erro) {
    falhas.push(`${descricao}: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Catálogo: CATALOGO_SEED é o espelho do seed de supabase/migrations/20261111100000_modelo_pastas.sql; CATALOGO é o estado
// depois de supabase/migrations/20261113100000_pastas_ses_arquivo.sql (SES excluído de PER/PEC/DT, modelo próprio do estrutural
// da elevatória e os itens novos). O final do script confere as duas cópias contra os arquivos SQL.
// ---------------------------------------------------------------------------------------------------------------------
const PROJETO_BASE = { tipo: "projeto", grupo: null, destinoEquipamentos: null, termosExcluir: [], dependeDe: null, criaRegras: true, ativo: true };
const EXCLUIR_DOS_SISTEMAS = ["PER", "PEC", "TERMO", "ORDEM", "SIMOS", "LAUDOS", "DOACAO", "DESCRICAO", "TOPOGRAFICA", "ESTRUTURAL", "CONSULTORIA"];
const APROVADA = [[["APROVAD*"]]];
const CATALOGO_SEED = [
  { ...PROJETO_BASE, chave: "saa", rotulo: "SAA", raiz: "03 - PRODUTOS", termos: ["SAA"], termosExcluir: EXCLUIR_DOS_SISTEMAS, fase: "base", modeloId: "m-saa", nomeProjeto: "Sistema de Abastecimento de Água - SAA", categoria: "Projetos", subpastas: APROVADA, ordem: 10 },
  { ...PROJETO_BASE, chave: "ses", rotulo: "SES", raiz: "03 - PRODUTOS", termos: ["SES"], termosExcluir: EXCLUIR_DOS_SISTEMAS, fase: "base", modeloId: "m-ses", nomeProjeto: "Sistema de Esgotamento Sanitário - SES", categoria: "Projetos", subpastas: APROVADA, ordem: 20 },
  { ...PROJETO_BASE, chave: "dt", rotulo: "Descrição Topográfica", raiz: "03 - PRODUTOS", termos: ["DESCRICAO", "TOPOGRAFICA"], fase: "complementar", modeloId: "m-dt", nomeProjeto: "Descrição Topográfica", categoria: "Projetos", subpastas: APROVADA, dependeDe: "sistema", ordem: 30 },
  { ...PROJETO_BASE, chave: "per", rotulo: "PER", raiz: "03 - PRODUTOS", termos: ["PER"], termosExcluir: ["PEC"], fase: "complementar", modeloId: "m-per", nomeProjeto: "Projeto Elétrico Referência - PER", categoria: "Projetos", subpastas: APROVADA, dependeDe: "sistema", ordem: 40 },
  { ...PROJETO_BASE, chave: "pec", rotulo: "PEC", raiz: "03 - PRODUTOS", termos: ["PEC"], fase: "complementar", modeloId: "m-pec", nomeProjeto: "Projeto Elétrico Construtivo - PEC", categoria: "Projetos", subpastas: APROVADA, dependeDe: "sistema", ordem: 50 },
  { ...PROJETO_BASE, chave: "estrutural_reservatorio", rotulo: "Estrutural do Reservatório", raiz: "03 - PRODUTOS", termos: ["ESTRUTURAL", "RESERVATORIO|REL"], fase: "complementar", modeloId: "m-est", nomeProjeto: "Projeto Estrutural do Reservatório", categoria: "Projetos", subpastas: APROVADA, dependeDe: "sistema", ordem: 60 },
  { ...PROJETO_BASE, chave: "estrutural_elevatoria", rotulo: "Estrutural da Elevatória", raiz: "03 - PRODUTOS", termos: ["ESTRUTURAL", "ELEVATORIA|EAT|EEE"], fase: "complementar", modeloId: "m-est", nomeProjeto: "Projeto Estrutural da Elevatória", categoria: "Projetos", subpastas: APROVADA, dependeDe: "sistema", ordem: 70 },
  { ...PROJETO_BASE, chave: "termo", rotulo: "Termo de Acordo", raiz: "03 - PRODUTOS", termos: ["TERMO", "ACORDO"], fase: "base", modeloId: "m-termo", nomeProjeto: "Termo de Acordo e Plano de Trabalho", categoria: "Termo de Acordo e Plano de Trabalho", subpastas: APROVADA, ordem: 80 },
  { ...PROJETO_BASE, chave: "os", rotulo: "Ordem de Serviço", raiz: "03 - PRODUTOS", termos: ["ORDEM", "SERVICO"], fase: "base", modeloId: "m-os", nomeProjeto: "Ordem de Serviço", categoria: "Ordem de Serviço", subpastas: APROVADA, ordem: 90 },
  { ...PROJETO_BASE, chave: "simos", rotulo: "SIMOS e Laudos", raiz: "03 - PRODUTOS", termos: ["SIMOS"], fase: "base", tipo: "equipamentos", modeloId: null, nomeProjeto: null, categoria: null, subpastas: [], destinoEquipamentos: "os", ordem: 95 },
  { ...PROJETO_BASE, chave: "doacao", rotulo: "Doação de Bens", raiz: "03 - PRODUTOS", termos: ["DOACAO"], fase: "base", modeloId: "m-doacao", nomeProjeto: "Doação de Bens", categoria: "Guias de Desoneração", subpastas: [[["BENS", "IMOVEIS"], ["DESONERACAO"]], [["BENS", "MOVEIS"], ["DESONERACAO"]]], ordem: 100 },
  { ...PROJETO_BASE, chave: "contratos", rotulo: "Contratos", raiz: "02 - FINANCEIRO", termos: ["PROPOSTA", "CONTRATO"], fase: "base", tipo: "grupo", grupo: "contratos", modeloId: null, nomeProjeto: null, categoria: null, subpastas: [[["ASSINAD*"]]], ordem: 110 },
  { ...PROJETO_BASE, chave: "orcamentos", rotulo: "Orçamentos de 3º", raiz: "02 - FINANCEIRO", termos: ["ORCAMENTO*", "3"], termosExcluir: ["MATERIAIS"], fase: "base", tipo: "grupo", grupo: "orcamentos", modeloId: null, nomeProjeto: null, categoria: null, subpastas: [], ordem: 120 },
];

const ARQUIVO_BASE = { ...PROJETO_BASE, tipo: "arquivo", fase: "base", raiz: "03 - PRODUTOS", modeloId: null, nomeProjeto: null, categoria: null, subpastas: [], dependeDe: null };
const NOVOS = [
  { ...PROJETO_BASE, chave: "per_ses", rotulo: "Projeto Elétrico Referência (PER) - SES", raiz: "03 - PRODUTOS", termos: ["PER", "SES"], termosExcluir: ["PEC"], fase: "complementar", modeloId: "m-per-ses", nomeProjeto: "Elevatória de Esgoto Bruto - PER - SES", categoria: "Projetos", subpastas: APROVADA, dependeDe: "ses", ordem: 45 },
  { ...PROJETO_BASE, chave: "pec_ses", rotulo: "Projeto Elétrico Construtivo (PEC) - SES", raiz: "03 - PRODUTOS", termos: ["PEC", "SES"], fase: "complementar", modeloId: "m-pec-ses", nomeProjeto: "Elevatória de Esgoto Bruto - PEC - SES", categoria: "Projetos", subpastas: APROVADA, dependeDe: "ses", ordem: 55 },
  { ...PROJETO_BASE, chave: "dt_ses", rotulo: "Descrição Topográfica - SES", raiz: "03 - PRODUTOS", termos: ["DESCRICAO", "TOPOGRAFICA", "SES"], fase: "complementar", modeloId: "m-dt-ses", nomeProjeto: "Descrição Topográfica Faixas de Servidão - SES", categoria: "Projetos", subpastas: APROVADA, dependeDe: "ses", ordem: 35 },
  { ...PROJETO_BASE, chave: "basico_ees", rotulo: "Básico da Elevatória de Esgoto - SES", raiz: "03 - PRODUTOS", termos: ["SES"], termosExcluir: EXCLUIR_DOS_SISTEMAS, fase: "complementar", modeloId: "m-basico", nomeProjeto: "Básico da Elevatória de Esgoto - SES", categoria: null, subpastas: [], dependeDe: "ses", criaRegras: false, ordem: 25 },
  { ...ARQUIVO_BASE, chave: "urbanistico", rotulo: "Projeto Urbanístico", termos: ["URBANISTICO"], ordem: 200 },
  { ...ARQUIVO_BASE, chave: "rede_aerea", rotulo: "Projeto de Rede Aérea", termos: ["REDE", "AEREA"], ordem: 210 },
  { ...ARQUIVO_BASE, chave: "telemetria", rotulo: "Projeto de Telemetria e Rádio", termos: ["TELEMETRIA|RADIO"], ordem: 220 },
  { ...ARQUIVO_BASE, chave: "drenagem", rotulo: "Projeto de Drenagem Pluvial", termos: ["DRENAGEM"], ordem: 230 },
  { ...ARQUIVO_BASE, chave: "terraplanagem", rotulo: "Projeto de Terraplanagem", termos: ["TERRAPLANAGEM|TERRAPLENAGEM"], ordem: 240 },
  { ...ARQUIVO_BASE, chave: "motobomba", rotulo: "Conjunto Motobomba", termos: ["MOTOBOMBA"], ordem: 250 },
  { ...ARQUIVO_BASE, chave: "executivos", rotulo: "Projetos Executivos", termos: ["EXECUTIVO*"], ordem: 260 },
];
const CATALOGO = [
  ...CATALOGO_SEED.map((alvo) => {
    if (["dt", "per", "pec"].includes(alvo.chave)) return { ...alvo, termosExcluir: [...alvo.termosExcluir, "SES"] };
    if (alvo.chave === "estrutural_elevatoria") return { ...alvo, modeloId: "m-est-ele" };
    return alvo;
  }),
  ...NOVOS,
];

const previa =(pastas, extra = {}) => montarPrevia({ pastas, catalogo: CATALOGO, projetos: [], regras: [], lerComplementares: true, ...extra });
const item = (montagem, chave, sistema = undefined) => montagem.itens.find((candidato) => candidato.chave === chave && (sistema === undefined || candidato.sistema === sistema));
const escolhidas = (montagem) => montagem.itens.flatMap((alvo) => alvo.slots.flatMap((slot) => (slot.escolhida ? [slot.escolhida] : [])));

// ---------------------------------------------------------------------------------------------------------------------
// 1. Normalização
// ---------------------------------------------------------------------------------------------------------------------
const NORMALIZACAO = [
  ["02 - P. - SAA (PROJETISTA A)", "P SAA"],
  ["02 - P.SAA ()", "P SAA"],
  ["02 - P. SAA (TP) OK", "P SAA"],
  ["03 - P. EEE - SES (PROJETISTA F)", "P EEE SES"],
  ["07 - PER  - SES (PROJETISTA B)", "PER SES"],
  ["14 - PLANO DE TRABLHO TERMO DE ACORDO", "PLANO DE TRABLHO TERMO DE ACORDO"],
  ["15 - ORDEM SERVIÇO", "ORDEM SERVICO"],
  ["19 - SIMOS E LAUDOS", "SIMOS E LAUDOS"],
  ["19 - PROJETO URBANÍSTICO", "PROJETO URBANISTICO"],
  ["06 - ORÇAMENTOS DE 3º", "ORCAMENTOS DE 3"],
  ["01  APROVADO NO INTERLIGA", "APROVADO NO INTERLIGA"],
  ["02 - LAN", "LAN"],
  ["00 - APROVADO NO NTERLIGA", "APROVADO NO NTERLIGA"],
  ["05 - PER - SAA (ANDRÉ", "PER SAA"],
  ["03 - CERTIDÃO DE DESONERAÇÃO", "CERTIDAO DE DESONERACAO"],
  ["  04   -   Descrição   Topográfica (PROJETISTA D) ", "DESCRICAO TOPOGRAFICA"],
  ["OK", "OK"],
  ["", ""],
];
for (const [bruto, esperado] of NORMALIZACAO) {
  conferir(`normalizarNome(${JSON.stringify(bruto)})`, () => assert.equal(normalizarNome(bruto), esperado));
}
conferir("NFD e NFC dão o mesmo nome", () => assert.equal(normalizarNome("15 - DOAÇÃO".normalize("NFD")), normalizarNome("15 - DOAÇÃO".normalize("NFC"))));

// ---------------------------------------------------------------------------------------------------------------------
// 2. Casos pequenos
// ---------------------------------------------------------------------------------------------------------------------
const P = "03 - PRODUTOS";
conferir("SAA com LAN/APROVADO", () => {
  const m = previa([P, `${P}/02 - P. - SAA (PROJETISTA A)`, `${P}/02 - P. - SAA (PROJETISTA A)/02 - LAN`, `${P}/02 - P. - SAA (PROJETISTA A)/02 - LAN/00 - APROVADO NO INTERLIGA`]);
  assert.equal(item(m, "saa").estado, "encontrado");
  assert.equal(item(m, "saa").slots[0].escolhida, `${P}/02 - P. - SAA (PROJETISTA A)/02 - LAN/00 - APROVADO NO INTERLIGA`);
  assert.equal(item(m, "saa").nomeProjeto, "Sistema de Abastecimento de Água - SAA");
});
conferir("árvore só com as pastas fundas: as de cima são deduzidas", () => {
  const m = previa([`${P}/02 - P.SAA/01  APROVADO NO INTERLIGA`]);
  assert.equal(item(m, "saa").slots[0].escolhida, `${P}/02 - P.SAA/01  APROVADO NO INTERLIGA`);
});
conferir("aprovada direto no projeto, em LAN e em PROJETOS", () => {
  for (const [pasta, esperada] of [
    [`${P}/02 - P SAA/01 - APROVADO`, `${P}/02 - P SAA/01 - APROVADO`],
    [`${P}/02 - P SAA/01 - PROJETOS/01 APROVADO NO INTERLIGA`, `${P}/02 - P SAA/01 - PROJETOS/01 APROVADO NO INTERLIGA`],
  ]) assert.equal(item(previa([pasta]), "saa").slots[0].escolhida, esperada);
});
conferir("duas aprovadas no mesmo nível = ambíguo, sem escolhida", () => {
  const m = previa([`${P}/02 - P SAA/01 - LAN/01 - APROVADO`, `${P}/02 - P SAA/02 - PROJETOS/01 - APROVADO`]);
  assert.equal(item(m, "saa").estado, "ambiguo");
  assert.equal(item(m, "saa").slots[0].estado, "ambigua");
  assert.equal(item(m, "saa").slots[0].escolhida, null);
  assert.equal(item(m, "saa").slots[0].candidatas.length, 2);
});
conferir("a mais rasa vence quando as profundidades diferem", () => {
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`, `${P}/02 - P SAA/02 - LAN/01 - APROVADO`]);
  assert.equal(item(m, "saa").slots[0].escolhida, `${P}/02 - P SAA/01 - APROVADO`);
  assert.equal(item(m, "saa").slots[0].candidatas.length, 2);
});
conferir("APROVADA (feminino) e TRABLHO", () => {
  const m = previa([`${P}/14 - ORDEM SERVIÇO/03 - OS - APROVADA`, `${P}/14 - PLANO DE TRABLHO TERMO DE ACORDO/03 - TERMO - APROVADO`]);
  assert.equal(item(m, "os").estado, "encontrado");
  assert.equal(item(m, "termo").estado, "encontrado");
});
conferir("pasta sem subpasta aprovada: projeto parcial, sem regra", () => {
  const m = previa([`${P}/02 - P SAA/01 - LAN`]);
  assert.equal(item(m, "saa").estado, "parcial");
  assert.equal(item(m, "saa").slots[0].estado, "ausente");
  assert.equal(item(m, "saa").marcado, true);
});
conferir("sem a pasta: ausente e sem checkbox", () => {
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`]);
  assert.equal(item(m, "ses").estado, "ausente");
  assert.equal(item(m, "ses").marcado, false);
});
conferir("SES: P. EEE - SES", () => {
  const m = previa([`${P}/03 - P. EEE - SES (PROJETISTA F)/01 - APROVADO`]);
  assert.equal(item(m, "ses").estado, "encontrado");
  assert.equal(item(m, "saa").estado, "ausente");
});
conferir("PER e PEC não viram SAA nem SES; PEC não casa com PER", () => {
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`, `${P}/05 - PER - SAA (PROJETISTA B)/01 - APROVADO`, `${P}/07 - PEC - SAA (PROJETISTA C)/01 - APROVADO`, `${P}/07 - PER  - SES (PROJETISTA B)/01 - APROVADO`]);
  assert.equal(item(m, "saa").pasta, `${P}/02 - P SAA`);
  assert.equal(item(m, "ses").estado, "ausente");
  assert.equal(item(m, "per", "SAA").paiChave, "saa");
  // PER - SES deixou de casar com o item per (que exclui SES): é do per_ses, que depende do SES e não leva sufixo no nome.
  assert.equal(m.itens.some((alvo) => alvo.chave === "per" && alvo.pasta !== null && alvo.sistema !== "SAA"), false);
  assert.equal(item(m, "per_ses").pasta, `${P}/07 - PER  - SES (PROJETISTA B)`);
  assert.equal(item(m, "per_ses").sistema, null);
  assert.equal(item(m, "per_ses").paiChave, "ses");
  assert.equal(item(m, "per_ses").precisaDe.existe, false);
  assert.equal(item(m, "per_ses").nomeProjeto, "Elevatória de Esgoto Bruto - PER - SES");
  assert.equal(item(m, "pec").sistema, "SAA");
});
conferir("PER, PEC e Descrição Topográfica do SES vão para os itens próprios; os do SAA continuam nos antigos", () => {
  const m = previa([
    `${P}/05 - PER - SAA/01 - APROVADO`, `${P}/06 - PEC - SAA/01 - APROVADO`, `${P}/04 - DESCRIÇÃO TOPOGRÁFICA (PROJETISTA D)/01 - APROVADO`,
    `${P}/07 - PER - SES/01 - APROVADO`, `${P}/08 - PEC - SES/01 - APROVADO`, `${P}/09 - DESCRIÇÃO TOPOGRÁFICA - SES/01 - APROVADO`,
  ]);
  const pastasDe = (chave) => m.itens.filter((alvo) => alvo.chave === chave && alvo.pasta !== null).map((alvo) => alvo.pasta);
  assert.deepEqual(pastasDe("per"), [`${P}/05 - PER - SAA`]);
  assert.deepEqual(pastasDe("pec"), [`${P}/06 - PEC - SAA`]);
  assert.deepEqual(pastasDe("dt"), [`${P}/04 - DESCRIÇÃO TOPOGRÁFICA (PROJETISTA D)`]);
  assert.deepEqual(pastasDe("per_ses"), [`${P}/07 - PER - SES`]);
  assert.deepEqual(pastasDe("pec_ses"), [`${P}/08 - PEC - SES`]);
  assert.deepEqual(pastasDe("dt_ses"), [`${P}/09 - DESCRIÇÃO TOPOGRÁFICA - SES`]);
  assert.deepEqual(pastasDe("ses"), [], "nenhuma delas é o projeto SES");
  assert.deepEqual(m.pastasDesconhecidas, []);
  for (const chave of ["per_ses", "pec_ses", "dt_ses"]) {
    const alvo = item(m, chave);
    assert.equal(alvo.paiChave, "ses", chave);
    assert.equal(alvo.sistema, null, chave);
    assert.equal(alvo.slots[0].estado, "encontrada", chave);
    assert.equal(alvo.nomeProjeto, NOVOS.find((novo) => novo.chave === chave).nomeProjeto, `${chave}: o nome não leva (SES)`);
  }
  assert.equal(item(m, "pec_ses").slots[0].escolhida, `${P}/08 - PEC - SES/01 - APROVADO`);
});
conferir("pasta de PEC - SES vai para o pec_ses e nunca para o per_ses (que exclui PEC)", () => {
  const m = previa([`${P}/08 - PEC - SES/01 - APROVADO`]);
  assert.equal(item(m, "per_ses").pasta, null);
  assert.equal(item(m, "pec_ses").pasta, `${P}/08 - PEC - SES`);
});
conferir("Básico da EEE: a pasta do SES casa com os dois itens, e o Básico é projeto sem regra", () => {
  const pasta = `${P}/03 - P. EEE - SES (PROJETISTA F)`;
  const aprovado = `${pasta}/02 - LAN/01 - APROVADO`;
  const m = previa([aprovado]);
  assert.equal(item(m, "ses").pasta, pasta);
  assert.equal(item(m, "ses").slots[0].escolhida, aprovado);
  const basico = item(m, "basico_ees");
  assert.equal(basico.pasta, pasta);
  assert.equal(basico.tipo, "projeto");
  assert.equal(basico.criaRegras, false);
  assert.equal(basico.estado, "encontrado");
  assert.equal(basico.marcado, true);
  assert.equal(basico.pendente, true);
  assert.deepEqual(basico.slots, []);
  assert.equal(basico.paiChave, "ses");
  assert.equal(basico.nomeProjeto, "Básico da Elevatória de Esgoto - SES");
  assert.deepEqual(m.pastasDesconhecidas, []);
  assert.equal(item(m, "ses").criaRegras, true);

  // Criar os dois: o Básico vai sem caminho e dependente do SES; o SES leva o APROVADO e as regras de etapa.
  const ok = resolverSelecao(m, [{ chave: "basico_ees", sistema: null, caminhos: [] }, { chave: "ses", sistema: null, caminhos: [] }]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.itens[0], { chave: "basico_ees", caminhos: [], projeto_pai_chave: "ses", nome_projeto: "Básico da Elevatória de Esgoto - SES" });
  assert.deepEqual(ok.itens[1].caminhos, [aprovado]);
  assert.deepEqual(ok.derivadas.filter((regra) => regra.nomeProjeto.startsWith("Básico")), [], "o Básico nunca ganha regra derivada");
  // Um caminho mandado para o Básico não é candidata de ninguém: recusado.
  assert.equal(resolverSelecao(m, [{ chave: "basico_ees", sistema: null, caminhos: [pasta] }, { chave: "ses", sistema: null, caminhos: [] }]).ok, false);
  // Sem o SES (nem marcado, nem existente), o Básico não pode ser criado.
  assert.equal(resolverSelecao(m, [{ chave: "basico_ees", sistema: null, caminhos: [] }]).ok, false);

  // SES já montado (projeto e regra): o Básico continua pendente e só ele sai para o banco.
  const comSes = previa([aprovado], {
    projetos: [{ id: "p-ses", nome: "Sistema de Esgotamento Sanitário - SES", modeloId: "m-ses" }],
    regras: [{ id: "r-ses", caminhoPrefixo: aprovado, ativa: true }],
  });
  assert.equal(item(comSes, "ses").projetoJaExiste, true);
  assert.equal(item(comSes, "ses").slots[0].jaCriada, true);
  assert.equal(item(comSes, "basico_ees").estado, "encontrado", "a regra do SES dentro da pasta não vale como regra do Básico");
  assert.equal(item(comSes, "basico_ees").precisaDe.existe, true);
  const soBasico = resolverSelecao(comSes, [{ chave: "basico_ees", sistema: null, caminhos: [] }]);
  assert.equal(soBasico.ok, true);
  assert.deepEqual(soBasico.itens, [{ chave: "basico_ees", caminhos: [], projeto_pai_chave: "ses", nome_projeto: "Básico da Elevatória de Esgoto - SES" }]);

  // Projeto do Básico já existe: nada a criar.
  const completo = previa([aprovado], {
    projetos: [{ id: "p-ses", nome: "Sistema de Esgotamento Sanitário - SES", modeloId: "m-ses" }, { id: "p-bas", nome: "Básico da Elevatória de Esgoto - SES", modeloId: "m-basico" }],
    regras: [{ id: "r-ses", caminhoPrefixo: aprovado, ativa: true }],
  });
  assert.equal(item(completo, "basico_ees").estado, "ja_criado");
  assert.equal(item(completo, "basico_ees").projetoJaExiste, true);
  assert.equal(item(completo, "basico_ees").marcado, false);
  assert.equal(resolverSelecao(completo, [{ chave: "basico_ees", sistema: null, caminhos: [] }]).ok, false);
});
conferir("Básico da EEE é complementar: some com a chave desligada, sem afetar o SES", () => {
  const m = previa([`${P}/03 - P. - SES/02 - LAN/01 - APROVADO`], { lerComplementares: false });
  assert.equal(item(m, "basico_ees"), undefined);
  assert.equal(item(m, "ses").estado, "encontrado");
});
conferir("sem a pasta do SES, o Básico fica ausente", () => {
  assert.equal(item(previa([`${P}/02 - P SAA/01 - APROVADO`]), "basico_ees").estado, "ausente");
});
conferir("pastas de arquivo viram regra de grupo: sem projeto, sem dependência e sem regras derivadas", () => {
  const pastas = {
    urbanistico: `${P}/19 - PROJETO URBANÍSTICO`, rede_aerea: `${P}/11 - REDE AÉREA`, telemetria: `${P}/21 - TELEMETRIA - RÁDIO`,
    drenagem: `${P}/12 - DRENAGEM`, terraplanagem: `${P}/13 - TERRAPLENAGEM`, motobomba: `${P}/20 - MOTOBOMBA`, executivos: `${P}/09 - EXECUTIVOS`,
  };
  const m = previa([...Object.values(pastas), `${pastas.executivos}/02 - LAN/01 - APROVADO`, `${pastas.drenagem}/02 - LAN/01 - APROVADO`]);
  for (const [chave, pasta] of Object.entries(pastas)) {
    const alvo = item(m, chave);
    assert.equal(alvo.tipo, "arquivo", chave);
    assert.equal(alvo.estado, "encontrado", chave);
    assert.equal(alvo.pasta, pasta, chave);
    assert.equal(alvo.nomeProjeto, null, chave);
    assert.equal(alvo.paiChave, null, chave);
    assert.equal(alvo.precisaDe, null, chave);
    assert.equal(alvo.slots.length, 1, chave);
    assert.equal(alvo.slots[0].escolhida, pasta, `${chave} usa a própria pasta, não a subpasta APROVADO`);
    assert.deepEqual(alvo.slots[0].derivadas, {}, chave);
    assert.equal(alvo.marcado, true, chave);
  }
  assert.deepEqual(m.pastasDesconhecidas, [], "as pastas de arquivo não são desconhecidas");
  assert.equal(m.itens.filter((alvo) => alvo.tipo === "projeto" && alvo.pasta !== null).length, 0, "nenhuma vira projeto");

  const ok = resolverSelecao(m, [{ chave: "urbanistico", sistema: null, caminhos: [] }, { chave: "executivos", sistema: null, caminhos: [] }]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.itens, [
    { chave: "urbanistico", caminhos: [pastas.urbanistico], projeto_pai_chave: null, nome_projeto: null },
    { chave: "executivos", caminhos: [pastas.executivos], projeto_pai_chave: null, nome_projeto: null },
  ]);
  assert.deepEqual(ok.derivadas, []);

  const jaTem = previa([pastas.urbanistico], { regras: [{ id: "r", caminhoPrefixo: pastas.urbanistico.toLowerCase(), ativa: true }] });
  assert.equal(item(jaTem, "urbanistico").estado, "ja_criado");
  assert.equal(resolverSelecao(jaTem, [{ chave: "urbanistico", sistema: null, caminhos: [] }]).ok, false);
});
conferir("pasta de arquivo ambígua pede a escolha, como qualquer grupo", () => {
  const m = previa([`${P}/12 - DRENAGEM`, `${P}/13 - DRENAGEM PLUVIAL`]);
  assert.equal(item(m, "drenagem").estado, "ambiguo");
  assert.equal(resolverSelecao(m, [{ chave: "drenagem", sistema: null, caminhos: [] }]).ok, false);
  const escolhida = resolverSelecao(m, [{ chave: "drenagem", sistema: null, caminhos: [`${P}/13 - DRENAGEM PLUVIAL`] }]);
  assert.equal(escolhida.ok, true);
  assert.deepEqual(escolhida.itens[0].caminhos, [`${P}/13 - DRENAGEM PLUVIAL`]);
});
conferir("regra órfã de pasta de arquivo sugere o caminho novo pelo mesmo item", () => {
  const m = previa([`${P}/12 - DRENAGEM`], { regras: [{ id: "r", caminhoPrefixo: `${P}/12 - DRENAGEM PLUVIAL`, ativa: true }] });
  assert.equal(m.orfas.length, 1);
  assert.equal(m.orfas[0].sugestao, `${P}/12 - DRENAGEM`);
  assert.equal(m.orfas[0].rotulo, "Projeto de Drenagem Pluvial");
});
conferir("complementar sem SAA nem SES no nome segue o SAA que existe", () => {
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`, `${P}/10 - PROJETO ESTRUTURAL RESERVATÓRIO (PROJETISTA E)/03 - LAN/01 - APROVADO`]);
  assert.equal(item(m, "estrutural_reservatorio").sistema, "SAA");
  assert.equal(item(m, "estrutural_reservatorio").paiChave, "saa");
  const semSaa = previa([`${P}/10 - PROJETO ESTRUTURAL RESERVATÓRIO (PROJETISTA E)/03 - LAN/01 - APROVADO`]);
  assert.equal(item(semSaa, "estrutural_reservatorio").sistema, null);
  assert.equal(item(semSaa, "estrutural_reservatorio").paiChave, null);
});
conferir("abreviações REL e EAT casam com os estruturais", () => {
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`, `${P}/10 - PROJETO ESTRUTURAL EAT - SAA (Danielly)/01 - APROVADO`, `${P}/11 - PROJETO ESTRUTURAL REL (PROJETISTA E)/01 - APROVADO`]);
  assert.equal(item(m, "estrutural_elevatoria").estado, "encontrado");
  assert.equal(item(m, "estrutural_reservatorio").estado, "encontrado");
});
conferir("SAA já criado no banco vale como projeto SAA", () => {
  const m = previa([`${P}/10 - PROJETO ESTRUTURAL RESERVATÓRIO/01 - APROVADO`], { projetos: [{ id: "p1", nome: "Água", modeloId: "m-saa" }] });
  assert.equal(item(m, "estrutural_reservatorio").paiChave, "saa");
  assert.equal(item(m, "estrutural_reservatorio").precisaDe.existe, true);
});
conferir("complementares ficam fora da lista com a chave desligada", () => {
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`, `${P}/05 - PER - SAA/01 - APROVADO`], { lerComplementares: false });
  assert.equal(item(m, "per"), undefined);
  assert.equal(m.itens.some((alvo) => alvo.fase === "complementar"), false);
  assert.deepEqual(m.pastasDesconhecidas, []);
});
conferir("o que o contrato deixa de fora nunca vira projeto nem aviso", () => {
  const nomes = ["19 - PROJETO URBANÍSTICO", "08 - DTB", "09 - EXECUTIVOS", "11 - REDE AÉREA", "12 - DRENAGEM", "13 - TERRAPLANAGEM", "20 - MOTOBOMBA", "21 - TELEMETRIA - RÁDIO", "22 - CONSULTORIA", "23 - ORÇAMENTO DE MATERIAIS", "24 - DECLARAÇÃO DE CUSTO", "25 - VRP"];
  const m = previa(nomes.map((nome) => `${P}/${nome}/01 - APROVADO`));
  assert.deepEqual(m.pastasDesconhecidas, []);
  assert.equal(m.itens.filter((alvo) => alvo.tipo === "projeto" && alvo.pasta !== null).length, 0);
});
conferir("pasta desconhecida em PRODUTOS vira aviso", () => {
  const m = previa([`${P}/30 - PASTA NOVA DA EMPRESA`, `${P}/02 - P SAA/01 - APROVADO`]);
  assert.deepEqual(m.pastasDesconhecidas, [`${P}/30 - PASTA NOVA DA EMPRESA`]);
});
conferir("números repetidos: 19 - URBANÍSTICO e 19 - SIMOS E LAUDOS", () => {
  const m = previa([`${P}/19 - PROJETO URBANÍSTICO`, `${P}/19 - SIMOS E LAUDOS`, `${P}/14 - ORDEM DE SERVIÇO/03 - OS - APROVADA`]);
  assert.equal(item(m, "simos").slots[0].escolhida, `${P}/19 - SIMOS E LAUDOS`);
  assert.equal(item(m, "simos").precisaDe.chave, "os");
});
conferir("SIMOS sem projeto da Ordem de Serviço fica indisponível", () => {
  const m = previa([`${P}/18 - SIMOS E LAUDOS`]);
  assert.equal(item(m, "simos").estado, "indisponivel");
});
conferir("Doação: duas subpastas, uma em cada slot; falta uma = parcial", () => {
  const completa = previa([`${P}/15 - DOAÇÃO - BENS/01 - BENS IMÓVEIS/03 - CERTIDÃO DE DESONERAÇÃO`, `${P}/15 - DOAÇÃO - BENS/02 - BENS MÓVEIS/03 - CERTIDÃO DE DESONERAÇÃO`]);
  assert.equal(item(completa, "doacao").estado, "encontrado");
  assert.equal(item(completa, "doacao").slots.length, 2);
  const parcial = previa([`${P}/15 - DOAÇÃO - BENS/01 - BENS IMÓVEIS/03 - CERTIDÃO DE DESONERAÇÃO`]);
  assert.equal(item(parcial, "doacao").estado, "parcial");
});
conferir("grupos do financeiro", () => {
  const m = previa(["02 - FINANCEIRO/01 - PROPOSTA E CONTRATO/01 - ASSINADOS", "02 - FINANCEIRO/06 - ORÇAMENTOS DE 3º", "02 - FINANCEIRO/07 - ORÇAMENTO DE MATERIAIS"]);
  assert.equal(item(m, "contratos").slots[0].escolhida, "02 - FINANCEIRO/01 - PROPOSTA E CONTRATO/01 - ASSINADOS");
  assert.equal(item(m, "orcamentos").slots[0].escolhida, "02 - FINANCEIRO/06 - ORÇAMENTOS DE 3º");
  assert.deepEqual(m.pastasDesconhecidas, []);
});
conferir("pasta bloqueada nunca vira regra", () => {
  const m = previa([`${P}/02 - P SAA/01 - APROVADO/NOTAS FISCAIS`, `${P}/02 - P SAA/01 - APROVADO`, `${P}/02 - P SAA/02 - APROVADO COMPROVANTE`, "02 - FINANCEIRO/01 - PROPOSTA E CONTRATO/01 - ASSINADOS/DADOS DO EMPREENDEDOR"]);
  for (const caminho of escolhidas(m)) assert.equal(caminhoBloqueado(caminho), false, caminho);
  assert.equal(item(m, "saa").slots[0].escolhida, `${P}/02 - P SAA/01 - APROVADO`);
});
conferir("caminho longo demais não vira regra", () => {
  const longa = `${P}/02 - P SAA/01 - APROVADO ${"X".repeat(520)}`;
  assert.equal(item(previa([longa]), "saa").slots[0].estado, "ausente");
});
conferir("caminho fora da árvore, barra invertida e segmentos inválidos são ignorados", () => {
  const m = previa(["C:\\Servidor\\03 - PRODUTOS\\02 - P SAA\\01 - APROVADO", `/${P}/02 - P SAA/01 - APROVADO`, `${P}/../02 - P SAA/01 - APROVADO`, `${P}//02 - P SAA/01 - APROVADO`]);
  assert.equal(item(m, "saa").estado, "ausente");
});

// Já criado, regra existente e projeto de outro modelo.
conferir("projeto e regra existentes = já criado, sem nada pendente", () => {
  const pastas = [`${P}/02 - P SAA/01 - APROVADO`];
  const m = previa(pastas, {
    projetos: [{ id: "p1", nome: "Sistema de Abastecimento de Água - SAA", modeloId: "m-saa" }],
    regras: [{ id: "r1", caminhoPrefixo: `${P.toLowerCase()}/02 - p saa/01 - aprovado`, ativa: true }],
  });
  assert.equal(item(m, "saa").estado, "ja_criado");
  assert.equal(item(m, "saa").pendente, false);
  assert.equal(item(m, "saa").marcado, false);
});
conferir("projeto existe sem a regra: só a regra fica pendente", () => {
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`], { projetos: [{ id: "p1", nome: "Sistema de Abastecimento de Água - SAA", modeloId: "m-saa" }] });
  assert.equal(item(m, "saa").projetoJaExiste, true);
  assert.equal(item(m, "saa").estado, "encontrado");
});
conferir("um só projeto do modelo, com outro nome, é reaproveitado", () => {
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`], { projetos: [{ id: "p1", nome: "Água do bairro", modeloId: "m-saa" }] });
  assert.equal(item(m, "saa").nomeProjeto, "Água do bairro");
  assert.equal(item(m, "saa").projetoJaExiste, true);
});
conferir("nome igual com outro modelo é conflito", () => {
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`], { projetos: [{ id: "p1", nome: "Sistema de Abastecimento de Água - SAA", modeloId: "m-outro" }] });
  assert.equal(item(m, "saa").estado, "indisponivel");
});

// Regras órfãs.
conferir("regra órfã sugere o caminho novo pelo mesmo item (SIMOS 18 -> 19)", () => {
  const m = previa([`${P}/19 - SIMOS E LAUDOS`, `${P}/14 - ORDEM DE SERVIÇO/03 - OS - APROVADA`], {
    regras: [{ id: "r-simos", caminhoPrefixo: `${P}/18 - SIMOS E LAUDOS`, ativa: true }, { id: "r-inativa", caminhoPrefixo: `${P}/17 - ANTIGA`, ativa: false }],
  });
  assert.equal(m.orfas.length, 1);
  assert.equal(m.orfas[0].regraId, "r-simos");
  assert.equal(m.orfas[0].sugestao, `${P}/19 - SIMOS E LAUDOS`);
});
conferir("pasta com regras nas subpastas (PEC) conta como já configurada e não vem marcada", () => {
  const base = `${P}/07 - PEC - SAA (PROJETISTA C)/02 - LAN/01 - APROVADO NO INTERLIGA`;
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`, `${base}/pj automação`, `${base}/pj construtivo (1)`], {
    projetos: [{ id: "p1", nome: "Sistema de Abastecimento de Água - SAA", modeloId: "m-saa" }, { id: "p2", nome: "Projeto Elétrico Construtivo - PEC", modeloId: "m-pec" }],
    regras: [{ id: "a", caminhoPrefixo: `${base}/pj automação`, ativa: true }, { id: "b", caminhoPrefixo: `${base}/pj construtivo (1)`, ativa: true }],
  });
  const pec = m.itens.find((i) => i.chave === "pec");
  assert.ok(pec);
  assert.equal(pec.slots[0].jaCriada, true);
  assert.equal(pec.marcado, false);
});
conferir("regra órfã não sugere pasta que já tem regra ativa (evita duas regras na mesma pasta)", () => {
  const m = previa([`${P}/19 - SIMOS E LAUDOS`], {
    regras: [{ id: "r-antiga", caminhoPrefixo: `${P}/18 - SIMOS E LAUDOS/01 - PAINÉIS/2 - LAUDOS`, ativa: true }, { id: "r-nova", caminhoPrefixo: `${P}/19 - SIMOS E LAUDOS`, ativa: true }],
  });
  assert.equal(m.orfas.length, 1);
  assert.equal(m.orfas[0].regraId, "r-antiga");
  assert.equal(m.orfas[0].sugestao, null);
});
conferir("regra órfã sem pasta correspondente fica sem sugestão", () => {
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`], { regras: [{ id: "r1", caminhoPrefixo: "99 - OUTRA/COISA", ativa: true }] });
  assert.equal(m.orfas.length, 1);
  assert.equal(m.orfas[0].sugestao, null);
});
conferir("regra de pasta que ainda existe não é órfã", () => {
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`], { regras: [{ id: "r1", caminhoPrefixo: `${P}/02 - P SAA/01 - APROVADO`, ativa: true }] });
  assert.equal(m.orfas.length, 0);
});

// Seleção: o corpo só escolhe entre candidatas.
conferir("seleção devolve o que o banco recebe e recusa caminho fora das candidatas", () => {
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`, `${P}/05 - PER - SAA/01 - APROVADO`]);
  const ok = resolverSelecao(m, [{ chave: "saa", sistema: null, caminhos: [] }, { chave: "per", sistema: "SAA", caminhos: [] }]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.itens[0], { chave: "saa", caminhos: [`${P}/02 - P SAA/01 - APROVADO`], projeto_pai_chave: null, nome_projeto: "Sistema de Abastecimento de Água - SAA" });
  assert.equal(ok.itens[1].projeto_pai_chave, "saa");
  const invasor = resolverSelecao(m, [{ chave: "saa", sistema: null, caminhos: ["03 - PRODUTOS/QUALQUER COISA"] }]);
  assert.equal(invasor.ok, false);
  const bloqueado = resolverSelecao(m, [{ chave: "saa", sistema: null, caminhos: [`${P}/02 - P SAA/01 - APROVADO/NOTAS FISCAIS`] }]);
  assert.equal(bloqueado.ok, false);
});
conferir("seleção exige escolha no ambíguo, recusa repetido, ausente e já criado", () => {
  const m = previa([`${P}/02 - P SAA/01 - LAN/01 - APROVADO`, `${P}/02 - P SAA/02 - PROJETOS/01 - APROVADO`]);
  assert.equal(resolverSelecao(m, [{ chave: "saa", sistema: null, caminhos: [] }]).ok, false);
  const escolhido = resolverSelecao(m, [{ chave: "saa", sistema: null, caminhos: [`${P}/02 - P SAA/02 - PROJETOS/01 - APROVADO`] }]);
  assert.equal(escolhido.ok, true);
  assert.deepEqual(escolhido.itens[0].caminhos, [`${P}/02 - P SAA/02 - PROJETOS/01 - APROVADO`]);
  assert.equal(resolverSelecao(m, [{ chave: "ses", sistema: null, caminhos: [] }]).ok, false);
  const repetido = resolverSelecao(m, [escolhido.itens[0], escolhido.itens[0]].map((i) => ({ chave: i.chave, sistema: null, caminhos: i.caminhos })));
  assert.equal(repetido.ok, false);
  const criado = previa([`${P}/02 - P SAA/01 - APROVADO`], {
    projetos: [{ id: "p1", nome: "Sistema de Abastecimento de Água - SAA", modeloId: "m-saa" }],
    regras: [{ id: "r1", caminhoPrefixo: `${P}/02 - P SAA/01 - APROVADO`, ativa: true }],
  });
  assert.equal(resolverSelecao(criado, [{ chave: "saa", sistema: null, caminhos: [] }]).ok, false);
  assert.equal(resolverSelecao(m, []).ok, false);
});
conferir("seleção: dependente sem o pai marcado e sem projeto existente é recusado", () => {
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`, `${P}/05 - PER - SAA/01 - APROVADO`]);
  assert.equal(resolverSelecao(m, [{ chave: "per", sistema: "SAA", caminhos: [] }]).ok, false);
  const comProjeto = previa([`${P}/02 - P SAA/01 - APROVADO`, `${P}/05 - PER - SAA/01 - APROVADO`], { projetos: [{ id: "p1", nome: "Água", modeloId: "m-saa" }] });
  assert.equal(resolverSelecao(comProjeto, [{ chave: "per", sistema: "SAA", caminhos: [] }]).ok, true);
});
conferir("seleção não alcança complementar com a chave desligada", () => {
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`, `${P}/05 - PER - SAA/01 - APROVADO`], { lerComplementares: false });
  assert.equal(resolverSelecao(m, [{ chave: "per", sistema: "SAA", caminhos: [] }]).ok, false);
});

// Regras que marcam etapa, derivadas da pasta LAN do APROVADO: devolutivas na LAN e protocolos na pasta PROJETO(S) irmã.
const SAA_PASTA = `${P}/02 - P SAA`;
const APROVADO_LAN = `${SAA_PASTA}/02 - LAN/01 - APROVADO NO INTERLIGA`;
const derivadasDe = (alvo, caminho = alvo.slots[0].escolhida) => alvo.slots[0].derivadas[caminho] ?? [];
const resumoDeDerivadas = (lista) => lista.map((regra) => `${regra.tipo}:${regra.caminho}:${regra.jaCriada}`).sort();

conferir("LAN + PROJETOS irmã: sugere devolutivas na LAN e protocolos em PROJETOS", () => {
  const m = previa([`${SAA_PASTA}/01 - PROJETOS/01 - PROTOCOLO (1)`, APROVADO_LAN]);
  assert.equal(item(m, "saa").slots[0].escolhida, APROVADO_LAN);
  assert.deepEqual(resumoDeDerivadas(derivadasDe(item(m, "saa"))), [`devolutivas:${SAA_PASTA}/02 - LAN:false`, `protocolos:${SAA_PASTA}/01 - PROJETOS:false`]);
  assert.deepEqual(derivadasDe(item(m, "saa")).map((regra) => regra.rotulo).sort(), ["Devolutivas da Copasa", "Protocolos"]);
});
conferir("PROJETO no singular também é a pasta irmã; sem ela só vem a devolutiva", () => {
  const singular = previa([`${SAA_PASTA}/01 - PROJETO`, APROVADO_LAN]);
  assert.deepEqual(derivadasDe(item(singular, "saa")).map((regra) => regra.tipo).sort(), ["devolutivas", "protocolos"]);
  const semIrma = previa([APROVADO_LAN]);
  assert.deepEqual(derivadasDe(item(semIrma, "saa")).map((regra) => regra.tipo), ["devolutivas"]);
});
conferir("duas pastas PROJETO(S) = ambíguo: nenhuma regra de protocolos", () => {
  const m = previa([`${SAA_PASTA}/01 - PROJETOS`, `${SAA_PASTA}/03 - PROJETO`, APROVADO_LAN]);
  assert.deepEqual(derivadasDe(item(m, "saa")).map((regra) => regra.tipo), ["devolutivas"]);
});
conferir("sem LAN no caminho (APROVADO direto ou dentro de PROJETOS) não há regra derivada", () => {
  for (const pasta of [`${SAA_PASTA}/01 - APROVADO`, `${SAA_PASTA}/01 - PROJETOS/01 APROVADO NO INTERLIGA`]) {
    const m = previa([pasta, `${SAA_PASTA}/01 - PROJETOS/01 - PROTOCOLO (1)`]);
    assert.equal(item(m, "saa").slots[0].escolhida, pasta);
    assert.deepEqual(derivadasDe(item(m, "saa")), [], pasta);
  }
});
conferir("só a LAN, sem pasta aprovada, não gera regra derivada", () => {
  const m = previa([`${SAA_PASTA}/02 - LAN`]);
  assert.deepEqual(m.itens.flatMap((alvo) => alvo.slots.flatMap((slot) => Object.values(slot.derivadas).flat())), []);
});
conferir("grupos e equipamentos nunca derivam regras", () => {
  const m = previa(["02 - FINANCEIRO/01 - PROPOSTA E CONTRATO/02 - LAN/01 - ASSINADOS", `${P}/14 - ORDEM DE SERVIÇO/03 - OS - APROVADA`, `${P}/19 - SIMOS E LAUDOS/02 - LAN/x`]);
  for (const chave of ["contratos", "simos"]) for (const slot of item(m, chave).slots) assert.deepEqual(slot.derivadas, {}, chave);
});
conferir("derivada que já tem regra vem como já criada; o item só fica pendente se faltar alguma", () => {
  const pastas = [`${SAA_PASTA}/01 - PROJETOS/01 - PROTOCOLO (1)`, APROVADO_LAN];
  const projetos = [{ id: "p1", nome: "Sistema de Abastecimento de Água - SAA", modeloId: "m-saa" }];
  const soAprovado = previa(pastas, { projetos, regras: [{ id: "r1", caminhoPrefixo: APROVADO_LAN, ativa: true }] });
  assert.equal(item(soAprovado, "saa").slots[0].jaCriada, true);
  assert.equal(item(soAprovado, "saa").pendente, true, "falta devolutivas e protocolos");
  assert.equal(item(soAprovado, "saa").estado, "encontrado");
  assert.equal(item(soAprovado, "saa").marcado, true);
  const completo = previa(pastas, {
    projetos,
    regras: [
      { id: "r1", caminhoPrefixo: APROVADO_LAN, ativa: true },
      { id: "r2", caminhoPrefixo: `${SAA_PASTA}/02 - LAN`.toLowerCase(), ativa: true },
      { id: "r3", caminhoPrefixo: `${SAA_PASTA}/01 - PROJETOS`, ativa: false },
    ],
  });
  assert.deepEqual(resumoDeDerivadas(derivadasDe(item(completo, "saa"))), [`devolutivas:${SAA_PASTA}/02 - LAN:true`, `protocolos:${SAA_PASTA}/01 - PROJETOS:true`]);
  assert.equal(item(completo, "saa").pendente, false);
  assert.equal(item(completo, "saa").estado, "ja_criado");
});
conferir("pasta configurada à mão só pelas subpastas (PEC) não ganha regras em volta", () => {
  const base = `${P}/07 - PEC - SAA (PROJETISTA C)/02 - LAN/01 - APROVADO NO INTERLIGA`;
  const m = previa([`${P}/02 - P SAA/01 - APROVADO`, `${P}/07 - PEC - SAA (PROJETISTA C)/01 - PROJETOS`, `${base}/pj automação`, `${base}/pj construtivo (1)`], {
    projetos: [{ id: "p1", nome: "Sistema de Abastecimento de Água - SAA", modeloId: "m-saa" }, { id: "p2", nome: "Projeto Elétrico Construtivo - PEC", modeloId: "m-pec" }],
    regras: [{ id: "a", caminhoPrefixo: `${base}/pj automação`, ativa: true }, { id: "b", caminhoPrefixo: `${base}/pj construtivo (1)`, ativa: true }],
  });
  assert.deepEqual(item(m, "pec").slots[0].derivadas, {});
  assert.equal(item(m, "pec").marcado, false);
});
conferir("seleção devolve as regras derivadas do que foi escolhido, sem repetir e sem as que já existem", () => {
  const m = previa([`${SAA_PASTA}/01 - PROJETOS`, APROVADO_LAN]);
  const ok = resolverSelecao(m, [{ chave: "saa", sistema: null, caminhos: [] }]);
  assert.equal(ok.ok, true);
  const nome = "Sistema de Abastecimento de Água - SAA";
  assert.deepEqual(ok.derivadas.map((regra) => `${regra.nomeProjeto}|${regra.tipo}|${regra.caminho}`).sort(), [`${nome}|devolutivas|${SAA_PASTA}/02 - LAN`, `${nome}|protocolos|${SAA_PASTA}/01 - PROJETOS`]);
  assert.deepEqual(ok.itens[0], { chave: "saa", caminhos: [APROVADO_LAN], projeto_pai_chave: null, nome_projeto: nome }, "o que vai para a função do banco não muda");

  const existente = previa([`${SAA_PASTA}/01 - PROJETOS`, APROVADO_LAN], {
    projetos: [{ id: "p1", nome: "Água do bairro", modeloId: "m-saa" }],
    regras: [{ id: "r1", caminhoPrefixo: APROVADO_LAN, ativa: true }, { id: "r2", caminhoPrefixo: `${SAA_PASTA}/02 - LAN`, ativa: true }],
  });
  const soProtocolos = resolverSelecao(existente, [{ chave: "saa", sistema: null, caminhos: [] }]);
  assert.equal(soProtocolos.ok, true);
  assert.deepEqual(soProtocolos.itens[0].caminhos, [], "o APROVADO já tem regra");
  assert.deepEqual(soProtocolos.derivadas, [{ nomeProjeto: "Água do bairro", tipo: "protocolos", caminho: `${SAA_PASTA}/01 - PROJETOS` }]);
});
conferir("subpasta ambígua: as regras derivadas seguem a candidata escolhida", () => {
  const outraLan = `${SAA_PASTA}/03 - LAN/01 - APROVADO`;
  const m = previa([APROVADO_LAN, outraLan, `${SAA_PASTA}/01 - PROJETOS`]);
  assert.equal(item(m, "saa").slots[0].estado, "ambigua");
  const escolhida = resolverSelecao(m, [{ chave: "saa", sistema: null, caminhos: [outraLan] }]);
  assert.equal(escolhida.ok, true);
  assert.deepEqual(escolhida.derivadas.filter((regra) => regra.tipo === "devolutivas").map((regra) => regra.caminho), [`${SAA_PASTA}/03 - LAN`]);
});
conferir("pastas ignoradas (99 - OUTROS / antigos) nunca viram regra derivada", () => {
  const m = previa([`${P}/02 - P SAA ANTIGO/02 - LAN/01 - APROVADO`, `${P}/02 - P SAA ANTIGO/99 - OUTROS`]);
  assert.deepEqual(m.itens.flatMap((alvo) => alvo.slots.flatMap((slot) => Object.values(slot.derivadas).flat())), []);
});
conferir("regrasOrfasDaArvore usa o mesmo critério da prévia (ativa e fora da árvore)", () => {
  const pastas = [`${P}/19 - SIMOS E LAUDOS`, `${P}/14 - ORDEM DE SERVIÇO/03 - OS - APROVADA`];
  const regras = [
    { id: "ok", caminhoPrefixo: `${P}/19 - SIMOS E LAUDOS`.toUpperCase(), ativa: true },
    { id: "ok-pai", caminhoPrefixo: `${P}/14 - ORDEM DE SERVIÇO`, ativa: true },
    { id: "orfa", caminhoPrefixo: `${P}/18 - SIMOS E LAUDOS`, ativa: true },
    { id: "inativa", caminhoPrefixo: `${P}/17 - ANTIGA`, ativa: false },
  ];
  assert.deepEqual(regrasOrfasDaArvore(pastas, regras).map((regra) => regra.id), ["orfa"]);
  assert.deepEqual(previa(pastas, { regras }).orfas.map((orfa) => orfa.regraId), ["orfa"]);
  assert.deepEqual(regrasOrfasDaArvore([], regras).map((regra) => regra.id), ["ok", "ok-pai", "orfa"]);
});

// Aviso "pronto para ler os complementares".
conferir("prontoParaComplementares", () => {
  const saa = { id: "p1", nome: "SAA", modeloId: "m-saa", etapaAtualNome: "Projeto Aprovado no Interliga" };
  assert.equal(prontoParaComplementares([saa], CATALOGO), true);
  assert.equal(prontoParaComplementares([{ ...saa, etapaAtualNome: "Em análise" }], CATALOGO), false);
  assert.equal(prontoParaComplementares([{ ...saa, modeloId: "m-per" }], CATALOGO), false);
  assert.equal(prontoParaComplementares([{ ...saa, modeloId: "m-ses", etapaAtualNome: "APROVADA" }], CATALOGO), true);
  assert.equal(prontoParaComplementares([{ ...saa, etapaAtualNome: null }], CATALOGO), false);
});

// O catálogo deste script tem de continuar igual ao seed da migration.
conferir("catálogo do teste = seed da migration", () => {
  const sql = readFileSync(resolve(raiz, "supabase/migrations/20261111100000_modelo_pastas.sql"), "utf8");
  const seed = sql.slice(sql.indexOf("insert into public.catalogo_pastas"), sql.indexOf("-- 4. empreendimentos.ler_complementares"));
  for (const alvo of CATALOGO_SEED) {
    const linha = seed.split("\n").findIndex((texto) => texto.trim().startsWith(`('${alvo.chave}',`));
    assert.notEqual(linha, -1, `seed sem a chave ${alvo.chave}`);
    const bloco = seed.split("\n").slice(linha, linha + 4).join(" ");
    const lista = (termos) => `array[${termos.map((termo) => `'${termo}'`).join(", ")}]`;
    assert.ok(bloco.includes(lista(alvo.termos)), `termos de ${alvo.chave} diferem do seed`);
    assert.ok(bloco.includes(lista(alvo.termosExcluir)), `termos_excluir de ${alvo.chave} diferem do seed`);
    assert.ok(bloco.includes(`'${alvo.fase}', '${alvo.tipo}'`), `fase/tipo de ${alvo.chave} diferem do seed`);
    assert.ok(bloco.includes(`'${JSON.stringify(alvo.subpastas).replace(/","/g, '", "').replace(/\],\[/g, "], [")}'`), `subpastas de ${alvo.chave} diferem do seed`);
    assert.ok(bloco.includes(`, ${alvo.ordem}),`) || bloco.includes(`, ${alvo.ordem})`), `ordem de ${alvo.chave} difere do seed`);
  }
});
conferir("catálogo do teste = migration 20261113100000 (itens novos e SES excluído de PER/PEC/DT)", () => {
  const sql = readFileSync(resolve(raiz, "supabase/migrations/20261113100000_pastas_ses_arquivo.sql"), "utf8");
  const linhas = sql.slice(sql.indexOf("insert into public.catalogo_pastas"), sql.indexOf("-- 2. pasta_regras: grupo 'arquivo' e rotulo")).split("\n");
  const lista = (termos) => `array[${termos.map((termo) => `'${termo}'`).join(", ")}]`;
  const subpastas = (valor) => `'${JSON.stringify(valor).replace(/","/g, '", "').replace(/\],\[/g, "], [")}'`;
  for (const alvo of NOVOS) {
    const inicio = linhas.findIndex((texto) => texto.trim().startsWith(`('${alvo.chave}',`));
    assert.notEqual(inicio, -1, `migration sem a chave ${alvo.chave}`);
    let fim = inicio + 1;
    while (fim < linhas.length && !linhas[fim].trim().startsWith("('") && !linhas[fim].trim().startsWith(") as v")) fim += 1;
    const bloco = linhas.slice(inicio, fim).join(" ");
    assert.ok(bloco.includes(`'${alvo.rotulo}'`), `rótulo de ${alvo.chave} difere da migration`);
    assert.ok(bloco.includes(lista(alvo.termos)), `termos de ${alvo.chave} diferem da migration`);
    // O Básico copia os termos_excluir do item ses na hora; a cópia fixa fica como reserva dentro do coalesce.
    assert.ok(bloco.includes(lista(alvo.termosExcluir)), `termos_excluir de ${alvo.chave} diferem da migration`);
    assert.ok(bloco.includes(`'${alvo.fase}', '${alvo.tipo}'`), `fase/tipo de ${alvo.chave} diferem da migration`);
    assert.ok(bloco.includes(subpastas(alvo.subpastas)), `subpastas de ${alvo.chave} diferem da migration`);
    assert.ok(bloco.includes(`, ${alvo.ordem}, ${alvo.criaRegras})`), `ordem/cria_regras de ${alvo.chave} diferem da migration`);
    if (alvo.nomeProjeto !== null) assert.ok(bloco.includes(`'${alvo.nomeProjeto}', '${alvo.nomeProjeto}'`) || bloco.includes(`'${alvo.nomeProjeto}',`), `nome do projeto de ${alvo.chave} difere da migration`);
    if (alvo.dependeDe !== null) assert.ok(bloco.includes(`'${alvo.dependeDe}', ${alvo.ordem}`), `depende_de de ${alvo.chave} difere da migration`);
  }
  assert.ok(sql.includes("where chave in ('per', 'pec', 'dt')"), "a migration não atualiza per, pec e dt");
  assert.ok(sql.includes("termos_excluir || array['SES']::text[]"), "a migration não acrescenta SES aos termos_excluir");
  assert.ok(sql.includes("'Projeto Estrutural da Elevatória'"), "a migration não cria o modelo do estrutural da elevatória");
});

// ---------------------------------------------------------------------------------------------------------------------
// 3. Árvores reais
// ---------------------------------------------------------------------------------------------------------------------
const ARQUIVO = resolve(raiz, "scripts/fixtures/arvores-servidor.json");
const VISTA_LINDA = [
  "03 - PRODUTOS/02 - P. - SAA (PROJETISTA A)/02 - LAN/00 - APROVADO NO INTERLIGA",
  "03 - PRODUTOS/04 - DESCRIÇÃO TOPOGRÁFICA (PROJETISTA D)/02 - LAN/01 - APROVADO NO INTERLIGA",
  "03 - PRODUTOS/05 - PER - SAA (PROJETISTA B)/02 - LAN/01 - APROVADO NO NTERLIGA",
  "03 - PRODUTOS/07 - PEC - SAA (PROJETISTA C)/02 - LAN/01 - APROVADO NO INTERLIGA",
  "03 - PRODUTOS/10 - PROJETO ESTRUTURAL RESERVATÓRIO (PROJETISTA E)/03 - LAN/01 - APROVADO NO INTERLIGA",
  "03 - PRODUTOS/13 - TERMO DE ACORDO E PLANO DE TRABALHO/03 - TERMO DE ACORDO E PLANO DE TRABALHO - APROVADO",
  "03 - PRODUTOS/14 - ORDEM DE SERVIÇO/03 - ORDEM DE SERVIÇO - APROVADA",
  "03 - PRODUTOS/15 - DOAÇÃO - BENS/01 - BENS IMÓVEIS/03 - CERTIDÃO DE DESONERAÇÃO",
  "03 - PRODUTOS/15 - DOAÇÃO - BENS/02 - BENS MÓVEIS/03 - CERTIDÃO DE DESONERAÇÃO",
  "03 - PRODUTOS/19 - SIMOS E LAUDOS",
  "02 - FINANCEIRO/01 - PROPOSTA E CONTRATO/01 - ASSINADOS",
  "02 - FINANCEIRO/06 - ORÇAMENTOS DE 3º",
];

function extrairPastas(valor, profundidade = 0) {
  if (Array.isArray(valor) && valor.every((texto) => typeof texto === "string")) return valor;
  if (valor && typeof valor === "object" && profundidade < 3) {
    for (const filho of Object.values(valor)) {
      const achadas = extrairPastas(filho, profundidade + 1);
      if (achadas) return achadas;
    }
  }
  return null;
}

function carregarEmpreendimentos() {
  const json = JSON.parse(readFileSync(ARQUIVO, "utf8"));
  const entradas = Array.isArray(json)
    ? json.map((elemento, indice) => [String(elemento?.chave ?? elemento?.id ?? elemento?.slug ?? elemento?.nome ?? indice), elemento])
    : Object.entries(json);
  return entradas.flatMap(([chave, valor]) => {
    const pastas = extrairPastas(valor);
    return pastas ? [[chave, pastas.map((pasta) => pasta.normalize("NFC"))]] : [];
  });
}

const SAA_REAL = /^\s*\d+\s*-?\s*P\.?\s*-?\s*SAA/i;
const SES_REAL = /^\s*\d+\s*-?\s*P\.?\s*(?:EEE\s*)?-?\s*SES/i;
const FORA_DO_CONTRATO = /URBAN[IÍ]STIC|\bDTB\b|EXECUTIV|REDE\s+A[EÉ]REA|DRENAGEM|TERRAPLANAGEM|MOTOBOMBA|TELEMETRIA/i;

if (!existsSync(ARQUIVO)) {
  console.log("(árvores reais ausentes: conferência com o servidor pulada; os dados reais não ficam no repositório)");
} else {
  const empreendimentos = carregarEmpreendimentos();
  conferir("o fixture traz 15 empreendimentos", () => assert.equal(empreendimentos.length, 15));

  const vista = empreendimentos.find(([chave]) => chave === "emp09-vista-linda");
  conferir("o fixture tem emp09-vista-linda", () => assert.ok(vista, "chave emp09-vista-linda ausente"));
  if (vista) {
    conferir("Vista Linda: base + complementares dão exatamente os caminhos do exemplo real", () => {
      const m = previa(vista[1]);
      // As pastas de arquivo (Urbanístico, Rede Aérea...) são regras novas, fora do exemplo real de 12 caminhos.
      const semArquivo = { ...m, itens: m.itens.filter((candidato) => candidato.tipo !== "arquivo") };
      const obtidos = escolhidas(semArquivo).map((caminho) => caminho.normalize("NFC")).sort();
      const esperados = VISTA_LINDA.map((caminho) => caminho.normalize("NFC")).sort();
      assert.deepEqual(obtidos, esperados);
      for (const alvo of semArquivo.itens.filter((candidato) => candidato.pasta !== null)) assert.ok(["encontrado", "parcial", "ja_criado"].includes(alvo.estado), `${alvo.id}: ${alvo.estado}`);
      for (const chave of ["dt", "per", "pec", "estrutural_reservatorio"]) assert.equal(item(m, chave).paiChave, "saa", `${chave} depende do SAA`);
      assert.equal(item(m, "simos").precisaDe.chave, "os");
      assert.equal(item(m, "doacao").slots.length, 2);
    });
    conferir("Vista Linda: o SAA sugere devolutivas na LAN e protocolos em 01 - PROJETOS", () => {
      const m = previa(vista[1]);
      const saa = item(m, "saa");
      const SAA_REAL_PASTA = "03 - PRODUTOS/02 - P. - SAA (PROJETISTA A)";
      assert.deepEqual(resumoDeDerivadas(derivadasDe(saa)), [`devolutivas:${SAA_REAL_PASTA}/02 - LAN:false`, `protocolos:${SAA_REAL_PASTA}/01 - PROJETOS:false`]);
    });
  }

  console.log(`\nResumo por empreendimento (${empreendimentos.length}):`);
  for (const [chave, pastas] of empreendimentos) {
    conferir(`${chave}: montagem sem erro e regras coerentes`, () => {
      const m = previa(pastas);
      // Pastas de segundo nível, mesmo que a lista traga só as mais fundas.
      const segundoNivel = [...new Set(pastas.filter((pasta) => pasta.split("/").length >= 2).map((pasta) => pasta.split("/").slice(0, 2).join("/")))];
      const produtos = segundoNivel.filter((pasta) => normalizarNome(pasta.split("/")[0]) === "PRODUTOS");

      const temSaa = produtos.some((pasta) => SAA_REAL.test(pasta.split("/")[1]));
      const temSes = produtos.some((pasta) => SES_REAL.test(pasta.split("/")[1]));
      assert.equal(item(m, "saa").pasta !== null, temSaa, `SAA ${temSaa ? "existe na árvore e não foi achado" : "não existe na árvore e foi achado"}`);
      assert.equal(item(m, "ses").pasta !== null, temSes, `SES ${temSes ? "existe na árvore e não foi achado" : "não existe na árvore e foi achado"}`);

      const proibidas = produtos.filter((pasta) => FORA_DO_CONTRATO.test(pasta.split("/")[1]));
      for (const alvo of m.itens.filter((candidato) => candidato.tipo === "projeto")) {
        const usadas = [alvo.pasta, ...alvo.slots.flatMap((slot) => slot.candidatas)].filter(Boolean);
        for (const usada of usadas) {
          assert.equal(proibidas.some((proibida) => usada === proibida || usada.startsWith(`${proibida}/`)), false, `${alvo.id} usa pasta fora do contrato: ${usada}`);
        }
      }
      for (const caminho of m.itens.flatMap((alvo) => alvo.slots.flatMap((slot) => slot.candidatas))) {
        assert.equal(caminhoBloqueado(caminho), false, `candidata bloqueada: ${caminho}`);
        assert.equal(validarPrefixoDeRegra(caminho).valido, true, `candidata inválida: ${caminho}`);
      }
      for (const alvo of m.itens) assert.ok(["encontrado", "parcial", "ambiguo", "ausente", "ja_criado", "indisponivel"].includes(alvo.estado));

      // Regras derivadas: só de itens de projeto, em pastas que existem na árvore, válidas, sem bloqueio e sem pasta ignorada.
      const naArvore = new Set(pastas.flatMap((pasta) => pasta.normalize("NFC").split("/").map((_, i, partes) => partes.slice(0, i + 1).join("/").toLowerCase())));
      for (const alvo of m.itens) {
        for (const slot of alvo.slots) {
          const derivadas = Object.entries(slot.derivadas);
          if (alvo.tipo !== "projeto") assert.equal(derivadas.length, 0, `${alvo.id} não é projeto`);
          for (const [candidata, lista] of derivadas) {
            assert.ok(slot.candidatas.includes(candidata), `${alvo.id}: derivada de uma pasta que não é candidata`);
            assert.ok(lista.length <= 2 && new Set(lista.map((regra) => regra.tipo)).size === lista.length, `${alvo.id}: tipos repetidos`);
            for (const regra of lista) {
              assert.ok(naArvore.has(regra.caminho.toLowerCase()), `${regra.caminho} não existe na árvore`);
              assert.equal(validarPrefixoDeRegra(regra.caminho).valido, true, `${regra.caminho} inválida`);
              assert.equal(caminhoBloqueado(regra.caminho), false, `${regra.caminho} bloqueada`);
              assert.equal(pastaIgnorada(`${regra.caminho}/x.pdf`), false, `${regra.caminho} ignorada`);
              assert.ok(candidata.toLowerCase().startsWith(`${regra.tipo === "devolutivas" ? regra.caminho.toLowerCase() : regra.caminho.split("/").slice(0, -1).join("/").toLowerCase()}/`), `${regra.caminho} fora do caminho do APROVADO`);
            }
          }
        }
      }
    });

    const m = previa(pastas);
    const achados = m.itens.filter((alvo) => alvo.pasta !== null);
    const rotulo = (alvo) => `${alvo.chave}${alvo.sistema ? `[${alvo.sistema}]` : ""}:${alvo.estado}`;
    console.log(`\n- ${chave}: ${pastas.length} pastas`);
    console.log(`  achados: ${achados.map(rotulo).join(", ") || "(nenhum)"}`);
    console.log(`  ausentes: ${m.itens.filter((alvo) => alvo.pasta === null).map((alvo) => alvo.chave).join(", ") || "(nenhum)"}`);
    for (const alvo of m.itens.filter((candidato) => candidato.estado === "ambiguo")) {
      for (const [indice, slot] of alvo.slots.entries()) if (slot.estado === "ambigua") console.log(`  AMBÍGUO ${alvo.id} (subpasta ${indice + 1}): ${slot.candidatas.join("  |  ")}`);
    }
    for (const alvo of m.itens.filter((candidato) => candidato.estado === "parcial")) {
      console.log(`  parcial ${alvo.id}: ${alvo.slots.map((slot) => (slot.estado === "ausente" ? "sem subpasta" : "ok")).join(", ")}`);
    }
    for (const alvo of m.itens.filter((candidato) => candidato.avisos.length > 0)) console.log(`  aviso ${alvo.id}: ${alvo.avisos.join(" ")}`);
    if (m.pastasDesconhecidas.length > 0) console.log(`  desconhecidas: ${m.pastasDesconhecidas.join("  |  ")}`);
  }
}

if (falhas.length > 0) {
  for (const falha of falhas) console.error(`FALHA: ${falha}`);
  console.error(`\n${falhas.length} falha(s) na montagem de pastas.`);
  exit(1);
}
console.log("\nOK: montagem de pastas conferida.");
