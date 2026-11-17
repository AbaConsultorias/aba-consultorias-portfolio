// Confere regraPermite (src/lib/auth/regras.ts), o núcleo das regras de acesso do admin (Etapa 8, contrato §4):
// permissão, "so-admin", { qualquer }, { externos } e o que nunca vale para conta externa.
// Uso: node scripts/testar-regras-acesso.mjs. Sai com código 1 se algo falhar.
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

// regras.ts importa "./papeis" sem extensão (o tsc exige assim): este carregador transpila os .ts e resolve esse import.
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

const { PERMISSOES } = carregar(resolve(raiz, "src/lib/auth/permissoes.ts"));
const { regraPermite } = carregar(resolve(raiz, "src/lib/auth/regras.ts"));

let falhas = 0;
let verificacoes = 0;

function conferir(caso, condicao, detalhe = "") {
  verificacoes += 1;
  if (condicao) return;
  falhas += 1;
  console.error(`FALHA [${caso}]${detalhe ? `: ${detalhe}` : ""}`);
}

const EXTERNOS = ["cliente", "empreiteiro", "fornecedor"];
const INTERNOS = ["admin", "equipe"];
const conjunto = (...lista) => new Set(lista);
const todas = new Set(PERMISSOES);
const vazio = new Set();

function permite(caso, esperado, regra, papel, permissoes) {
  const veio = regraPermite(regra, papel, permissoes);
  conferir(`${caso}: ${papel}`, veio === esperado, `regra ${JSON.stringify(regra)} com [${[...permissoes].join(", ")}]: esperado ${esperado}, veio ${veio}`);
}

// Permissão presente e ausente.
conferir("o catálogo tem as 24 permissões", PERMISSOES.length === 24, String(PERMISSOES.length));
for (const permissao of PERMISSOES) {
  permite(`${permissao} presente`, true, permissao, "equipe", conjunto(permissao));
  permite(`${permissao} presente entre outras`, true, permissao, "equipe", todas);
  permite(`${permissao} ausente`, false, permissao, "equipe", vazio);
  permite(`${permissao} ausente entre outras`, false, permissao, "equipe", new Set(PERMISSOES.filter((outra) => outra !== permissao)));
  permite(`${permissao} do admin com o conjunto completo`, true, permissao, "admin", todas);
  // A regra olha só o conjunto: o banco entrega as 22 ao admin, e conjunto vazio nega até o admin.
  permite(`${permissao} do admin com conjunto vazio (erro na leitura)`, false, permissao, "admin", vazio);
}
// Cada permissão abre só ela mesma: "editar" não vale por "ver", nem o contrário.
for (const permissao of PERMISSOES) {
  const abre = PERMISSOES.filter((regra) => regraPermite(regra, "equipe", conjunto(permissao)));
  conferir(`só ${permissao} abre ${permissao}`, abre.length === 1 && abre[0] === permissao, abre.join(", "));
}

// "so-admin": admin, nunca equipe (nem com todas as permissões) nem externos.
permite("so-admin", true, "so-admin", "admin", vazio);
permite("so-admin com as 22", true, "so-admin", "admin", todas);
permite("so-admin com todas as permissões", false, "so-admin", "equipe", todas);
permite("so-admin com conjunto vazio", false, "so-admin", "equipe", vazio);
for (const externo of EXTERNOS) {
  permite("so-admin", false, "so-admin", externo, vazio);
  permite("so-admin com as 22 no conjunto", false, "so-admin", externo, todas);
}

// { qualquer }: basta uma; vazio nega todos, inclusive o admin.
{
  const regra = { qualquer: ["site.ver", "contatos.ver"] };
  permite("qualquer: tem a primeira", true, regra, "equipe", conjunto("site.ver"));
  permite("qualquer: tem a segunda", true, regra, "equipe", conjunto("contatos.ver"));
  permite("qualquer: tem as duas", true, regra, "equipe", conjunto("site.ver", "contatos.ver"));
  permite("qualquer: tem só o editar de uma", false, regra, "equipe", conjunto("site.editar"));
  permite("qualquer: tem outras", false, regra, "equipe", conjunto("financeiro.ver", "obras.ver"));
  permite("qualquer: conjunto vazio", false, regra, "equipe", vazio);
  permite("qualquer: admin com as 22", true, regra, "admin", todas);
  permite("qualquer: admin sem nada no conjunto", false, regra, "admin", vazio);
  for (const externo of EXTERNOS) permite("qualquer: externo com as 22", false, regra, externo, todas);

  const regraVazia = { qualquer: [] };
  for (const papel of INTERNOS) {
    permite("qualquer vazio com as 22", false, regraVazia, papel, todas);
    permite("qualquer vazio com conjunto vazio", false, regraVazia, papel, vazio);
  }
  for (const externo of EXTERNOS) permite("qualquer vazio", false, regraVazia, externo, todas);

  const regraDocumentos = { qualquer: ["documentos.editar", "documentos.liberar"] };
  permite("qualquer documentos: só liberar", true, regraDocumentos, "equipe", conjunto("documentos.ver", "documentos.liberar"));
  permite("qualquer documentos: só editar", true, regraDocumentos, "equipe", conjunto("documentos.ver", "documentos.editar"));
  permite("qualquer documentos: só ver", false, regraDocumentos, "equipe", conjunto("documentos.ver"));
}

