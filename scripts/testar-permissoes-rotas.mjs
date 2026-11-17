// Varredura estática das rotas e páginas do admin (Etapa 8, contrato §6 e anexo R21). Não precisa do site no ar.
// Falha se uma rota de src/app/api ou uma página/layout de src/app/adm-interno/(protegido) não declarar a regra de acesso.
// Uso: node scripts/testar-permissoes-rotas.mjs. Sai com código 1 se algo falhar.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const MODULOS = resolve(raiz, "src/app/api/(modules)");
const ADMIN_API = resolve(MODULOS, "adm-interno");
const PROTEGIDO = resolve(raiz, "src/app/adm-interno/(protegido)");
const ADMIN_HELPERS = resolve(raiz, "src/lib/portal/andamento/admin.ts");

// Rotas que não declaram regra no handler. Cada uma com o motivo; caminho relativo a src/app/api/(modules)/.
// `prefixo: true` vale para todas as route.ts debaixo da pasta.
const SEM_REGRA_NO_HANDLER = [
  { caminho: "contato/route.ts", motivo: "pública: formulário de contato do site, sem sessão" },
  { caminho: "entrar/route.ts", motivo: "pública: login de cliente, empreiteiro e fornecedor" },
  { caminho: "sair/route.ts", motivo: "pública: encerra a própria sessão" },
  { caminho: "adm-interno/entrar/route.ts", motivo: "pública: login do painel interno (o proxy só deixa passar esta rota sem sessão)" },
  { caminho: "tarefas/limpar-orfaos/route.ts", motivo: "cron: protegida por segredo próprio, sem sessão" },
  { caminho: "conector/v1/", prefixo: true, motivo: "conector do servidor: autenticado pelo token da chave emitida, não por sessão" },
  { caminho: "trocar-senha/route.ts", motivo: "conta própria: qualquer papel troca a própria senha, sem permissão do catálogo" },
  {
    caminho: "portal/documentos/[id]/download/route.ts",
    motivo: "a regra (REGRA_POR_TIPO) é conferida dentro de entregarArquivoPrivado, chamada por service.ts",
    conferir: (falha) => {
      const servico = leitura("src/app/api/(modules)/portal/documentos/[id]/download/service.ts");
      if (!/\bentregarArquivoPrivado\(/.test(semComentarios(servico))) falha("service.ts do download não chama entregarArquivoPrivado");
      const arquivos = semComentarios(leitura("src/lib/portal/comum/arquivos.ts"));
      if (!/dependencias\.autorizar\(\s*[^,]+,\s*REGRA_POR_TIPO\[tipo\]\s*\)/.test(arquivos)) {
        falha("entregarArquivoPrivado não chama autorizar com REGRA_POR_TIPO[tipo]");
      }
    },
  },
  {
    caminho: "portal/documentos/[id]/visualizar/route.ts",
    motivo: "a regra (REGRA_POR_TIPO.documento) é conferida dentro de entregarVisualizacaoDeSimo, chamada por service.ts; só serve documento SIMO",
    conferir: (falha) => {
      const servico = leitura("src/app/api/(modules)/portal/documentos/[id]/visualizar/service.ts");
      if (!/\bentregarVisualizacaoDeSimo\(/.test(semComentarios(servico))) falha("service.ts da visualização não chama entregarVisualizacaoDeSimo");
      const arquivos = semComentarios(leitura("src/lib/portal/comum/arquivos.ts"));
      const inicio = arquivos.indexOf("export async function entregarVisualizacaoDeSimo(");
      const fim = arquivos.indexOf("export async function entregarArquivoPrivado(");
      const corpo = inicio >= 0 && fim > inicio ? arquivos.slice(inicio, fim) : arquivos.slice(Math.max(inicio, 0));
      if (inicio < 0) falha("entregarVisualizacaoDeSimo não existe em arquivos.ts");
      if (!/dependencias\.autorizar\(\s*"download"\s*,\s*REGRA_POR_TIPO\.documento\s*\)/.test(corpo)) {
        falha("entregarVisualizacaoDeSimo não chama autorizar com REGRA_POR_TIPO.documento");
      }
      if (!/"visualizar"/.test(corpo)) falha("entregarVisualizacaoDeSimo não valida o documento como finalidade \"visualizar\" (só SIMO)");
      if (!/dependencias\.registrarDownload\(/.test(corpo)) falha("entregarVisualizacaoDeSimo não registra em downloads_log");
    },
  },
];

const METODOS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const EXIGE_ANTES = [/\blerJsonLimitado\s*\(/, /\.json\s*\(\s*\)/, /\.formData\s*\(/, /\bcreateClient\s*\(/, /\bcreateAdminClient\s*\(/, /\bvalidation\s*\(/];
const PROIBIDOS_NO_ADMIN = /\b(PAPEIS_STAFF|exigirPapelApi|ehStaff)\b/;
const AWAIT_PERMITIDO_ANTES_DA_REGRA = /^(?:\(?\s*)?(?:params|searchParams|prepararAdmin\s*\(\s*\)|exigirPapel\s*\()/;
const CONSULTA_ANTES_DA_REGRA = /\.(?:from|rpc)\s*\(|\bcreateClient\s*\(|\bcreateAdminClient\s*\(/;

const falhas = [];
const avisos = [];
const falhar = (mensagem) => falhas.push(mensagem);
const nome = (caminho) => relative(raiz, caminho).split("\\").join("/");
const leitura = (caminho) => readFileSync(resolve(raiz, caminho), "utf8");

function listar(pasta, aceita, achados = []) {
  if (!existsSync(pasta)) return achados;
  for (const entrada of readdirSync(pasta).sort()) {
    const caminho = join(pasta, entrada);
    if (statSync(caminho).isDirectory()) listar(caminho, aceita, achados);
    else if (aceita(entrada)) achados.push(caminho);
  }
  return achados;
}

// Leitura de texto TypeScript sem executar nada: pula strings, template literals e comentários.
function depoisDoLiteral(texto, i) {
  const aspa = texto[i];
  i += 1;
  while (i < texto.length) {
    const c = texto[i];
    if (c === "\\") i += 2;
    else if (c === aspa) return i + 1;
    else if (aspa === "`" && c === "$" && texto[i + 1] === "{") {
      const fim = depoisDoPar(texto, i + 1, "{", "}");
      i = fim < 0 ? texto.length : fim;
    } else i += 1;
  }
  return texto.length;
}

function depoisDoPar(texto, i, abre, fecha) {
  let profundidade = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (c === "/" && texto[i + 1] === "/") {
      const fim = texto.indexOf("\n", i);
      i = fim < 0 ? texto.length : fim;
    } else if (c === "/" && texto[i + 1] === "*") {
      const fim = texto.indexOf("*/", i + 2);
      i = fim < 0 ? texto.length : fim + 2;
    } else if (c === "'" || c === '"' || c === "`") i = depoisDoLiteral(texto, i);
    else {
      if (c === abre) profundidade += 1;
      else if (c === fecha) {
        profundidade -= 1;
        if (profundidade === 0) return i + 1;
      }
      i += 1;
    }
  }
  return -1;
}

function semComentarios(texto) {
  let saida = "";
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (c === "/" && texto[i + 1] === "/") {
      const fim = texto.indexOf("\n", i);
      i = fim < 0 ? texto.length : fim;
    } else if (c === "/" && texto[i + 1] === "*") {
      const fim = texto.indexOf("*/", i + 2);
      i = fim < 0 ? texto.length : fim + 2;
    } else if (c === "'" || c === '"' || c === "`") {
      const fim = depoisDoLiteral(texto, i);
      saida += texto.slice(i, fim);
      i = fim;
    } else {
      saida += c;
      i += 1;
    }
  }
  return saida;
}

function dividirArgumentos(texto) {
  const argumentos = [];
  let inicio = 0;
  let profundidade = 0;
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (c === "'" || c === '"' || c === "`") {
      i = depoisDoLiteral(texto, i);
      continue;
    }
    if ("([{".includes(c)) profundidade += 1;
    else if (")]}".includes(c)) profundidade -= 1;
    else if (c === "," && profundidade === 0) {
      argumentos.push(texto.slice(inicio, i).trim());
      inicio = i + 1;
    }
    i += 1;
  }
  argumentos.push(texto.slice(inicio).trim());
  return argumentos.length > 0 && argumentos.at(-1) === "" ? argumentos.slice(0, -1) : argumentos;
}

function chamadas(texto, funcao) {
  const resultado = [];
  for (const achado of texto.matchAll(new RegExp(`\\b${funcao}\\s*\\(`, "g"))) {
    const abre = achado.index + achado[0].length - 1;
    const fim = depoisDoPar(texto, abre, "(", ")");
    if (fim < 0) continue;
    resultado.push({ indice: achado.index, argumentos: dividirArgumentos(texto.slice(abre + 1, fim - 1)) });
  }
  return resultado;
}

const linhaDe = (texto, indice) => texto.slice(0, indice).split("\n").length;

function extrairHandlers(texto) {
  const handlers = [];
  const problemas = [];
  const padraoMetodos = METODOS.join("|");
  for (const achado of texto.matchAll(new RegExp(`export\\s+(?:async\\s+)?function\\s+(${padraoMetodos})\\s*\\(`, "g"))) {
    const abreParametros = achado.index + achado[0].length - 1;
    const fimParametros = depoisDoPar(texto, abreParametros, "(", ")");
    const abreCorpo = fimParametros < 0 ? -1 : texto.indexOf("{", fimParametros);
    const fimCorpo = abreCorpo < 0 ? -1 : depoisDoPar(texto, abreCorpo, "{", "}");
    if (fimCorpo < 0) {
      problemas.push(`não consegui ler o corpo de ${achado[1]}`);
      continue;
    }
    handlers.push({ metodo: achado[1], corpo: texto.slice(abreCorpo, fimCorpo), linha: linhaDe(texto, achado.index) });
  }
  for (const achado of texto.matchAll(new RegExp(`export\\s+const\\s+(${padraoMetodos})\\b`, "g"))) {
    problemas.push(`${achado[1]} exportado como const: forma que esta varredura não lê (use function)`);
  }
  if (/export\s*\{/.test(texto) || /export\s*\*\s*from/.test(texto)) problemas.push("re-exporta handlers: forma que esta varredura não lê");
  return { handlers, problemas };
}

// Devolve a posição da primeira regra válida do handler ou um motivo.
function regraDoHandler(corpo) {
  const achadas = [];
  const motivos = [];
  for (const chamada of chamadas(corpo, "autorizarPortal")) {
    if (chamada.argumentos.length === 2 && chamada.argumentos.every((argumento) => argumento !== "")) achadas.push(chamada);
    else motivos.push("autorizarPortal precisa de dois argumentos (ação e regra)");
  }
  for (const funcao of ["autorizarConteudo", "exigirRegraApi"]) {
    for (const chamada of chamadas(corpo, funcao)) {
      if (chamada.argumentos.length >= 1 && chamada.argumentos[0] !== "") achadas.push(chamada);
      else motivos.push(`${funcao} precisa de um argumento (a regra)`);
    }
  }
  const legados = achadas.filter((chamada) => chamada.argumentos.some((argumento) => /PAPEIS_STAFF/.test(argumento)));
  if (legados.length > 0) motivos.push("a regra usa PAPEIS_STAFF");
  const validas = achadas.filter((chamada) => !legados.includes(chamada));
  return validas.length > 0 ? { indice: Math.min(...validas.map((chamada) => chamada.indice)) } : { motivo: motivos[0] ?? "nenhum autorizarPortal(acao, regra), autorizarConteudo(regra) ou exigirRegraApi(regra)" };
}

let rotasTotal = 0;
let rotasComRegra = 0;
let rotasListadas = 0;
let handlersCobertos = 0;
const resultadoPorRota = new Map();

// ---------------------------------------------------------------- Rotas
const rotas = listar(resolve(raiz, "src/app/api"), (arquivo) => arquivo === "route.ts");
const caminhoDaLista = (item) => resolve(MODULOS, item.caminho);

for (const item of SEM_REGRA_NO_HANDLER) {
  const caminho = caminhoDaLista(item);
  if (item.prefixo) {
    if (!rotas.some((rota) => rota.startsWith(caminho))) falhar(`lista explícita: ${item.caminho} não tem nenhuma route.ts em disco (${item.motivo})`);
  } else if (!existsSync(caminho)) {
    falhar(`lista explícita: ${item.caminho} não existe mais em disco (${item.motivo})`);
  }
  item.conferir?.((mensagem) => falhar(`lista explícita: ${item.caminho}: ${mensagem}`));
}
const naLista = (rota) => SEM_REGRA_NO_HANDLER.find((item) => (item.prefixo ? rota.startsWith(caminhoDaLista(item)) : rota === caminhoDaLista(item)));

for (const rota of rotas) {
  rotasTotal += 1;
  const texto = semComentarios(readFileSync(rota, "utf8"));
  const { handlers, problemas } = extrairHandlers(texto);
  const resultados = [];
  resultadoPorRota.set(rota, resultados);
  if (naLista(rota)) {
    rotasListadas += 1;
    continue;
  }
  for (const problema of problemas) falhar(`${nome(rota)}: ${problema}`);
  if (handlers.length === 0) falhar(`${nome(rota)}: nenhum handler GET, POST, PUT, PATCH ou DELETE exportado`);
  let todosOk = handlers.length > 0 && problemas.length === 0;
  for (const handler of handlers) {
    const regra = regraDoHandler(handler.corpo);
    if (regra.motivo) {
      resultados.push(false);
      todosOk = false;
      falhar(`${nome(rota)}:${handler.linha} ${handler.metodo}: ${regra.motivo}`);
      continue;
    }
    const antes = EXIGE_ANTES.flatMap((padrao) => {
      const achado = padrao.exec(handler.corpo);
      return achado && achado.index < regra.indice ? [achado[0]] : [];
    });
    if (antes.length > 0) {
      resultados.push(false);
      todosOk = false;
      falhar(`${nome(rota)}:${handler.linha} ${handler.metodo}: a regra vem depois de ${antes[0].trim()}`);
      continue;
    }
    resultados.push(true);
    handlersCobertos += 1;
  }
  if (todosOk) rotasComRegra += 1;
}

// ---------------------------------------------------------------- Rotas com regra fixa
// O lote de documentos muda liberado_cliente: pede documentos.liberar, e documentos.editar sozinho não basta.
// `regras` lista, por método, a regra exata; a rota não pode ter nenhum outro handler.
const ROTAS_COM_REGRA_FIXA = [
  { caminho: "adm-interno/portal/documentos/lote/route.ts", regras: { POST: '"documentos.liberar"' } },
  // A ordem dos projetos é o que o cliente vê: gravar pede empreendimentos.editar, e empreendimentos.ver não basta.
  { caminho: "adm-interno/portal/projetos/ordem/route.ts", regras: { POST: "'empreendimentos.editar'" } },
  // Montar a partir do servidor: a pré-visualização pede servidor.regras; criar pede empreendimentos.editar na rota e
  // servidor.regras no serviço (RegraAcesso não tem "todas"), e o banco confere as duas de novo.
  { caminho: "adm-interno/portal/pasta-montagem/route.ts", regras: { GET: '"servidor.regras"', POST: '"empreendimentos.editar"' } },
  { caminho: "adm-interno/portal/pasta-montagem/complementares/route.ts", regras: { PATCH: '"empreendimentos.editar"' } },
  // O catálogo muda o que a montagem sugere em todos os empreendimentos: só o admin lê e edita.
  { caminho: "adm-interno/portal/catalogo-pastas/route.ts", regras: { GET: '"so-admin"', PATCH: '"so-admin"' } },
  // Etapas pelas pastas: mudam a etapa que o cliente vê, então confirmar, ignorar, desfazer, aplicar o recálculo e mudar o
  // modo pedem empreendimentos.editar (o Automático é só do admin: o serviço e o gatilho do banco conferem). Só a
  // consulta do recálculo é de leitura. Todas usam a sessão de quem clicou, nunca a secret key.
  { caminho: "adm-interno/portal/etapas-automaticas/modo/route.ts", regras: { PATCH: '"empreendimentos.editar"' } },
  { caminho: "adm-interno/portal/etapas-automaticas/confirmar/route.ts", regras: { POST: '"empreendimentos.editar"' } },
  { caminho: "adm-interno/portal/etapas-automaticas/ignorar/route.ts", regras: { POST: '"empreendimentos.editar"' } },
  { caminho: "adm-interno/portal/etapas-automaticas/desfazer/route.ts", regras: { POST: '"empreendimentos.editar"' } },
  { caminho: "adm-interno/portal/etapas-automaticas/recalculo/route.ts", regras: { GET: '"empreendimentos.ver"', POST: '"empreendimentos.editar"' } },
];
for (const item of ROTAS_COM_REGRA_FIXA) {
  const caminho = caminhoDaLista(item);
  if (!existsSync(caminho)) {
    falhar(`regra fixa: ${item.caminho} não existe em disco`);
    continue;
  }
  const { handlers } = extrairHandlers(semComentarios(readFileSync(caminho, "utf8")));
  const achadas = handlers.flatMap((handler) => chamadas(handler.corpo, "autorizarPortal").map((chamada) => `${handler.metodo} ${chamada.argumentos[1]}`)).sort();
  const esperadas = Object.entries(item.regras).map(([metodo, regra]) => `${metodo} ${regra}`).sort();
  if (handlers.length !== esperadas.length || achadas.length !== esperadas.length || achadas.some((achada, i) => achada !== esperadas[i])) {
    falhar(`regra fixa: ${item.caminho} deveria ter só [${esperadas.join(", ")}] em autorizarPortal; achei [${achadas.join(", ")}]`);
  }
}

// O serviço de pasta-montagem precisa conferir servidor.regras: sem isso a rota POST (só empreendimentos.editar) abriria a montagem.
{
  const servico = semComentarios(readFileSync(resolve(MODULOS, "adm-interno/portal/pasta-montagem/service.ts"), "utf8"));
  if (!/permissoes\.has\(\s*["']servidor\.regras["']\s*\)/.test(servico)) falhar("pasta-montagem/service.ts não confere servidor.regras antes de montar");
  // A função nasceu em 20261111100000 e foi recriada em 20261113100000 (pastas de arquivo): as duas versões valem o mesmo.
  for (const arquivoSql of ["20261111100000_modelo_pastas.sql", "20261113100000_pastas_ses_arquivo.sql"]) {
    const migration = readFileSync(resolve(raiz, "supabase/migrations", arquivoSql), "utf8");
    const inicio = migration.indexOf("function public.montar_empreendimento_de_pastas");
    if (inicio < 0) falhar(`${arquivoSql}: não define montar_empreendimento_de_pastas`);
    const funcao = migration.slice(Math.max(inicio, 0));
    if (!/tem_permissao\('empreendimentos\.editar'\)[\s\S]{0,200}tem_permissao\('servidor\.regras'\)/.test(funcao)) falhar(`${arquivoSql}: montar_empreendimento_de_pastas não confere as duas permissões`);
    if (/security\s+definer/i.test(funcao)) falhar(`${arquivoSql}: montar_empreendimento_de_pastas não pode ser security definer`);
  }
}

// ---------------------------------------------------------------- Admin: papel antigo como autorização
const arquivosDoAdmin = listar(ADMIN_API, (arquivo) => arquivo === "route.ts" || arquivo === "service.ts");
for (const arquivo of arquivosDoAdmin) {
  if (arquivo.startsWith(resolve(ADMIN_API, "entrar"))) continue; // é o login: confere o papel de quem entra
  const texto = semComentarios(readFileSync(arquivo, "utf8"));
  const achado = PROIBIDOS_NO_ADMIN.exec(texto);
  if (achado) falhar(`${nome(arquivo)}:${linhaDe(texto, achado.index)}: ${achado[1]} como autorização (use autorizarPortal/autorizarConteudo com a regra)`);
}

// ---------------------------------------------------------------- Admin: secret key só atrás de rota com regra
const usaSecretKey = listar(ADMIN_API, (arquivo) => arquivo.endsWith(".ts") && arquivo !== "route.ts")
  .filter((arquivo) => /\bcreateAdminClient\b/.test(semComentarios(readFileSync(arquivo, "utf8"))));
for (const arquivo of usaSecretKey) {
  const pasta = resolve(arquivo, "..");
  const vizinhas = rotas.filter((rota) => rota === resolve(pasta, "route.ts"));
  const alvo = vizinhas.length > 0 ? vizinhas : rotas.filter((rota) => rota.startsWith(`${pasta}\\`) || rota.startsWith(`${pasta}/`));
  if (alvo.length === 0) {
    falhar(`${nome(arquivo)}: usa createAdminClient e não há route.ts na pasta nem abaixo dela`);
    continue;
  }
  for (const rota of alvo) {
    const resultados = resultadoPorRota.get(rota) ?? [];
    if (resultados.length === 0 || resultados.some((ok) => !ok)) falhar(`${nome(arquivo)}: usa createAdminClient e ${nome(rota)} não declara regra em todos os handlers`);
  }
}

// ---------------------------------------------------------------- Páginas e layouts
const admin = semComentarios(readFileSync(ADMIN_HELPERS, "utf8"));
const delegaParaARegra = /export\s+async\s+function\s+prepararAdminComRegra\s*\(\s*regra\b[^)]*\)\s*\{[\s\S]*?\bexigirRegraPagina\s*\(\s*regra\s*\)/.test(admin);
if (!delegaParaARegra) falhar(`${nome(ADMIN_HELPERS)}: prepararAdminComRegra não repassa a regra para exigirRegraPagina`);
if (!/export\s+async\s+function\s+prepararAdmin\s*\(/.test(admin)) avisos.push("prepararAdmin deixou de existir: o aviso sobre ele pode sair deste script");

const GUARDAS_DE_PAGINA = [
  { funcao: "exigirRegraPagina", precisaArgumento: true },
  { funcao: "exigirContaInterna", precisaArgumento: false },
  { funcao: "prepararAdminComRegra", precisaArgumento: true },
];
const paginas = listar(PROTEGIDO, (arquivo) => arquivo === "page.tsx" || arquivo === "layout.tsx");
let paginasContadas = 0;
let layoutsContados = 0;
const usaPrepararAdmin = [];

for (const arquivo of paginas) {
  const texto = semComentarios(readFileSync(arquivo, "utf8"));
  const ehLayout = arquivo.endsWith("layout.tsx");
  const guardas = GUARDAS_DE_PAGINA.flatMap(({ funcao, precisaArgumento }) =>
    chamadas(texto, funcao).filter((chamada) => !precisaArgumento || (chamada.argumentos.length >= 1 && chamada.argumentos[0] !== "")));
  if (chamadas(texto, "prepararAdmin").length > 0) usaPrepararAdmin.push(nome(arquivo));

  const exportacao = /export\s+default\s+(?:async\s+)?function\s*\w*\s*\(/.exec(texto);
  if (!exportacao) {
    falhar(`${nome(arquivo)}: sem export default function para conferir`);
    continue;
  }
  if (guardas.length === 0) {
    const apenasPapel = chamadas(texto, "prepararAdmin").length > 0 ? " (prepararAdmin só confere o papel, não a permissão)" : "";
    falhar(`${nome(arquivo)}: não chama exigirRegraPagina, exigirContaInterna nem prepararAdminComRegra${apenasPapel}`);
    continue;
  }
  const abreParametros = exportacao.index + exportacao[0].length - 1;
  const fimParametros = depoisDoPar(texto, abreParametros, "(", ")");
  const inicioCorpo = fimParametros < 0 ? -1 : texto.indexOf("{", fimParametros);
  // generateMetadata e afins ficam fora do componente e podem repetir a regra; só vale a chamada dentro dele.
  const dentroDoComponente = guardas.filter((chamada) => inicioCorpo >= 0 && chamada.indice > inicioCorpo);
  if (dentroDoComponente.length === 0) {
    falhar(`${nome(arquivo)}: a regra deve ser chamada dentro do componente da ${ehLayout ? "layout" : "página"}`);
    continue;
  }
  const primeira = Math.min(...dentroDoComponente.map((chamada) => chamada.indice));
  const antes = texto.slice(inicioCorpo, primeira).replace(/\bawait\s*$/, "");
  const consulta = CONSULTA_ANTES_DA_REGRA.exec(antes);
  if (consulta) falhar(`${nome(arquivo)}:${linhaDe(texto, inicioCorpo + consulta.index)}: consulta (${consulta[0].trim()}) antes da regra`);
  for (const achado of antes.matchAll(/\bawait\s+([^;\n]*)/g)) {
    if (!AWAIT_PERMITIDO_ANTES_DA_REGRA.test(achado[1])) {
      falhar(`${nome(arquivo)}:${linhaDe(texto, inicioCorpo + achado.index)}: await antes da regra (${achado[0].trim().slice(0, 60)})`);
    }
  }
  if (ehLayout) layoutsContados += 1;
  else paginasContadas += 1;
}

if (usaPrepararAdmin.length > 0) {
  avisos.push(
    `prepararAdmin (src/lib/portal/andamento/admin.ts) só confere que a conta é interna, sem permissão. Está em ${usaPrepararAdmin.length} página(s) que também chamam exigirRegraPagina, por isso passam: ${usaPrepararAdmin.join(", ")}. Uma página nova só com ele falha aqui.`,
  );
}

// ---------------------------------------------------------------- Resultado
for (const aviso of avisos) console.log(`AVISO: ${aviso}`);
if (falhas.length > 0) {
  for (const falha of falhas) console.error(`FALHA: ${falha}`);
  console.error(`\n${falhas.length} problema(s) na varredura de rotas e páginas.`);
  exit(1);
}
console.log(
  `OK: ${rotasTotal} rotas (${rotasComRegra} com regra em todos os handlers, ${rotasListadas} na lista explícita), ` +
    `${handlersCobertos} handlers com regra declarada antes de ler o corpo ou abrir o banco, ` +
    `${paginasContadas} páginas e ${layoutsContados} layouts do admin com regra antes de qualquer consulta, ` +
    `${usaSecretKey.length} arquivo(s) com createAdminClient sob adm-interno atrás de rota com regra.`,
);
