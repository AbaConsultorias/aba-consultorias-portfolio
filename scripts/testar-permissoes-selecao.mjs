// Confere a lógica das caixas de permissão da tela Equipe (src/lib/auth/permissoes-selecao.ts):
// cascata de pré-requisitos nos dois sentidos, áreas e modelos.
// Uso: node scripts/testar-permissoes-selecao.mjs. Sai com código 1 se algo falhar.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const modulos = new Map();

// permissoes-selecao.ts importa "./permissoes" sem extensão (o tsc exige assim): este
// carregador transpila os .ts e resolve esse import.
function carregar(arquivo) {
  if (modulos.has(arquivo)) return modulos.get(arquivo).exports;
  const modulo = { exports: {} };
  modulos.set(arquivo, modulo);
  const codigo = ts.transpileModule(readFileSync(arquivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: arquivo,
  }).outputText;
  const importar = (nome) => (nome.startsWith(".") ? carregar(`${resolve(dirname(arquivo), nome)}.ts`) : require(nome));
  runInThisContext(`(function(require, module, exports) {${codigo}\n})`, { filename: arquivo })(importar, modulo, modulo.exports);
  return modulo.exports;
}

const { AREAS, MODELOS, PERMISSOES, PREREQUISITOS } = carregar(resolve(raiz, "src/lib/auth/permissoes.ts"));
const { selecaoDe, marcar, desmarcar, alternar, areaCompleta, liberarArea, limparArea, aplicarModelo, paraLista, mesmaSelecao } =
  carregar(resolve(raiz, "src/lib/auth/permissoes-selecao.ts"));

let falhas = 0;
let verificacoes = 0;

function conferir(caso, condicao, detalhe = "") {
  verificacoes += 1;
  if (condicao) return;
  falhas += 1;
  console.error(`FALHA [${caso}]${detalhe ? `: ${detalhe}` : ""}`);
}

const lista = (selecao) => paraLista(selecao).join(", ") || "(vazio)";
function igual(caso, selecao, esperado) {
  conferir(caso, mesmaSelecao(selecao, selecaoDe(esperado)), `veio [${lista(selecao)}], esperado [${esperado.join(", ")}]`);
}

const vazio = selecaoDe([]);

// Marcar uma permissão marca os pré-requisitos.
igual("editar marca ver", marcar(vazio, "financeiro.editar"), ["financeiro.ver", "financeiro.editar"]);
igual("ver sozinho", marcar(vazio, "financeiro.ver"), ["financeiro.ver"]);
igual("liberar marca ver", marcar(vazio, "documentos.liberar"), ["documentos.ver", "documentos.liberar"]);
igual("aprovar marca ver", marcar(vazio, "obras.aprovar"), ["obras.ver", "obras.aprovar"]);

// servidor.regras exige empreendimentos.ver, de outra área.
igual("servidor.regras marca empreendimentos.ver", marcar(vazio, "servidor.regras"), ["servidor.regras", "empreendimentos.ver"]);
igual("painel.servidor não exige nada", marcar(vazio, "painel.servidor"), ["painel.servidor"]);

// Desmarcar um pré-requisito desmarca o que depende dele.
{
  const cheio = selecaoDe(["documentos.ver", "documentos.editar", "documentos.liberar", "financeiro.ver"]);
  igual("desmarcar ver leva editar e liberar", desmarcar(cheio, "documentos.ver"), ["financeiro.ver"]);
  igual("desmarcar editar mantém ver e liberar", desmarcar(cheio, "documentos.editar"), ["documentos.ver", "documentos.liberar", "financeiro.ver"]);
}
{
  const comServidor = selecaoDe(["empreendimentos.ver", "empreendimentos.editar", "servidor.regras", "painel.servidor"]);
  igual("desmarcar empreendimentos.ver leva servidor.regras", desmarcar(comServidor, "empreendimentos.ver"), ["painel.servidor"]);
  igual("desmarcar servidor.regras mantém empreendimentos.ver", desmarcar(comServidor, "servidor.regras"), ["empreendimentos.ver", "empreendimentos.editar", "painel.servidor"]);
}

// Alternar e imutabilidade da seleção original.
{
  const base = selecaoDe(["site.ver"]);
  const com = alternar(base, "site.editar");
  igual("alternar marca", com, ["site.ver", "site.editar"]);
  igual("alternar desmarca", alternar(com, "site.editar"), ["site.ver"]);
  igual("original intacto", base, ["site.ver"]);
  conferir("original intacto (tamanho)", base.size === 1);
}

// Entrada desconhecida é descartada.
igual("selecaoDe ignora o que não é do catálogo", selecaoDe(["site.ver", "admin.tudo", "", "SITE.EDITAR"]), ["site.ver"]);

