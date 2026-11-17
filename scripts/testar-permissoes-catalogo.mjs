// Confere o catálogo de permissões do código (src/lib/auth/permissoes.ts) contra o do banco
// (supabase/migrations/20261105100000_etapa8_permissoes.sql) e a consistência de áreas e modelos.
// Uso: node scripts/testar-permissoes-catalogo.mjs (Node 22.18+ ou 23.6+, que importam .ts
// removendo os tipos). Sai com código 1 se algo falhar.
import { readFileSync } from "node:fs";
import { exit } from "node:process";
import {
  AREAS,
  MODELOS,
  PERMISSOES,
  PREREQUISITOS,
  comPrerequisitos,
  ehPermissao,
} from "../src/lib/auth/permissoes.ts";

// O catálogo vigente é o da migration mais recente que redefine as funções (create or replace).
const MIGRATION = new URL("../supabase/migrations/20261109100000_etapa8_permissoes_exclusao.sql", import.meta.url);
const sql = readFileSync(MIGRATION, "utf8");

let falhas = 0;

function falhar(caso, motivo) {
  falhas += 1;
  console.error(`FALHA [${caso}]: ${motivo}`);
}

function corpoDaFuncao(nome) {
  const achado = sql.match(new RegExp(`create (?:or replace )?function public\\.${nome}\\([^)]*\\)[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`));
  if (!achado) {
    falhar("migration", `função ${nome} não encontrada em ${MIGRATION.pathname}`);
    return "";
  }
  return achado[1];
}

function repetidos(lista) {
  return lista.filter((item, indice) => lista.indexOf(item) !== indice);
}

// Catálogo: o array do SQL é igual a PERMISSOES, na mesma ordem.
const catalogoSql = [...corpoDaFuncao("catalogo_permissoes").matchAll(/'([^']+)'/g)].map((m) => m[1]);
if (catalogoSql.length !== 24) falhar("catálogo", `o SQL tem ${catalogoSql.length} permissões, esperado 24`);
if (PERMISSOES.length !== 24) falhar("catálogo", `PERMISSOES tem ${PERMISSOES.length} itens, esperado 24`);
if (repetidos(catalogoSql).length > 0) falhar("catálogo", `repetidas no SQL: ${repetidos(catalogoSql).join(", ")}`);
if (repetidos([...PERMISSOES]).length > 0) falhar("catálogo", `repetidas em PERMISSOES: ${repetidos([...PERMISSOES]).join(", ")}`);
if (JSON.stringify(catalogoSql) !== JSON.stringify(PERMISSOES)) {
  const soNoSql = catalogoSql.filter((p) => !PERMISSOES.includes(p));
  const soNoCodigo = PERMISSOES.filter((p) => !catalogoSql.includes(p));
  falhar("catálogo", `SQL e PERMISSOES diferem (só no SQL: [${soNoSql}]; só no código: [${soNoCodigo}]; ou a ordem mudou)`);
}

// Pré-requisitos: cada "when p_permissao = 'x' then array['y']" do SQL bate com PREREQUISITOS.
const prerequisitosSql = {};
for (const [, permissao, prerequisito] of corpoDaFuncao("prerequisitos_permissao").matchAll(
  /when p_permissao = '([^']+)' then array\['([^']+)'\]/g,
)) {
  if (prerequisitosSql[permissao]) falhar("pré-requisitos", `${permissao} aparece duas vezes no SQL`);
  prerequisitosSql[permissao] = [prerequisito];
}
if (Object.keys(prerequisitosSql).length !== 14) {
  falhar("pré-requisitos", `o SQL tem ${Object.keys(prerequisitosSql).length} regras, esperado 14`);
}
for (const [permissao, exigida] of [["empreendimentos.excluir", "empreendimentos.editar"], ["fornecedores.excluir", "fornecedores.editar"]]) {
  if (JSON.stringify(PREREQUISITOS[permissao]) !== JSON.stringify([exigida])) falhar("pré-requisitos", `${permissao} deveria exigir só ${exigida}`);
}
const chavesSql = Object.keys(prerequisitosSql).sort();
const chavesCodigo = Object.keys(PREREQUISITOS).sort();
if (JSON.stringify(chavesSql) !== JSON.stringify(chavesCodigo)) {
  falhar("pré-requisitos", `permissões com regra diferem (SQL: [${chavesSql}]; código: [${chavesCodigo}])`);
}
for (const permissao of chavesCodigo) {
  const doSql = JSON.stringify(prerequisitosSql[permissao] ?? null);
  const doCodigo = JSON.stringify(PREREQUISITOS[permissao]);
  if (doSql !== doCodigo) falhar("pré-requisitos", `${permissao}: SQL ${doSql}, código ${doCodigo}`);
}
for (const [permissao, exigidas] of Object.entries(PREREQUISITOS)) {
  if (!ehPermissao(permissao)) falhar("pré-requisitos", `${permissao} não está no catálogo`);
  for (const exigida of exigidas) {
    if (!ehPermissao(exigida)) falhar("pré-requisitos", `${permissao} exige ${exigida}, que não está no catálogo`);
    // A cadeia pode ter vários níveis (ver, editar, excluir); só não pode dar a volta.
    const visitadas = new Set([permissao]);
    const pendentes = [exigida];
    while (pendentes.length > 0) {
      const atual = pendentes.pop();
      if (visitadas.has(atual)) {
        falhar("pré-requisitos", `${permissao} depende de si mesma (ciclo passando por ${atual})`);
        break;
      }
      visitadas.add(atual);
      pendentes.push(...(PREREQUISITOS[atual] ?? []));
    }
  }
}

