// Testes da camada do site das etapas automáticas pelas pastas (docs/ETAPAS-AUTOMATICAS-CONTRATO.md):
// filtro de caminho das regras (src/lib/conector/sinais.ts), schemas de pasta-regras, modelos e etapas-automaticas,
// e conferências estáticas (o conector aplica o filtro, as rotas declaram a permissão, os tipos batem com a migration).
// Uso: node scripts/testar-sinais-etapas.mjs   (sai com código 1 se algo falhar; não precisa de banco nem de rede)
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
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

const falhas = [];
function conferir(descricao, funcao) {
  try {
    funcao();
  } catch (erro) {
    falhas.push(`${descricao}: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
}
const texto = (caminho) => readFileSync(resolve(raiz, caminho), "utf8");

const {
  pastaIgnorada, caminhoDeProtocolo, caminhoDeDevolutiva, motivoDeRecusaDoCaminho, pastaFinanceiraAbaixoDoPrefixo,
  MOTIVO_PASTA_IGNORADA, MOTIVO_PASTA_FINANCEIRA, MOTIVO_PROTOCOLO_FORA_DO_PADRAO, MOTIVO_DEVOLUTIVA_FORA_DO_PADRAO,
} = carregar("src/lib/conector/sinais.ts");

const SAA = "03 - PRODUTOS/02 - P. - SAA (PROJETISTA A)";
const PROJETOS = `${SAA}/01 - PROJETOS`;
const LAN = `${SAA}/02 - LAN`;
const protocolos = { tipo: "protocolos", caminho_prefixo: PROJETOS };
const devolutivas = { tipo: "devolutivas", caminho_prefixo: LAN };
const comum = { tipo: "comum", caminho_prefixo: `${LAN}/01 - APROVADO NO INTERLIGA` };
const motivo = (caminho, regra) => motivoDeRecusaDoCaminho(caminho, regra);

// ---------------------------------------------------------------------------------------------------------------------
// Motivos fixos
// ---------------------------------------------------------------------------------------------------------------------
conferir("motivos fixos", () => {
  assert.equal(MOTIVO_PASTA_IGNORADA, "Pasta ignorada (99 - OUTROS / antigos).");
  assert.equal(MOTIVO_PASTA_FINANCEIRA, "Pasta financeira dentro de um projeto (FINANCEIRO).");
  assert.equal(MOTIVO_PROTOCOLO_FORA_DO_PADRAO, "Fora do padrão de protocolos.");
  assert.equal(MOTIVO_DEVOLUTIVA_FORA_DO_PADRAO, "Fora do padrão de devolutivas.");
});

// ---------------------------------------------------------------------------------------------------------------------
// Pastas ignoradas (qualquer regra)
// ---------------------------------------------------------------------------------------------------------------------
const IGNORADAS = [
  `${PROJETOS}/99 - OUTROS/x.pdf`,
  `${PROJETOS}/99-OUTROS/x.pdf`,
  `${PROJETOS}/99 - qualquer coisa/x.pdf`,
  `${PROJETOS}/99 – RASCUNHOS/x.pdf`,
  `${PROJETOS}/01 - PROTOCOLO/99 - OUTROS/x.pdf`,
  `${PROJETOS}/OUTROS/x.pdf`,
  `${PROJETOS}/outros documentos/x.pdf`,
  `${PROJETOS}/Outrós/x.pdf`,
  `${PROJETOS}/03 - PROJETOS ANTIGOS/x.pdf`,
  `${PROJETOS}/ANTIGO/x.pdf`,
  `${PROJETOS}/antigas/x.pdf`,
  `${PROJETOS}/Antígos 2020/x.pdf`,
  `${PROJETOS}/01 - PROTOCOLO (1)/ANTIGO/x.pdf`,
  `03 - PRODUTOS/ANTIGOS/02 - P SAA/02 - LAN/x.pdf`,
];
for (const caminho of IGNORADAS) conferir(`ignorada: ${caminho}`, () => assert.equal(pastaIgnorada(caminho), true));

const NAO_IGNORADAS = [
  `${PROJETOS}/01 - PROTOCOLO (1)/x.pdf`,
  `${LAN}/01 - APROVADO NO INTERLIGA/x.pdf`,
  `${PROJETOS}/990 - X/x.pdf`,
  `${PROJETOS}/199 - X/x.pdf`,
  `${PROJETOS}/01 - PROTOCOLO/99 - OUTROS.pdf`,
  `${PROJETOS}/01 - PROTOCOLO/ANTIGO.pdf`,
  `${PROJETOS}/01 - PROTOCOLO/OUTROS.pdf`,
  `${PROJETOS}/01 - OUTROSIM/x.pdf`,
  "x.pdf",
];
for (const caminho of NAO_IGNORADAS) conferir(`não ignorada: ${caminho}`, () => assert.equal(pastaIgnorada(caminho), false));

conferir("pasta ignorada vale para comum, equipamentos, protocolos e devolutivas", () => {
  assert.equal(motivo(`${LAN}/01 - APROVADO NO INTERLIGA/ANTIGO/x.pdf`, comum), MOTIVO_PASTA_IGNORADA);
  assert.equal(motivo("03 - PRODUTOS/19 - SIMOS E LAUDOS/01 - BOMBAS/99 - OUTROS/SIMO x.pdf", { tipo: "equipamentos", caminho_prefixo: "03 - PRODUTOS/19 - SIMOS E LAUDOS" }), MOTIVO_PASTA_IGNORADA);
  assert.equal(motivo(`${PROJETOS}/99 - OUTROS/x.pdf`, protocolos), MOTIVO_PASTA_IGNORADA);
  assert.equal(motivo(`${LAN}/99 - OUTROS/x.pdf`, devolutivas), MOTIVO_PASTA_IGNORADA);
  assert.equal(motivo(`${LAN}/01 - APROVADO NO INTERLIGA/x.pdf`, { caminho_prefixo: comum.caminho_prefixo }), null, "regra sem tipo segue como comum");
  assert.equal(motivo(`${LAN}/01 - APROVADO NO INTERLIGA/x.pdf`, comum), null);
});

// ---------------------------------------------------------------------------------------------------------------------
// Pasta FINANCEIRO abaixo do prefixo da regra (qualquer tipo de regra); o prefixo em si e o nome do arquivo não contam
// ---------------------------------------------------------------------------------------------------------------------
const APROVADO = `${LAN}/01 - APROVADO NO INTERLIGA`;
const ASSINADOS = { tipo: "comum", caminho_prefixo: "02 - FINANCEIRO/01 - PROPOSTA E CONTRATO/01 - ASSINADOS" };
const equipamentos = { tipo: "equipamentos", caminho_prefixo: "03 - PRODUTOS/19 - SIMOS E LAUDOS" };
conferir("pasta com FINANCEIRO no nome abaixo do prefixo é recusada em qualquer tipo de regra", () => {
  assert.equal(motivo(`${APROVADO}/02 - FINANCEIRO/x.pdf`, comum), MOTIVO_PASTA_FINANCEIRA);
  assert.equal(motivo(`${APROVADO}/Financeiro/x.pdf`, comum), MOTIVO_PASTA_FINANCEIRA, "sem diferenciar caixa");
  assert.equal(motivo(`${APROVADO}/Financeiro ABA/sub/x.pdf`, comum), MOTIVO_PASTA_FINANCEIRA, "em qualquer profundidade e com mais texto no nome");
  assert.equal(motivo(`${APROVADO}/FINANCEIRO.pdf/x.pdf`, comum), MOTIVO_PASTA_FINANCEIRA);
  assert.equal(motivo(`${APROVADO.replaceAll("/", "\\")}\\FINANCEIRO\\x.pdf`, comum), MOTIVO_PASTA_FINANCEIRA, "barra invertida");
  assert.equal(motivo(`${APROVADO}/FINANCEIRO/x.pdf`.toUpperCase(), { tipo: "comum", caminho_prefixo: comum.caminho_prefixo.toLowerCase() }), MOTIVO_PASTA_FINANCEIRA, "prefixo em outra caixa");
  assert.equal(motivo(`${PROJETOS}/01 - PROTOCOLO (1)/FINANCEIRO/x.pdf`, protocolos), MOTIVO_PASTA_FINANCEIRA);
  assert.equal(motivo(`${PROJETOS}/FINANCEIRO/01 - PROTOCOLO (1)/x.pdf`, protocolos), MOTIVO_PASTA_FINANCEIRA, "vale antes do formato de protocolos");
  assert.equal(motivo(`${LAN}/FINANCEIRO/x.pdf`, devolutivas), MOTIVO_PASTA_FINANCEIRA);
  assert.equal(motivo("03 - PRODUTOS/19 - SIMOS E LAUDOS/01 - BOMBAS/FINANCEIRO/SIMO x.pdf", equipamentos), MOTIVO_PASTA_FINANCEIRA);
  assert.equal(motivo(`${APROVADO}/FINANCEIRO/x.pdf`, { caminho_prefixo: comum.caminho_prefixo }), MOTIVO_PASTA_FINANCEIRA, "regra sem tipo segue como comum");
  assert.equal(motivo(`${APROVADO}/ANTIGO/FINANCEIRO/x.pdf`, comum), MOTIVO_PASTA_IGNORADA, "a pasta ignorada tem a precedência");
});
conferir("o prefixo da regra e o nome do arquivo com FINANCEIRO não são recusados", () => {
  assert.equal(motivo("02 - FINANCEIRO/01 - PROPOSTA E CONTRATO/01 - ASSINADOS/contrato.pdf", ASSINADOS), null, "as regras de contratos ficam em 02 - FINANCEIRO");
  assert.equal(motivo("02 - FINANCEIRO/01 - PROPOSTA E CONTRATO/01 - ASSINADOS/2024/contrato.pdf", ASSINADOS), null);
  assert.equal(motivo("02 - FINANCEIRO/05 - ORÇAMENTOS DE 3º/x.pdf", { tipo: "comum", caminho_prefixo: "02 - FINANCEIRO/05 - ORÇAMENTOS DE 3º" }), null);
  assert.equal(motivo("02 - FINANCEIRO/x.pdf", { tipo: "comum", caminho_prefixo: "02 - FINANCEIRO" }), null, "o prefixo termina em FINANCEIRO");
  assert.equal(motivo(`${APROVADO}/FINANCEIRO.pdf`, comum), null, "o último segmento é o arquivo");
  assert.equal(motivo(`${APROVADO}/relatório financeiro.pdf`, comum), null);
  assert.equal(motivo(`${APROVADO}/projeto.pdf`, comum), null);
  assert.equal(motivo(`${PROJETOS}/01 - PROTOCOLO (1)/projeto.pdf`, protocolos), null);
  assert.equal(motivo(`${LAN}/devolutiva copasa.pdf`, devolutivas), null);
  assert.equal(motivo("03 - PRODUTOS/ASSINADOS/FINANCEIRO/x.pdf", { tipo: "comum", caminho_prefixo: "03 - PRODUTOS/ASSINADOS/FINANCEIRO" }), null);
});
conferir("pastaFinanceiraAbaixoDoPrefixo só olha pastas depois do prefixo", () => {
  assert.equal(pastaFinanceiraAbaixoDoPrefixo("02 - FINANCEIRO/a/b.pdf", "02 - FINANCEIRO"), false);
  assert.equal(pastaFinanceiraAbaixoDoPrefixo("02 - FINANCEIRO/FINANCEIRO/b.pdf", "02 - FINANCEIRO"), true);
  assert.equal(pastaFinanceiraAbaixoDoPrefixo("02 - FINANCEIRO/a/b.pdf", "03 - PRODUTOS"), false, "caminho fora do prefixo não casa");
  assert.equal(pastaFinanceiraAbaixoDoPrefixo("02 - FINANCEIRO", "02 - FINANCEIRO"), false, "o caminho igual ao prefixo não tem pasta abaixo");
});

// ---------------------------------------------------------------------------------------------------------------------
// Protocolos: PDF numa subpasta cujo nome tem PROTOCOLO (primeiro nível abaixo do prefixo)
// ---------------------------------------------------------------------------------------------------------------------
conferir("protocolos aceita PDF dentro de subpasta PROTOCOLO, em qualquer profundidade", () => {
  for (const caminho of [
    `${PROJETOS}/01 - PROTOCOLO (1)/projeto.pdf`,
    `${PROJETOS}/02 - PROTOCOLO (2)/sub/projeto.pdf`,
    `${PROJETOS}/protocolo/x.pdf`,
    `${PROJETOS}/Protocolo Copasa/x.pdf`,
    `${PROJETOS}/03 - PROTÓCOLO/x.pdf`,
    `${PROJETOS}/03 - PROTOCOLO FINAL/x.pdf`,
  ]) assert.equal(motivo(caminho, protocolos), null, caminho);
});
conferir("protocolos recusa o resto com o motivo fixo", () => {
  for (const caminho of [
    `${PROJETOS}/x.pdf`,
    `${PROJETOS}/PROTOCOLO.pdf`,
    `${PROJETOS}/01 - PROJETO FINALIZADO/x.pdf`,
    `${PROJETOS}/01 - PROJETO FINALIZADO/PROTOCOLO/x.pdf`,
    `${PROJETOS}/RASCUNHO/PROTOCOLO x.pdf`,
    `${SAA}/outra pasta/01 - PROTOCOLO/x.pdf`,
    PROJETOS,
  ]) assert.equal(motivo(caminho, protocolos), MOTIVO_PROTOCOLO_FORA_DO_PADRAO, caminho);
});
conferir("protocolos compara o prefixo sem diferenciar caixa e normaliza barras e Unicode", () => {
  assert.equal(motivo(`${PROJETOS}/01 - PROTOCOLO/x.pdf`.toUpperCase(), { tipo: "protocolos", caminho_prefixo: PROJETOS.toLowerCase() }), null);
  assert.equal(caminhoDeProtocolo(`${PROJETOS.replaceAll("/", "\\")}\\01 - PROTOCOLO\\x.pdf`, PROJETOS), true);
  assert.equal(caminhoDeProtocolo(`${PROJETOS}/01 - PROTOCOLO/x.pdf`.normalize("NFD"), PROJETOS.normalize("NFC")), true);
});

// ---------------------------------------------------------------------------------------------------------------------
// Devolutivas: PDF solto na LAN
// ---------------------------------------------------------------------------------------------------------------------
conferir("devolutivas aceita só o PDF solto na LAN", () => {
  assert.equal(motivo(`${LAN}/devolutiva copasa.pdf`, devolutivas), null);
  assert.equal(motivo(`${LAN.toLowerCase()}/Devolutiva.PDF`, devolutivas), null);
});
conferir("devolutivas recusa subpasta (inclusive a do APROVADO) com o motivo fixo", () => {
  for (const caminho of [
    `${LAN}/01 - APROVADO NO INTERLIGA/x.pdf`,
    `${LAN}/subpasta/x.pdf`,
    `${SAA}/x.pdf`,
    LAN,
  ]) assert.equal(motivo(caminho, devolutivas), MOTIVO_DEVOLUTIVA_FORA_DO_PADRAO, caminho);
  assert.equal(caminhoDeDevolutiva(`${LAN}/x.pdf`, LAN), true);
  assert.equal(caminhoDeDevolutiva(`${LAN}/a/x.pdf`, LAN), false);
});
conferir("o filtro de formato não vale para a regra comum nem para a de equipamentos", () => {
  assert.equal(motivo(`${SAA}/qualquer/coisa/x.pdf`, { tipo: "comum", caminho_prefixo: SAA }), null);
});

// ---------------------------------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------------------------------
const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const regras = carregar("src/app/api/(modules)/adm-interno/portal/pasta-regras/schema.ts");
const { criarSchema, atualizarSchema, destinoValido, TIPOS_DE_REGRA } = regras;
const baseCriar = { empreendimentoId: ID, caminhoPrefixo: PROJETOS, projetoId: ID2 };
const aceita = (schema, dados) => schema.safeParse(dados).success;

conferir("pasta-regras: tipos aceitos", () => assert.deepEqual([...TIPOS_DE_REGRA], ["comum", "equipamentos", "protocolos", "devolutivas"]));
conferir("pasta-regras: protocolos e devolutivas pedem projeto, categoria opcional, nunca grupo", () => {
  for (const tipo of ["protocolos", "devolutivas"]) {
    assert.equal(aceita(criarSchema, { ...baseCriar, tipo }), true, `${tipo} só com projeto`);
    assert.equal(aceita(criarSchema, { ...baseCriar, tipo, categoriaId: ID }), true, `${tipo} com categoria`);
    assert.equal(aceita(criarSchema, { empreendimentoId: ID, caminhoPrefixo: PROJETOS, tipo, grupo: "contratos" }), false, `${tipo} com grupo`);
    assert.equal(aceita(criarSchema, { empreendimentoId: ID, caminhoPrefixo: PROJETOS, tipo }), false, `${tipo} sem destino`);
  }
  assert.equal(destinoValido({ projetoId: ID, categoriaId: ID2 }, "protocolos"), true);
  assert.equal(destinoValido({ projetoId: ID, categoriaId: ID2 }, "equipamentos"), false);
});
conferir("pasta-regras: protocolos e devolutivas ficam ocultos (sem liberação automática)", () => {
  assert.equal(aceita(criarSchema, { ...baseCriar, tipo: "protocolos", liberarAutomatico: true }), false);
  assert.equal(aceita(criarSchema, { ...baseCriar, tipo: "devolutivas", liberarAutomatico: false }), true);
  assert.equal(aceita(atualizarSchema, { id: ID, tipo: "devolutivas", projetoId: ID2, liberarAutomatico: true }), false);
});
conferir("pasta-regras: a marca Aprovado vale só para regra comum de projeto", () => {
  assert.equal(aceita(criarSchema, { ...baseCriar, marcaAprovado: true }), true);
  assert.equal(aceita(criarSchema, { ...baseCriar, marcaAprovado: false }), true);
  assert.equal(aceita(criarSchema, { empreendimentoId: ID, caminhoPrefixo: PROJETOS, grupo: "contratos", marcaAprovado: true }), false, "grupo");
  assert.equal(aceita(criarSchema, { ...baseCriar, tipo: "protocolos", marcaAprovado: true }), false, "protocolos");
  assert.equal(aceita(criarSchema, { ...baseCriar, tipo: "equipamentos", marcaAprovado: true }), false, "equipamentos");
  assert.equal(aceita(atualizarSchema, { id: ID, marcaAprovado: true }), true, "só a marca");
  assert.equal(aceita(atualizarSchema, { id: ID, tipo: "devolutivas", projetoId: ID2, marcaAprovado: true }), false);
  assert.equal(aceita(criarSchema, { ...baseCriar, marcaAprovado: "sim" }), false, "tipo errado");
});
conferir("pasta-regras: mudar o tipo exige o destino; atualizar sem nada é recusado", () => {
  assert.equal(aceita(atualizarSchema, { id: ID, tipo: "protocolos" }), false);
  assert.equal(aceita(atualizarSchema, { id: ID, tipo: "protocolos", projetoId: ID2 }), true);
  assert.equal(aceita(atualizarSchema, { id: ID }), false);
});
conferir("pasta-regras: tipo desconhecido é recusado", () => assert.equal(aceita(criarSchema, { ...baseCriar, tipo: "outro" }), false));

// Grupo "arquivo" (Outros projetos): rótulo obrigatório, 1 a 120 caracteres, sem controle; nada de rótulo nos outros destinos.
const sugestoes = carregar("src/lib/conector/sugestoes.ts");
const baseArquivo = { empreendimentoId: ID, caminhoPrefixo: "03 - PRODUTOS/19 - PROJETO URBANÍSTICO", grupo: "arquivo" };
conferir("sugestoes: o grupo arquivo existe e o rótulo é validado como no banco", () => {
  assert.deepEqual([...sugestoes.GRUPOS_DE_DOCUMENTO], ["contratos", "orcamentos", "arquivo"]);
  assert.equal(sugestoes.ROTULO_DO_GRUPO.arquivo, "Outros projetos (arquivo)");
  assert.deepEqual(sugestoes.validarRotulo("  Projeto Urbanístico  "), { valido: true, rotulo: "Projeto Urbanístico" });
  assert.equal(sugestoes.validarRotulo("").valido, false);
  assert.equal(sugestoes.validarRotulo("   ").valido, false);
  assert.equal(sugestoes.validarRotulo("x".repeat(120)).valido, true);
  assert.equal(sugestoes.validarRotulo("x".repeat(121)).valido, false);
  assert.equal(sugestoes.validarRotulo("a\u0000b").valido, false);
  assert.equal(sugestoes.validarRotulo("a\u0085b").valido, false);
});
conferir("pasta-regras: grupo arquivo pede rótulo e só vale com ele", () => {
  assert.equal(aceita(criarSchema, { ...baseArquivo, rotulo: "Projeto Urbanístico" }), true);
  assert.equal(criarSchema.parse({ ...baseArquivo, rotulo: "  Projeto Urbanístico  " }).rotulo, "Projeto Urbanístico", "o rótulo sai aparado");
  assert.equal(aceita(criarSchema, { ...baseArquivo }), false, "sem rótulo");
  assert.equal(aceita(criarSchema, { ...baseArquivo, rotulo: null }), false);
  assert.equal(aceita(criarSchema, { ...baseArquivo, rotulo: "   " }), false);
  assert.equal(aceita(criarSchema, { ...baseArquivo, rotulo: "x".repeat(120) }), true);
  assert.equal(aceita(criarSchema, { ...baseArquivo, rotulo: "x".repeat(121) }), false);
  assert.equal(aceita(criarSchema, { ...baseArquivo, rotulo: "a\tb" }), false, "caractere de controle");
  assert.equal(aceita(criarSchema, { ...baseArquivo, rotulo: "Projeto", projetoId: ID2 }), false, "arquivo e projeto juntos");
  assert.equal(aceita(criarSchema, { ...baseArquivo, rotulo: "Projeto", categoriaId: ID2 }), false, "arquivo com categoria");
  for (const tipo of ["equipamentos", "protocolos", "devolutivas"]) assert.equal(aceita(criarSchema, { ...baseArquivo, rotulo: "Projeto", tipo }), false, `arquivo com tipo ${tipo}`);
  assert.equal(aceita(criarSchema, { empreendimentoId: ID, caminhoPrefixo: PROJETOS, grupo: "contratos", rotulo: "Contratos" }), false, "rótulo em outro grupo");
  assert.equal(aceita(criarSchema, { ...baseCriar, rotulo: "Projeto" }), false, "rótulo em regra de projeto");
  assert.equal(aceita(criarSchema, { ...baseCriar, rotulo: null }), true, "rótulo nulo em regra de projeto");
  assert.equal(aceita(criarSchema, { ...baseArquivo, rotulo: "Projeto", liberarAutomatico: true }), false, "os PDFs ficam ocultos até a equipe liberar");
  assert.equal(aceita(criarSchema, { ...baseArquivo, rotulo: "Projeto", liberarAutomatico: false }), true);
  assert.equal(destinoValido({ grupo: "arquivo", rotulo: "Projeto" }), true);
  assert.equal(destinoValido({ grupo: "arquivo" }), false);
  assert.equal(destinoValido({ grupo: "contratos", rotulo: "Projeto" }), false);
  assert.equal(destinoValido({ projetoId: ID, rotulo: "Projeto" }), false);
});
conferir("pasta-regras: atualizar o destino manda grupo e rótulo juntos", () => {
  assert.equal(aceita(atualizarSchema, { id: ID, grupo: "arquivo", rotulo: "Projeto" }), true);
  assert.equal(aceita(atualizarSchema, { id: ID, grupo: "arquivo" }), false, "sem rótulo");
  assert.equal(aceita(atualizarSchema, { id: ID, rotulo: "Só o rótulo" }), false, "o destino vem inteiro");
  assert.equal(aceita(atualizarSchema, { id: ID, grupo: "contratos", rotulo: null }), true, "trocar arquivo por contratos zera o rótulo");
  assert.equal(aceita(atualizarSchema, { id: ID, grupo: "contratos", rotulo: "x" }), false);
  assert.equal(aceita(atualizarSchema, { id: ID, projetoId: ID2, grupo: null, rotulo: null }), true, "arquivo passa a projeto");
  assert.equal(aceita(atualizarSchema, { id: ID, grupo: "arquivo", rotulo: "Projeto", liberarAutomatico: true }), false);
});

const modelos = carregar("src/app/api/(modules)/adm-interno/portal/modelos/schema.ts");
const baseModelo = { nome: "Modelo", descricao: null, ativo: true, categorias: [] };
const etapa = (nome, ordem, marco) => ({ nome, ordem, marco });
conferir("modelos: cada etapa manda a marca (null ou uma das três)", () => {
  assert.equal(aceita(modelos.criarSchema, { ...baseModelo, etapas: [etapa("Em confecção", 0, "confeccao"), etapa("Em análise", 1, "analise"), etapa("Aprovado", 2, "aprovado"), etapa("Concluído", 3, null)] }), true);
  assert.equal(aceita(modelos.criarSchema, { ...baseModelo, etapas: [{ nome: "Sem a chave", ordem: 0 }] }), false, "a chave marco é obrigatória");
  assert.equal(aceita(modelos.criarSchema, { ...baseModelo, etapas: [etapa("Etapa", 0, "inicio")] }), false, "marca inexistente");
});
conferir("modelos: no máximo uma etapa de cada marca", () => {
  assert.equal(aceita(modelos.criarSchema, { ...baseModelo, etapas: [etapa("Um", 0, "aprovado"), etapa("Dois", 1, "aprovado")] }), false);
  assert.equal(aceita(modelos.atualizarSchema, { ...baseModelo, id: ID, etapas: [etapa("Um", 0, null), etapa("Dois", 1, null)] }), true, "várias sem marca");
});

const etapas = carregar("src/app/api/(modules)/adm-interno/portal/etapas-automaticas/schema.ts");
conferir("etapas-automaticas: corpos estritos, só ids e o modo", () => {
  assert.equal(aceita(etapas.modoSchema, { empreendimentoId: ID, modo: "sugerir" }), true);
  assert.equal(aceita(etapas.modoSchema, { empreendimentoId: ID, modo: "automatico" }), true);
  assert.equal(aceita(etapas.modoSchema, { empreendimentoId: ID, modo: "ligado" }), false);
  assert.equal(aceita(etapas.modoSchema, { empreendimentoId: ID, modo: "sugerir", extra: 1 }), false, "campo a mais");
  assert.equal(aceita(etapas.confirmarSchema, { projetoId: ID, sinalId: ID2 }), true);
  assert.equal(aceita(etapas.confirmarSchema, { projetoId: ID, sinalId: "x" }), false);
  assert.equal(aceita(etapas.confirmarSchema, { projetoId: ID, sinalId: ID2, etapaId: ID }), false, "a etapa nunca vem do corpo");
  assert.equal(aceita(etapas.ignorarSchema, { sinalId: ID }), true);
  assert.equal(aceita(etapas.desfazerSchema, { historicoId: ID }), true);
  assert.equal(aceita(etapas.desfazerSchema, {}), false);
  assert.equal(aceita(etapas.recalculoConsultaSchema, { empreendimentoId: ID }), true);
  assert.equal(aceita(etapas.recalculoAplicarSchema, { empreendimentoId: ID, itens: [{ projetoId: ID2, sinalId: ID }] }), true);
  assert.equal(aceita(etapas.recalculoAplicarSchema, { empreendimentoId: ID, itens: [] }), false);
  assert.equal(aceita(etapas.recalculoAplicarSchema, { empreendimentoId: ID, itens: [{ projetoId: ID2 }] }), false, "sem o sinal visto");
  assert.equal(aceita(etapas.recalculoAplicarSchema, { empreendimentoId: ID, itens: [{ projetoId: ID2, sinalId: ID }, { projetoId: ID2, sinalId: ID }] }), false, "projeto repetido");
  assert.equal(aceita(etapas.recalculoAplicarSchema, { empreendimentoId: ID, projetoIds: [ID2] }), false, "formato antigo");
  assert.equal(aceita(etapas.recalculoAplicarSchema, { empreendimentoId: ID, itens: Array.from({ length: 201 }, () => ({ projetoId: ID2, sinalId: ID })) }), false);
});

// ---------------------------------------------------------------------------------------------------------------------
// Texto exibido
// ---------------------------------------------------------------------------------------------------------------------
const { limitarTexto, TAMANHO_MAXIMO_EXIBIDO } = carregar("src/lib/portal/etapas/tipos.ts");
conferir("limitarTexto: corta, tira controle e mantém o texto como está (nunca HTML interpretado)", () => {
  assert.equal([...limitarTexto("a".repeat(500))].length, TAMANHO_MAXIMO_EXIBIDO + 1);
  assert.equal(limitarTexto("  a\u0000b \n c  "), "a b c");
  assert.equal(limitarTexto("<img src=x onerror=alert(1)>"), "<img src=x onerror=alert(1)>");
});

// ---------------------------------------------------------------------------------------------------------------------
// Conferências estáticas
// ---------------------------------------------------------------------------------------------------------------------
conferir("o conector aplica o filtro ao autorizar e ao confirmar", () => {
  for (const arquivo of [
    "src/app/api/(modules)/conector/v1/envios/service.ts",
    "src/app/api/(modules)/conector/v1/envios/[id]/confirmar/service.ts",
  ]) {
    const fonte = texto(arquivo);
    assert.match(fonte, /import \{ motivoDeRecusaDoCaminho \} from "@\/lib\/conector\/sinais"/, `${arquivo} não importa o filtro`);
    assert.match(fonte, /motivoDeRecusaDoCaminho\(/, `${arquivo} não chama o filtro`);
  }
});

const ROTAS = [
  ["modo", "PATCH", "escrita", "empreendimentos.editar"],
  ["confirmar", "POST", "escrita", "empreendimentos.editar"],
  ["ignorar", "POST", "escrita", "empreendimentos.editar"],
  ["desfazer", "POST", "escrita", "empreendimentos.editar"],
  ["recalculo", "GET", "leitura", "empreendimentos.ver"],
  ["recalculo", "POST", "escrita", "empreendimentos.editar"],
];
for (const [pasta, metodo, acao, permissao] of ROTAS) {
  conferir(`rota etapas-automaticas/${pasta} ${metodo} pede ${permissao} antes de qualquer leitura`, () => {
    const fonte = texto(`src/app/api/(modules)/adm-interno/portal/etapas-automaticas/${pasta}/route.ts`);
    const inicio = fonte.indexOf(`export async function ${metodo}(`);
    assert.notEqual(inicio, -1, `sem handler ${metodo}`);
    const corpo = fonte.slice(inicio);
    const indiceDaRegra = corpo.indexOf(`autorizarPortal("${acao}", "${permissao}")`);
    assert.notEqual(indiceDaRegra, -1, "regra não encontrada");
    for (const proibido of ["lerJsonLimitado(", "validation(", "createClient(", "createAdminClient("]) {
      const onde = corpo.indexOf(proibido);
      assert.ok(onde === -1 || onde > indiceDaRegra, `${proibido} vem antes da regra`);
    }
  });
}
conferir("as etapas automáticas nunca usam a secret key (o RLS e as funções do banco valem)", () => {
  for (const arquivo of ["service.ts", "modo/route.ts", "confirmar/route.ts", "ignorar/route.ts", "desfazer/route.ts", "recalculo/route.ts"]) {
    assert.doesNotMatch(texto(`src/app/api/(modules)/adm-interno/portal/etapas-automaticas/${arquivo}`), /createAdminClient|supabase\/admin/, arquivo);
  }
});
conferir("o service chama as funções do banco com os nomes da migration", () => {
  const servico = texto("src/app/api/(modules)/adm-interno/portal/etapas-automaticas/service.ts");
  const migration = texto("supabase/migrations/20261112100000_etapas_automaticas.sql");
  for (const funcao of ["sugestao_etapa", "aplicar_sugestao_etapa", "ignorar_sinal_etapa", "desfazer_etapa", "aplicar_sugestoes_empreendimento"]) {
    assert.match(servico, new RegExp(`rpc\\("${funcao}"`), `service não chama ${funcao}`);
    assert.match(migration, new RegExp(`create function public\\.${funcao}\\(`), `migration sem ${funcao}`);
  }
});
conferir("os tipos de regra e as marcas do site são os da migration", () => {
  const migration = texto("supabase/migrations/20261112100000_etapas_automaticas.sql");
  assert.match(migration, /tipo in \('comum', 'equipamentos', 'protocolos', 'devolutivas'\)/);
  assert.match(migration, /sinal in \('protocolo', 'devolutiva', 'aprovado'\)/);
  assert.match(migration, /marco in \('confeccao', 'analise', 'aprovado'\)/);
  assert.match(migration, /etapas_modo in \('desligado', 'sugerir', 'automatico'\)/);
});
conferir("o cliente não recebe sinal, histórico nem nome de arquivo: nada de etapa_sinais fora do painel", () => {
  for (const pasta of ["src/app/cliente", "src/app/empreiteiro", "src/app/fornecedor", "src/app/api/(modules)/portal"]) {
    const achados = listarArquivos(resolve(raiz, pasta)).filter((arquivo) => /etapa_sinais|projeto_etapa_historico|etapas-automaticas/.test(readFileSync(arquivo, "utf8")));
    assert.deepEqual(achados, [], `${pasta} cita dados de etapas automáticas`);
  }
});

function listarArquivos(pasta, achados = []) {
  if (!existsSync(pasta)) return achados;
  for (const entrada of readdirSync(pasta)) {
    const caminho = join(pasta, entrada);
    if (statSync(caminho).isDirectory()) listarArquivos(caminho, achados);
    else if (/\.(ts|tsx)$/.test(entrada)) achados.push(caminho);
  }
  return achados;
}

if (falhas.length > 0) {
  for (const falha of falhas) console.error(`FALHA: ${falha}`);
  console.error(`\n${falhas.length} falha(s) nas etapas automáticas.`);
  exit(1);
}
console.log("OK: etapas automáticas pelas pastas conferidas (filtro de caminho, schemas e conferências estáticas).");