// Áreas.
for (const area of AREAS) {
  const todas = area.permissoes.map((item) => item.permissao);
  const liberada = liberarArea(vazio, area.id);
  conferir(`área ${area.id} completa após liberar`, areaCompleta(liberada, area.id));
  conferir(`área ${area.id} vazia não é completa`, !areaCompleta(vazio, area.id));
  for (const permissao of todas) {
    conferir(`área ${area.id} contém ${permissao}`, liberada.has(permissao));
    for (const prerequisito of PREREQUISITOS[permissao] ?? []) {
      conferir(`área ${area.id}: pré-requisito ${prerequisito} de ${permissao}`, liberada.has(prerequisito));
    }
  }
  const limpa = limparArea(liberada, area.id);
  conferir(`área ${area.id} limpa fica sem as próprias permissões`, todas.every((permissao) => !limpa.has(permissao)));
}
igual("liberar área servidor puxa empreendimentos.ver", liberarArea(vazio, "servidor"), ["servidor.regras", "painel.servidor", "empreendimentos.ver"]);
igual("liberar área financeiro", liberarArea(vazio, "financeiro"), ["financeiro.ver", "financeiro.editar"]);
igual("liberar área desconhecida não muda nada", liberarArea(selecaoDe(["site.ver"]), "inexistente"), ["site.ver"]);
conferir("área desconhecida nunca é completa", !areaCompleta(vazio, "inexistente"));
{
  const comEmpreendimentos = selecaoDe(["empreendimentos.ver", "servidor.regras", "painel.servidor"]);
  igual("limpar área empreendimentos leva servidor.regras", limparArea(comEmpreendimentos, "empreendimentos"), ["painel.servidor"]);
}

// Modelos.
const modelo = (id) => MODELOS.find((item) => item.id === id);
igual("modelo financeiro", aplicarModelo(vazio, "financeiro"), ["financeiro.ver", "financeiro.editar", "empreendimentos.ver"]);
igual("modelo site", aplicarModelo(vazio, "site"), ["site.ver", "site.editar", "contatos.ver", "contatos.editar"]);
igual("modelo campo", aplicarModelo(vazio, "campo"), ["obras.ver", "empreendimentos.ver", "atualizacoes.ver", "atualizacoes.editar"]);
igual("modelo atendimento", aplicarModelo(vazio, "atendimento"), ["clientes.ver", "clientes.editar", "documentos.ver", "documentos.liberar"]);
igual("modelo desconhecido não muda nada", aplicarModelo(selecaoDe(["site.ver"]), "inexistente"), ["site.ver"]);
igual("modelos se somam", aplicarModelo(aplicarModelo(vazio, "financeiro"), "site"), [
  "financeiro.ver", "financeiro.editar", "empreendimentos.ver", "site.ver", "site.editar", "contatos.ver", "contatos.editar",
]);
igual("modelo mantém caixa já marcada fora dele", aplicarModelo(selecaoDe(["painel.servidor"]), "site"), ["painel.servidor", "site.ver", "site.editar", "contatos.ver", "contatos.editar"]);
for (const item of MODELOS) {
  const aplicado = aplicarModelo(vazio, item.id);
  conferir(`modelo ${item.id} contém todas as suas permissões`, item.permissoes.every((permissao) => aplicado.has(permissao)));
  conferir(
    `modelo ${item.id} não deixa permissão sem pré-requisito`,
    paraLista(aplicado).every((permissao) => (PREREQUISITOS[permissao] ?? []).every((prerequisito) => aplicado.has(prerequisito))),
  );
}
conferir("modelo campo existe", modelo("campo") !== undefined);

// Toda seleção montada pelas operações respeita os pré-requisitos, em qualquer ordem.
{
  const valida = (selecao) => paraLista(selecao).every((permissao) => (PREREQUISITOS[permissao] ?? []).every((prerequisito) => selecao.has(prerequisito)));
  let selecao = vazio;
  for (const permissao of PERMISSOES) selecao = marcar(selecao, permissao);
  conferir("marcar tudo é válido", valida(selecao) && selecao.size === PERMISSOES.length);
  for (const permissao of [...PERMISSOES].reverse()) {
    selecao = desmarcar(selecao, permissao);
    conferir(`desmarcar ${permissao} deixa a seleção válida`, valida(selecao));
  }
  conferir("desmarcar tudo esvazia", selecao.size === 0);
}

// paraLista segue a ordem do catálogo; mesmaSelecao compara conteúdo.
conferir("paraLista na ordem do catálogo", paraLista(selecaoDe(["painel.servidor", "site.ver", "site.editar"])).join() === "site.ver,site.editar,painel.servidor");
conferir("mesmaSelecao ignora a ordem", mesmaSelecao(selecaoDe(["site.ver", "site.editar"]), selecaoDe(["site.editar", "site.ver"])));
conferir("mesmaSelecao vê diferença", !mesmaSelecao(selecaoDe(["site.ver"]), selecaoDe(["site.ver", "site.editar"])));

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) falharam de ${verificacoes}.`);
  exit(1);
}
console.log(`OK: ${verificacoes} verificações (cascata nos dois sentidos, áreas, modelos e entradas inválidas).`);