// { externos }: os papéis listados passam sem permissão; interna só vale se existir e permitir.
{
  const soExternos = { externos: ["cliente"] };
  permite("externos: cliente listado", true, soExternos, "cliente", vazio);
  permite("externos: empreiteiro não listado", false, soExternos, "empreiteiro", todas);
  permite("externos: fornecedor não listado", false, soExternos, "fornecedor", todas);
  permite("externos sem interna: equipe com as 22", false, soExternos, "equipe", todas);
  permite("externos sem interna: admin com as 22", false, soExternos, "admin", todas);

  const comInterna = { externos: ["cliente", "empreiteiro"], interna: "obras.ver" };
  permite("externos+interna: cliente", true, comInterna, "cliente", vazio);
  permite("externos+interna: empreiteiro", true, comInterna, "empreiteiro", vazio);
  permite("externos+interna: fornecedor não listado, mesmo com a permissão", false, comInterna, "fornecedor", conjunto("obras.ver"));
  permite("externos+interna: equipe com a permissão", true, comInterna, "equipe", conjunto("obras.ver"));
  permite("externos+interna: equipe sem a permissão", false, comInterna, "equipe", conjunto("documentos.ver"));
  permite("externos+interna: equipe com conjunto vazio", false, comInterna, "equipe", vazio);
  permite("externos+interna: admin com as 22", true, comInterna, "admin", todas);

  const comAdmin = { externos: ["fornecedor"], interna: "so-admin" };
  permite("externos+so-admin: admin", true, comAdmin, "admin", vazio);
  permite("externos+so-admin: equipe com as 22", false, comAdmin, "equipe", todas);
  permite("externos+so-admin: fornecedor", true, comAdmin, "fornecedor", vazio);
  permite("externos+so-admin: cliente", false, comAdmin, "cliente", todas);

  const comQualquer = { externos: ["cliente"], interna: { qualquer: ["fornecedores.ver", "obras.ver"] } };
  permite("externos+qualquer: equipe com uma", true, comQualquer, "equipe", conjunto("obras.ver"));
  permite("externos+qualquer: equipe sem nenhuma", false, comQualquer, "equipe", conjunto("clientes.ver"));
  permite("externos+qualquer: empreiteiro com a permissão no conjunto", false, comQualquer, "empreiteiro", conjunto("obras.ver"));

  const listaVazia = { externos: [] };
  for (const papel of [...INTERNOS, ...EXTERNOS]) permite("externos vazio sem interna", false, listaVazia, papel, todas);
  permite("externos vazio com interna: equipe", true, { externos: [], interna: "site.ver" }, "equipe", conjunto("site.ver"));
  permite("externos vazio com interna: cliente", false, { externos: [], interna: "site.ver" }, "cliente", conjunto("site.ver"));

  // As regras de download de src/lib/portal/comum/arquivos.ts.
  const REGRAS_DE_DOWNLOAD = {
    documento: [{ externos: ["cliente"], interna: "documentos.ver" }, ["cliente"], "documentos.ver"],
    atualizacao_foto: [{ externos: ["cliente"], interna: "atualizacoes.ver" }, ["cliente"], "atualizacoes.ver"],
    relato_foto: [{ externos: ["cliente", "empreiteiro"], interna: "obras.ver" }, ["cliente", "empreiteiro"], "obras.ver"],
    fornecedor_documento: [{ externos: ["fornecedor"], interna: "fornecedores.ver" }, ["fornecedor"], "fornecedores.ver"],
    fornecedor_contrato: [{ externos: ["fornecedor"], interna: "fornecedores.ver" }, ["fornecedor"], "fornecedores.ver"],
  };
  for (const [tipo, [regra, externosLiberados, permissaoInterna]] of Object.entries(REGRAS_DE_DOWNLOAD)) {
    for (const externo of EXTERNOS) permite(`download ${tipo}`, externosLiberados.includes(externo), regra, externo, todas);
    permite(`download ${tipo}: equipe com a permissão`, true, regra, "equipe", conjunto(permissaoInterna));
    permite(`download ${tipo}: equipe com as outras 21`, false, regra, "equipe", new Set(PERMISSOES.filter((p) => p !== permissaoInterna)));
    permite(`download ${tipo}: equipe sem nada`, false, regra, "equipe", vazio);
  }
}

// Externo nunca passa em regra interna, mesmo com permissões no conjunto.
{
  const regrasInternas = [...PERMISSOES, "so-admin", { qualquer: PERMISSOES }, { qualquer: ["site.ver"] }, { qualquer: [] }];
  for (const externo of EXTERNOS) {
    for (const regra of regrasInternas) {
      permite("externo em regra interna, com as 22", false, regra, externo, todas);
      permite("externo em regra interna, sem permissões", false, regra, externo, vazio);
    }
  }
}

// Equipe com conjunto vazio nega tudo; só o que é do papel (so-admin) segue sendo do admin.
{
  const regras = [...PERMISSOES, "so-admin", { qualquer: PERMISSOES }, { qualquer: [] }, { externos: ["cliente"] }, { externos: ["cliente"], interna: "site.ver" }];
  for (const regra of regras) permite("equipe sem permissões", false, regra, "equipe", vazio);
  permite("admin continua em so-admin sem permissões", true, "so-admin", "admin", vazio);
}

// Papel desconhecido (dado corrompido) nega, e a lista de externos não o aceita por engano.
permite("papel desconhecido em permissão", false, "site.ver", "visitante", todas);
permite("papel desconhecido em so-admin", false, "so-admin", "visitante", todas);
permite("papel desconhecido em qualquer", false, { qualquer: ["site.ver"] }, "visitante", todas);
permite("papel desconhecido em externos", false, { externos: ["cliente"], interna: "site.ver" }, "visitante", todas);

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) falharam de ${verificacoes}.`);
  exit(1);
}
console.log(`OK: ${verificacoes} verificações das regras de acesso (permissão, so-admin, qualquer, externos e papéis externos).`);