// ehPermissao e comPrerequisitos
for (const valor of ["nao.existe", "", "SITE.VER", "site.ver ", null, undefined, 1, {}, ["site.ver"]]) {
  if (ehPermissao(valor)) falhar("ehPermissao", `aceitou ${JSON.stringify(valor)}`);
}
for (const permissao of PERMISSOES) {
  if (!ehPermissao(permissao)) falhar("ehPermissao", `recusou ${permissao}`);
}
const completada = comPrerequisitos(["site.editar", "site.ver", "servidor.regras", "site.editar"]);
if (JSON.stringify(completada) !== JSON.stringify(["site.ver", "site.editar", "empreendimentos.ver", "servidor.regras"])) {
  falhar("comPrerequisitos", `resultado inesperado: ${JSON.stringify(completada)}`);
}
for (const [alvo, cadeia] of [
  ["empreendimentos.excluir", ["empreendimentos.ver", "empreendimentos.editar", "empreendimentos.excluir"]],
  ["fornecedores.excluir", ["fornecedores.ver", "fornecedores.editar", "fornecedores.excluir"]],
]) {
  if (JSON.stringify(comPrerequisitos([alvo])) !== JSON.stringify(cadeia)) {
    falhar("comPrerequisitos", `${alvo} deveria trazer a cadeia inteira na ordem do banco: ${JSON.stringify(comPrerequisitos([alvo]))}`);
  }
}
if (comPrerequisitos([]).length !== 0) falhar("comPrerequisitos", "lista vazia deveria continuar vazia");

// Áreas: cada permissão do catálogo em exatamente uma área, com rótulos preenchidos.
const nasAreas = AREAS.flatMap((area) => area.permissoes.map((item) => item.permissao));
for (const permissao of PERMISSOES) {
  const vezes = nasAreas.filter((p) => p === permissao).length;
  if (vezes !== 1) falhar("áreas", `${permissao} aparece ${vezes} vez(es) nas áreas, esperado 1`);
}
for (const permissao of nasAreas) {
  if (!ehPermissao(permissao)) falhar("áreas", `${permissao} não está no catálogo`);
}
if (repetidos(AREAS.map((area) => area.id)).length > 0) falhar("áreas", "id de área repetido");
for (const area of AREAS) {
  if (!area.id.trim() || !area.rotulo.trim()) falhar("áreas", `área sem id ou rótulo: ${JSON.stringify(area.id)}`);
  for (const item of area.permissoes) {
    if (!item.rotulo.trim()) falhar("áreas", `${item.permissao} sem rótulo`);
  }
}

// Modelos: só permissões válidas e já fechados em pré-requisitos.
if (repetidos(MODELOS.map((modelo) => modelo.id)).length > 0) falhar("modelos", "id de modelo repetido");
for (const modelo of MODELOS) {
  for (const permissao of modelo.permissoes) {
    if (!ehPermissao(permissao)) falhar("modelos", `${modelo.id}: ${permissao} não está no catálogo`);
  }
  if (repetidos([...modelo.permissoes]).length > 0) falhar("modelos", `${modelo.id}: permissão repetida`);
  const faltando = comPrerequisitos(modelo.permissoes).filter((p) => !modelo.permissoes.includes(p));
  if (faltando.length > 0) falhar("modelos", `${modelo.id} não contém os pré-requisitos: ${faltando.join(", ")}`);
}

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  exit(1);
}
console.log(
  `OK: ${PERMISSOES.length} permissões iguais no código e na migration, ${chavesCodigo.length} pré-requisitos batendo, ` +
    `${AREAS.length} áreas cobrindo o catálogo sem repetir e ${MODELOS.length} modelos fechados em pré-requisitos.`,
);
