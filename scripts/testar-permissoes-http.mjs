// Matriz de permissões por HTTP contra o site local (Etapa 8, contrato §7): cada conta × cada método de cada rota do
// admin, e cada conta × cada página do admin. A tabela de regras abaixo foi escrita à mão a partir do anexo
// (docs/ETAPA-8-ANEXO-LEVANTAMENTO.md) e das suas resoluções R1 a R30, sem ler o código das rotas: se uma rota
// trocar de regra, o teste aponta a divergência.
// Uso, com o site rodando em localhost:3000: node --env-file=.env scripts/testar-permissoes-http.mjs
// Só as páginas: PAGINAS=1 (padrão). Sem páginas: PAGINAS=0.
//
// O site local usa o banco de produção, então este teste NÃO PODE GRAVAR NADA além das contas temporárias ("Teste E8 ...",
// apagadas no fim, mesmo se algo falhar; senha só na memória deste processo):
//  - todo id de rota ou de consulta é um UUID que não existe;
//  - todo corpo de POST, PUT e PATCH é inválido de propósito ({}), para o guard decidir e a validação parar;
//  - DELETE leva sempre um UUID que não existe;
//  - a linha marcada { perigosa: true } (agiria mesmo com corpo inválido) só é chamada por conta que deve ser negada, nunca
//    pelo admin, e só depois de confirmar no texto da rota que a primeira instrução do handler é autorizarPortal(_, "so-admin").
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";
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

const { PERMISSOES, comPrerequisitos } = carregar(resolve(raiz, "src/lib/auth/permissoes.ts"));
const { regraPermite } = carregar(resolve(raiz, "src/lib/auth/regras.ts"));

const BASE = "http://localhost:3000";
const adminPath = process.env.ADMIN_PATH;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (new URL(BASE).hostname !== "localhost") {
  console.error("Este teste só roda contra localhost.");
  exit(1);
}
if (!adminPath || !url || !secretKey) {
  console.error("Faltam ADMIN_PATH, NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY.");
  exit(1);
}
const COM_PAGINAS = process.env.PAGINAS !== "0";
const CONCORRENCIA = 6;
const MAXIMO_DIVERGENCIAS = 60;

const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const sufixo = randomBytes(6).toString("hex");
const criados = new Set();
const divergencias = [];
const avisos = [];
const dormir = (ms) => new Promise((concluir) => setTimeout(concluir, ms));

// ---------------------------------------------------------------- Sessões HTTP
const novoIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;

function novaSessao() {
  const cookies = new Map();
  // Os limites de IP do login e da API valem por IP; cada sessão de teste simula um IP próprio e o troca a cada 100 chamadas.
  let ip = novoIp();
  let usos = 0;
  return async function chamar(caminho, { metodo = "GET", corpo } = {}) {
    usos += 1;
    if (usos % 100 === 0) ip = novoIp();
    const resposta = await fetch(`${BASE}${caminho}`, {
      method: metodo,
      redirect: "manual",
      headers: {
        Origin: BASE,
        "x-real-ip": ip,
        ...(corpo === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    for (const linha of resposta.headers.getSetCookie()) {
      const [par] = linha.split(";");
      const i = par.indexOf("=");
      const valor = par.slice(i + 1);
      if (valor) cookies.set(par.slice(0, i), valor);
      else cookies.delete(par.slice(0, i));
    }
    const texto = await resposta.text();
    let json = null;
    try {
      json = JSON.parse(texto);
    } catch {
      // Página HTML: fica só o status e o texto.
    }
    return { status: resposta.status, json, texto, cabecalhos: resposta.headers };
  };
}

// 429 nunca conta como aprovado: espera e repete; se persistir, devolve o 429 e a linha vira divergência.
async function chamarComEspera(chamar, caminho, opcoes) {
  for (let tentativa = 0; ; tentativa += 1) {
    const resposta = await chamar(caminho, opcoes);
    if (resposta.status !== 429 || tentativa >= 6) return resposta;
    const aviso = Number(resposta.cabecalhos.get("retry-after"));
    await dormir((Number.isFinite(aviso) && aviso > 0 ? Math.min(aviso, 65) : 20) * 1000);
  }
}

// ---------------------------------------------------------------- Contas
async function criarConta(papel, rotulo) {
  const email = `e8p-${papel}-${sufixo}-${randomBytes(3).toString("hex")}@example.com`;
  const senha = `${randomBytes(18).toString("base64url")}aA1`;
  const { data, error } = await supabase.auth.admin.createUser({ email, password: senha, email_confirm: true });
  if (error) throw new Error(`createUser: ${error.code}`);
  criados.add(data.user.id);
  const perfil = await supabase.from("profiles").insert({ id: data.user.id, papel, nome: `Teste E8 ${rotulo}`, precisa_trocar_senha: false });
  if (perfil.error) throw new Error(`perfil: ${perfil.error.code}`);
  return { id: data.user.id, email, senha, papel, rotulo };
}

// Staff entra pelo caminho do admin; cliente, empreiteiro e fornecedor, pelo login público.
async function entrar(conta) {
  const chamar = novaSessao();
  const resposta = conta.papel === "admin" || conta.papel === "equipe"
    ? await chamar(`/${adminPath}/api/entrar`, { metodo: "POST", corpo: { email: conta.email, senha: conta.senha } })
    : await chamar("/api/entrar", { metodo: "POST", corpo: { identificador: conta.email, senha: conta.senha } });
  if (resposta.status !== 200) throw new Error(`login de "${conta.rotulo}": ${resposta.status}`);
  conta.chamar = chamar;
}

// ---------------------------------------------------------------- Tabela de rotas (à mão, do anexo e das resoluções)
const INEXISTENTE = "7e570000-e8e8-4e8e-8e8e-000000000001";
const INEXISTENTE_2 = "7e570000-e8e8-4e8e-8e8e-000000000002";
const R_CONECTOR = "src/app/api/(modules)/adm-interno/portal/conector/route.ts";

const linhas = [];
const rota = (metodo, caminho, regra, corpo, extra = {}) => linhas.push({ metodo, caminho, regra, corpo, ...extra });
const PORTAL = "portal";

// Conteúdo do site (anexo Parte A §2): ver lê, editar escreve. Contatos têm permissão própria (D1).
for (const nomeRota of ["banners", "depoimentos", "parceiros", "projetos", "servicos", "videos", "midias-projeto"]) {
  rota("GET", `conteudo/${nomeRota}`, "site.ver");
  rota("PATCH", `conteudo/${nomeRota}`, "site.editar", {});
  rota("POST", `conteudo/${nomeRota}`, "site.editar", {});
  rota("DELETE", `conteudo/${nomeRota}`, "site.editar", { id: INEXISTENTE });
}
rota("GET", "conteudo/configuracoes", "site.ver");
rota("PATCH", "conteudo/configuracoes", "site.editar", {});
rota("GET", "conteudo/contatos", "contatos.ver");
rota("PATCH", "conteudo/contatos", "contatos.editar", {});
rota("POST", "conteudo/loteamentos", "site.editar", {});
rota("PUT", "conteudo/loteamentos/ordem", "site.editar", {});
rota("PATCH", `conteudo/loteamentos/${INEXISTENTE}`, "site.editar", {});
rota("DELETE", `conteudo/loteamentos/${INEXISTENTE}`, "site.editar");
rota("POST", `conteudo/loteamentos/${INEXISTENTE}/midias`, "site.editar", {});
rota("PUT", `conteudo/loteamentos/${INEXISTENTE}/midias`, "site.editar", {});
rota("PATCH", `conteudo/loteamentos/${INEXISTENTE}/midias/${INEXISTENTE_2}`, "site.editar", {});
rota("DELETE", `conteudo/loteamentos/${INEXISTENTE}/midias/${INEXISTENTE_2}`, "site.editar");
rota("POST", "conteudo/lotes", "site.editar", {});
rota("POST", "conteudo/lotes/massa", "site.editar", {});
rota("PATCH", `conteudo/lotes/${INEXISTENTE}`, "site.editar", {});
rota("DELETE", `conteudo/lotes/${INEXISTENTE}`, "site.editar");
// R18: assinar e confirmar exigem editar. upload (SVG do mapa) vai em multipart; o corpo JSON vazio para na leitura do formulário.
rota("POST", "conteudo/upload/assinar", "site.editar", {});
rota("POST", "conteudo/upload/confirmar", "site.editar", {});
rota("POST", "conteudo/upload", "site.editar", {});
rota("DELETE", "conteudo/upload", "site.editar", {});

// Equipe: só admin (contrato §3, R29).
rota("GET", "equipe", "so-admin");
rota("POST", "equipe", "so-admin", {});
rota("PATCH", "equipe", "so-admin", {});
rota("PUT", `equipe/${INEXISTENTE}/permissoes`, "so-admin", {});
rota("POST", `equipe/${INEXISTENTE}/senha`, "so-admin");

// Portal. GET leva a consulta mínima para o guard decidir sem tocar em dado real.
rota("GET", `${PORTAL}/atualizacao-fotos?atualizacaoId=${INEXISTENTE}`, "atualizacoes.ver");
rota("PATCH", `${PORTAL}/atualizacao-fotos`, "atualizacoes.editar", {});
rota("DELETE", `${PORTAL}/atualizacao-fotos`, "atualizacoes.editar", { id: INEXISTENTE });
rota("POST", `${PORTAL}/atualizacao-fotos/upload/assinar`, "atualizacoes.editar", {});
rota("POST", `${PORTAL}/atualizacao-fotos/upload/confirmar`, "atualizacoes.editar", {});
rota("GET", `${PORTAL}/atualizacoes`, "atualizacoes.ver");
rota("POST", `${PORTAL}/atualizacoes`, "atualizacoes.editar", {});
rota("PATCH", `${PORTAL}/atualizacoes`, "atualizacoes.editar", {});
rota("DELETE", `${PORTAL}/atualizacoes`, "atualizacoes.editar", { id: INEXISTENTE });
rota("GET", `${PORTAL}/clientes`, "clientes.ver");
rota("POST", `${PORTAL}/clientes`, "clientes.editar", {});
rota("PATCH", `${PORTAL}/clientes`, "clientes.editar", {});
// R22: a fila "Chegaram" e as ações dela são documentos.liberar.
rota("GET", `${PORTAL}/conector/chegaram`, "documentos.liberar");
rota("POST", `${PORTAL}/conector/chegaram`, "documentos.liberar", {});
rota("POST", `${PORTAL}/conector/chegaram/ignorar`, "documentos.liberar", {});
rota("GET", `${PORTAL}/conector/configuracao`, "servidor.regras");
rota("PATCH", `${PORTAL}/conector/configuracao`, "so-admin", {});
// Chave do conector: só admin (contrato §3). Emitir e revogar agem sem corpo válido: perigosas.
rota("GET", `${PORTAL}/conector`, "so-admin");
rota("POST", `${PORTAL}/conector`, "so-admin", {}, { perigosa: true, arquivo: R_CONECTOR });
rota("DELETE", `${PORTAL}/conector`, "so-admin", undefined, { perigosa: true, arquivo: R_CONECTOR });
rota("GET", `${PORTAL}/conector/uso`, "painel.servidor");
rota("GET", `${PORTAL}/documentos/downloads?documentoId=${INEXISTENTE}`, "so-admin");
rota("GET", `${PORTAL}/documentos`, "documentos.ver");
// Um único PATCH mistura campos de duas permissões: a rota pede uma das duas e o serviço confere campo a campo.
rota("PATCH", `${PORTAL}/documentos`, { qualquer: ["documentos.editar", "documentos.liberar"] }, {});
rota("DELETE", `${PORTAL}/documentos`, "documentos.editar", { id: INEXISTENTE });
// Liberar e ocultar em lote mexem em liberado_cliente: pedem documentos.liberar, e documentos.editar sozinho é negado.
rota("POST", `${PORTAL}/documentos/lote`, "documentos.liberar", {});
rota("POST", `${PORTAL}/documentos/upload/assinar`, "documentos.editar", {});
rota("POST", `${PORTAL}/documentos/upload/confirmar`, "documentos.editar", {});
rota("GET", `${PORTAL}/empreendimento-clientes?empreendimentoId=${INEXISTENTE}`, "clientes.ver");
rota("POST", `${PORTAL}/empreendimento-clientes`, "clientes.editar", {});
rota("DELETE", `${PORTAL}/empreendimento-clientes`, "clientes.editar", { id: INEXISTENTE });
rota("GET", `${PORTAL}/empreendimentos`, "empreendimentos.ver");
rota("POST", `${PORTAL}/empreendimentos`, "empreendimentos.editar", {});
rota("PATCH", `${PORTAL}/empreendimentos`, "empreendimentos.editar", {});
rota("DELETE", `${PORTAL}/empreendimentos`, "empreendimentos.excluir", { id: INEXISTENTE }); // R10
rota("GET", `${PORTAL}/empreiteiros`, "obras.ver");
rota("POST", `${PORTAL}/empreiteiros`, "obras.editar", {});
rota("PATCH", `${PORTAL}/empreiteiros`, "obras.editar", {});
rota("GET", `${PORTAL}/fornecedor-contas`, "fornecedores.ver");
rota("POST", `${PORTAL}/fornecedor-contas`, "fornecedores.editar", {});
rota("PATCH", `${PORTAL}/fornecedor-contas`, "fornecedores.editar", {});
rota("GET", `${PORTAL}/fornecedor-contratos?fornecedorId=${INEXISTENTE}`, "fornecedores.ver");
rota("PATCH", `${PORTAL}/fornecedor-contratos`, "fornecedores.editar", {});
rota("DELETE", `${PORTAL}/fornecedor-contratos`, "fornecedores.excluir", { id: INEXISTENTE }); // R11
rota("POST", `${PORTAL}/fornecedor-contratos/upload/assinar`, "fornecedores.editar", {});
rota("POST", `${PORTAL}/fornecedor-contratos/upload/confirmar`, "fornecedores.editar", {});
rota("GET", `${PORTAL}/fornecedor-documentos`, "fornecedores.ver");
rota("PATCH", `${PORTAL}/fornecedor-documentos`, "fornecedores.editar", {});
rota("DELETE", `${PORTAL}/fornecedor-documentos`, "so-admin", { id: INEXISTENTE });
rota("GET", `${PORTAL}/fornecedor-usuarios?fornecedorId=${INEXISTENTE}`, "fornecedores.ver");
rota("POST", `${PORTAL}/fornecedor-usuarios`, "fornecedores.editar", {});
rota("DELETE", `${PORTAL}/fornecedor-usuarios`, "fornecedores.editar", { id: INEXISTENTE });
rota("GET", `${PORTAL}/fornecedores`, "fornecedores.ver");
rota("POST", `${PORTAL}/fornecedores`, "fornecedores.editar", {});
rota("PATCH", `${PORTAL}/fornecedores`, "fornecedores.editar", {});
rota("DELETE", `${PORTAL}/fornecedores`, "fornecedores.excluir", { id: INEXISTENTE }); // R11
rota("GET", `${PORTAL}/itens-financeiros?empreendimentoId=${INEXISTENTE}`, "financeiro.ver");
rota("POST", `${PORTAL}/itens-financeiros`, "financeiro.editar", {});
rota("PATCH", `${PORTAL}/itens-financeiros`, "financeiro.editar", {});
rota("DELETE", `${PORTAL}/itens-financeiros`, "financeiro.editar", { id: INEXISTENTE });
rota("GET", `${PORTAL}/modelos`, "empreendimentos.ver");
rota("POST", `${PORTAL}/modelos`, "empreendimentos.editar", {});
rota("PATCH", `${PORTAL}/modelos`, "empreendimentos.editar", {});
rota("DELETE", `${PORTAL}/modelos`, "empreendimentos.editar", { id: INEXISTENTE });
rota("GET", `${PORTAL}/obra-empreiteiros?obraId=${INEXISTENTE}`, "obras.ver");
rota("POST", `${PORTAL}/obra-empreiteiros`, "obras.editar", {});
rota("DELETE", `${PORTAL}/obra-empreiteiros`, "obras.editar", { id: INEXISTENTE });
rota("GET", `${PORTAL}/obras?empreendimentoId=${INEXISTENTE}`, "obras.ver");
rota("POST", `${PORTAL}/obras`, "obras.editar", {});
rota("PATCH", `${PORTAL}/obras`, "obras.editar", {}); // R9: percentual e situação pedem obras.aprovar dentro do serviço (campo a campo)
rota("DELETE", `${PORTAL}/obras`, "obras.editar", { id: INEXISTENTE });
rota("GET", `${PORTAL}/parcelas?itemId=${INEXISTENTE}`, "financeiro.ver");
rota("POST", `${PORTAL}/parcelas`, "financeiro.editar", {});
rota("PATCH", `${PORTAL}/parcelas`, "financeiro.editar", {});
rota("DELETE", `${PORTAL}/parcelas`, "financeiro.editar", { id: INEXISTENTE });
rota("GET", `${PORTAL}/pasta-regras/arvore?empreendimentoId=${INEXISTENTE}`, "servidor.regras");
rota("GET", `${PORTAL}/pasta-regras?empreendimentoId=${INEXISTENTE}`, "servidor.regras");
rota("POST", `${PORTAL}/pasta-regras`, "servidor.regras", {});
rota("PATCH", `${PORTAL}/pasta-regras`, "servidor.regras", {});
rota("DELETE", `${PORTAL}/pasta-regras`, "servidor.regras", { id: INEXISTENTE }); // R3: regra ligada é só admin dentro do serviço
// Montar a partir do servidor. Criar pede servidor.regras além de empreendimentos.editar, mas a matriz só modela uma
// permissão por linha: quem tem só empreendimentos.editar passa na rota, responde 400 ao corpo vazio e é barrado no serviço.
rota("GET", `${PORTAL}/pasta-montagem?empreendimentoId=${INEXISTENTE}`, "servidor.regras");
rota("POST", `${PORTAL}/pasta-montagem`, "empreendimentos.editar", {});
rota("PATCH", `${PORTAL}/pasta-montagem/complementares`, "empreendimentos.editar", {});
// Etapas pelas pastas: o Automático é só do admin dentro do serviço (corpo vazio, a matriz não chega lá).
rota("PATCH", `${PORTAL}/etapas-automaticas/modo`, "empreendimentos.editar", {});
rota("POST", `${PORTAL}/etapas-automaticas/confirmar`, "empreendimentos.editar", {});
rota("POST", `${PORTAL}/etapas-automaticas/ignorar`, "empreendimentos.editar", {});
rota("POST", `${PORTAL}/etapas-automaticas/desfazer`, "empreendimentos.editar", {});
rota("GET", `${PORTAL}/etapas-automaticas/recalculo?empreendimentoId=${INEXISTENTE}`, "empreendimentos.ver");
rota("POST", `${PORTAL}/etapas-automaticas/recalculo`, "empreendimentos.editar", {});
// Catálogo de pastas: só admin.
rota("GET", `${PORTAL}/catalogo-pastas`, "so-admin");
rota("PATCH", `${PORTAL}/catalogo-pastas`, "so-admin", {});
rota("GET", `${PORTAL}/projeto-etapas?id=${INEXISTENTE}`, "empreendimentos.ver");
rota("PATCH", `${PORTAL}/projeto-etapas`, "empreendimentos.editar", {});
rota("GET", `${PORTAL}/projetos`, "empreendimentos.ver");
rota("POST", `${PORTAL}/projetos`, "empreendimentos.editar", {});
rota("PATCH", `${PORTAL}/projetos`, "empreendimentos.editar", {});
rota("DELETE", `${PORTAL}/projetos`, "empreendimentos.editar", { id: INEXISTENTE });
rota("POST", `${PORTAL}/projetos/ordem`, "empreendimentos.editar", {});
rota("GET", `${PORTAL}/relatos`, "obras.ver");
rota("PATCH", `${PORTAL}/relatos`, "obras.aprovar", {});

const ROTAS_DO_ADMIN = linhas.length;

// Rotas de arquivo de portal/** (anexo Parte A §5, R19): papéis externos iguais; a equipe precisa do `ver` do módulo.
// Estas rotas ficam fora do caminho do admin e respondem 404 para id inexistente.
const arquivo = (caminho, regra) => linhas.push({ metodo: "GET", caminho, regra, publica: true });
arquivo(`api/portal/documentos/${INEXISTENTE}/download`, { externos: ["cliente"], interna: "documentos.ver" });
// Visualização do SIMO: mesma regra do download (o 404 do SIMO para o cliente no download e o 404 de documento que não é SIMO
// aqui são conferidos com dados simulados em scripts/testar-portal-comum.mjs; esta matriz não cria documento no banco).
arquivo(`api/portal/documentos/${INEXISTENTE}/visualizar`, { externos: ["cliente"], interna: "documentos.ver" });
arquivo(`api/portal/atualizacao-fotos/${INEXISTENTE}`, { externos: ["cliente"], interna: "atualizacoes.ver" });
arquivo(`api/portal/relato-fotos/${INEXISTENTE}`, { externos: ["cliente", "empreiteiro"], interna: "obras.ver" });
arquivo(`api/portal/fornecedor-contratos/${INEXISTENTE}/download`, { externos: ["fornecedor"], interna: "fornecedores.ver" });
arquivo(`api/portal/fornecedor-documentos/${INEXISTENTE}/download`, { externos: ["fornecedor"], interna: "fornecedores.ver" });

const caminhoDaLinha = (linha) => (linha.publica ? `/${linha.caminho}` : `/${adminPath}/api/${linha.caminho}`);
const nomeDaLinha = (linha) => `${linha.metodo} ${linha.publica ? linha.caminho : linha.caminho.split("?")[0]}`.replaceAll(INEXISTENTE_2, "{id2}").replaceAll(INEXISTENTE, "{id}");

// ---------------------------------------------------------------- Tabela de páginas (à mão, do anexo Parte B §1 e R25)
const PERMISSOES_DO_PORTAL = [
  "empreendimentos.ver", "empreendimentos.editar", "empreendimentos.excluir", "clientes.ver", "clientes.editar", "atualizacoes.ver", "atualizacoes.editar",
  "documentos.ver", "documentos.editar", "documentos.liberar", "financeiro.ver", "financeiro.editar", "obras.ver", "obras.editar",
  "obras.aprovar", "fornecedores.ver", "fornecedores.editar", "fornecedores.excluir", "servidor.regras", "painel.servidor",
];
const PAGINAS = [
  { caminho: "", regra: "conta-interna" }, // R25: conta sem permissão entra no painel
  { caminho: "equipe", regra: "so-admin" },
  { caminho: "conteudo", regra: { qualquer: ["site.ver", "contatos.ver"] } },
  ...["topo", "servicos", "projetos", "loteamentos", "depoimentos", "parceiros", "videos", "configuracoes"].map((nomePagina) => ({ caminho: `conteudo/${nomePagina}`, regra: "site.ver" })),
  { caminho: "conteudo/contatos", regra: "contatos.ver" },
  { caminho: "conteudo/loteamentos/novo", regra: "site.editar" },
  { caminho: "conteudo/loteamentos/{id}", regra: "site.editar", id: "loteamentos" }, // Resolução R31: a tela de edição não tem modo só leitura.
  { caminho: "portal", regra: { qualquer: PERMISSOES_DO_PORTAL } },
  { caminho: "portal/empreendimentos", regra: "empreendimentos.ver" },
  { caminho: "portal/empreendimentos/{id}", regra: "empreendimentos.ver", id: "empreendimentos" },
  { caminho: "portal/modelos", regra: "empreendimentos.ver" },
  { caminho: "portal/catalogo-pastas", regra: "so-admin" },
  { caminho: "portal/projetos/{id}", regra: "empreendimentos.ver", id: "projetos" },
  { caminho: "portal/clientes", regra: "clientes.ver" },
  { caminho: "portal/atualizacoes", regra: "atualizacoes.ver" },
  { caminho: "portal/documentos", regra: "documentos.ver" },
  { caminho: "portal/chegaram", regra: "documentos.liberar" }, // R22
  { caminho: "portal/financeiro", regra: "financeiro.ver" },
  { caminho: "portal/cronograma", regra: "financeiro.ver" }, // R23
  { caminho: "portal/obras", regra: "obras.ver" },
  { caminho: "portal/relatos", regra: "obras.ver" },
  { caminho: "portal/empreiteiros", regra: "obras.ver" },
  { caminho: "portal/fornecedores", regra: "fornecedores.ver" },
  { caminho: "portal/fornecedores/{id}", regra: "fornecedores.ver", id: "fornecedores" },
  { caminho: "portal/fornecedor-documentos", regra: "fornecedores.ver" },
  { caminho: "portal/servidor", regra: "painel.servidor" },
];
const SEM_AREAS = "ainda não tem áreas liberadas";

// ---------------------------------------------------------------- Execução
const contas = [];
let chamadasDeRota = 0;
let chamadasDePagina = 0;
let chamadasAnonimas = 0;
let perigosasChamadas = 0;
let campoSensivelConferido = false;
const perigosasPuladas = new Set();
const sobreEsperado = (esperadoLiberado) => (esperadoLiberado ? "liberado (nem 401, 403 nem 429)" : "403");
const registrar = (texto) => divergencias.push(texto);

function permissoesEfetivas(conta) {
  if (conta.papel === "admin") return new Set(PERMISSOES);
  return new Set(conta.permissoes ?? []);
}

function primeiraInstrucaoEhSoAdmin(caminhoDoArquivo, metodo) {
  const texto = readFileSync(resolve(raiz, caminhoDoArquivo), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const padrao = new RegExp(`export\\s+async\\s+function\\s+${metodo}\\s*\\([^)]*\\)\\s*\\{\\s*try\\s*\\{\\s*await\\s+autorizarPortal\\(\\s*["']escrita["']\\s*,\\s*["']so-admin["']\\s*\\)`);
  return padrao.test(texto);
}

const soAdminConfirmado = new Map();
function confirmarPerigosa(linha) {
  const chave = `${linha.arquivo}#${linha.metodo}`;
  if (!soAdminConfirmado.has(chave)) {
    const confirmado = primeiraInstrucaoEhSoAdmin(linha.arquivo, linha.metodo);
    soAdminConfirmado.set(chave, confirmado);
    if (!confirmado) registrar(`${nomeDaLinha(linha)}: linha perigosa NÃO chamada por ninguém: a primeira instrução do handler não é autorizarPortal(_, "so-admin")`);
  }
  return soAdminConfirmado.get(chave);
}

async function percorrerRotas(conta) {
  const permissoes = permissoesEfetivas(conta);
  for (const linha of linhas) {
    const liberado = regraPermite(linha.regra, conta.papel, permissoes);
    if (linha.perigosa) {
      if (liberado) {
        perigosasPuladas.add(nomeDaLinha(linha));
        continue;
      }
      if (!confirmarPerigosa(linha)) continue;
      perigosasChamadas += 1;
    }
    const resposta = await chamarComEspera(conta.chamar, caminhoDaLinha(linha), { metodo: linha.metodo, corpo: linha.corpo });
    chamadasDeRota += 1;
    const certo = liberado ? ![401, 403, 429].includes(resposta.status) : resposta.status === 403;
    if (!certo) registrar(`${conta.rotulo} / ${nomeDaLinha(linha)}: esperado ${sobreEsperado(liberado)}, recebido ${resposta.status}`);
    else if (liberado && resposta.status >= 500) avisos.push(`${conta.rotulo} / ${nomeDaLinha(linha)}: liberado, mas respondeu ${resposta.status}`);
  }
}

async function percorrerPaginas(conta, ids) {
  const permissoes = permissoesEfetivas(conta);
  for (const pagina of PAGINAS) {
    let caminho = pagina.caminho;
    if (pagina.id) {
      if (!ids[pagina.id]) continue;
      caminho = caminho.replace("{id}", ids[pagina.id]);
    }
    const liberado = pagina.regra === "conta-interna" ? conta.papel === "admin" || conta.papel === "equipe" : regraPermite(pagina.regra, conta.papel, permissoes);
    const resposta = await chamarComEspera(conta.chamar, `/${adminPath}${caminho ? `/${caminho}` : ""}`, {});
    chamadasDePagina += 1;
    const rotulo = `página ${pagina.caminho || "(painel interno)"}`;
    const esperado = liberado ? 200 : 404;
    if (resposta.status !== esperado) registrar(`${conta.rotulo} / ${rotulo}: esperado ${esperado}, recebido ${resposta.status}`);
    if (pagina.caminho === "" && resposta.status === 200) {
      const avisoDeConta = resposta.texto.includes(SEM_AREAS);
      const deveAvisar = conta.rotulo === "sem";
      if (avisoDeConta !== deveAvisar) registrar(`${conta.rotulo} / ${rotulo}: ${deveAvisar ? "faltou" : "não deveria ter"} o texto "${SEM_AREAS}"`);
    }
  }
}

async function percorrerAnonimo() {
  const chamar = novaSessao();
  for (const linha of linhas.filter((item) => !item.publica)) {
    if (linha.perigosa) {
      if (!confirmarPerigosa(linha)) continue;
      perigosasChamadas += 1;
    }
    const resposta = await chamar(caminhoDaLinha(linha), { metodo: linha.metodo, corpo: linha.corpo });
    chamadasAnonimas += 1;
    if (resposta.status !== 404) registrar(`anon / ${nomeDaLinha(linha)}: esperado 404, recebido ${resposta.status}`);
  }
  if (!COM_PAGINAS) return;
  for (const pagina of PAGINAS.filter((item) => !item.id)) {
    const resposta = await chamar(`/${adminPath}${pagina.caminho ? `/${pagina.caminho}` : ""}`);
    chamadasAnonimas += 1;
    if (resposta.status !== 404) registrar(`anon / página ${pagina.caminho || "(painel interno)"}: esperado 404, recebido ${resposta.status}`);
  }
}

// R8: codigo_pasta e liberacao_automatica só saem para quem tem servidor.regras ou é admin.
const CAMPOS_SENSIVEIS = /codigo_pasta|codigoPasta|liberacao_automatica|liberacaoAutomatica/;
async function conferirCamposSensiveis() {
  const consulta = `/${adminPath}/api/portal/empreendimentos`;
  const dela = (rotulo) => contas.find((conta) => conta.rotulo === rotulo);
  const so = await chamarComEspera(dela("empreendimentos.ver").chamar, consulta, {});
  const admin = await chamarComEspera(dela("admin").chamar, consulta, {});
  const comServidor = await chamarComEspera(dela("servidor.regras").chamar, consulta, {});
  if (so.status !== 200) return registrar(`R8 / empreendimentos.ver / GET portal/empreendimentos: esperado 200, recebido ${so.status}`);
  if (admin.status !== 200) return registrar(`R8 / admin / GET portal/empreendimentos: esperado 200, recebido ${admin.status}`);
  const registros = admin.json?.details?.registros;
  if (!Array.isArray(registros) || registros.length === 0) {
    avisos.push("R8 não conferido: não há nenhum empreendimento no banco para a resposta trazer os campos");
    return;
  }
  if (!CAMPOS_SENSIVEIS.test(admin.texto)) registrar("R8 / admin / GET portal/empreendimentos: a resposta do admin não traz codigo_pasta nem liberacao_automatica");
  const vazaram = CAMPOS_SENSIVEIS.exec(so.texto);
  if (vazaram) registrar(`R8 / empreendimentos.ver / GET portal/empreendimentos: a resposta de quem só tem empreendimentos.ver traz ${vazaram[0]}`);
  if (comServidor.status === 200 && !CAMPOS_SENSIVEIS.test(comServidor.texto)) registrar("R8 / servidor.regras / GET portal/empreendimentos: quem tem servidor.regras deveria receber codigo_pasta");
  campoSensivelConferido = true;
}

async function emLotes(tarefas, limite) {
  const fila = [...tarefas];
  await Promise.all(Array.from({ length: Math.min(limite, fila.length) }, async () => {
    for (let tarefa = fila.shift(); tarefa; tarefa = fila.shift()) await tarefa();
  }));
}

async function lerIds() {
  const ids = {};
  for (const tabela of ["empreendimentos", "fornecedores", "projetos", "loteamentos"]) {
    const { data, error } = await supabase.from(tabela).select("id").limit(1);
    ids[tabela] = error ? null : data?.[0]?.id ?? null;
    if (!ids[tabela]) avisos.push(`páginas com [id] de ${tabela} puladas: ${error ? `erro ao ler (${error.code})` : "não há nenhum registro"}`);
  }
  return ids;
}

async function testar() {
  // O site precisa estar no ar e esconder o admin de quem não tem sessão.
  const sonda = await fetch(`${BASE}/${adminPath}/api/equipe`, { headers: { "x-real-ip": novoIp() } }).catch(() => null);
  if (!sonda) throw new Error(`o site não responde em ${BASE}: rode "npm run dev" antes`);
  if (sonda.status !== 404) throw new Error(`sem sessão a API do admin deveria responder 404, respondeu ${sonda.status}`);

  // Contas: nenhuma permissão, as 24, uma para cada permissão (com os pré-requisitos), um admin e os três papéis externos.
  contas.push(await criarConta("admin", "admin"));
  contas.push(Object.assign(await criarConta("equipe", "sem"), { permissoes: [] }));
  contas.push(Object.assign(await criarConta("equipe", "tudo"), { permissoes: [...PERMISSOES] }));
  for (const permissao of PERMISSOES) contas.push(Object.assign(await criarConta("equipe", permissao), { permissoes: comPrerequisitos([permissao]) }));
  for (const papel of ["cliente", "empreiteiro", "fornecedor"]) contas.push(await criarConta(papel, papel));

  // As permissões entram pela rota da tela Equipe, com um admin só para isso (os limites do admin da matriz ficam intactos).
  const preparo = await criarConta("admin", "preparo");
  await entrar(preparo);
  for (const conta of contas.filter((item) => item.papel === "equipe" && item.permissoes.length > 0)) {
    const salvar = await chamarComEspera(preparo.chamar, `/${adminPath}/api/equipe/${conta.id}/permissoes`, { metodo: "PUT", corpo: { permissoes: conta.permissoes } });
    if (salvar.status !== 200) throw new Error(`permissões de "${conta.rotulo}": ${salvar.status} ${salvar.texto.slice(0, 120)}`);
  }
  await emLotes(contas.map((conta) => () => entrar(conta)), CONCORRENCIA);

  const ids = COM_PAGINAS ? await lerIds() : {};
  const tarefas = [() => percorrerAnonimo()];
  for (const conta of contas) {
    tarefas.push(async () => {
      await percorrerRotas(conta);
      if (COM_PAGINAS) await percorrerPaginas(conta, ids);
      console.log(`conta "${conta.rotulo}" conferida`);
    });
  }
  await emLotes(tarefas, CONCORRENCIA);
  await conferirCamposSensiveis();
}

async function limpar() {
  for (const id of criados) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) console.error("Não apagou uma conta de teste:", id, error.code);
  }
  const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true }).like("nome", "Teste E8%");
  if (count) console.error(`Sobraram ${count} perfis "Teste E8" (de execuções interrompidas ou desta).`);
}

let erro = null;
try {
  await testar();
} catch (e) {
  erro = e;
} finally {
  await limpar();
}

if (erro) console.error("Interrompido:", erro.message);
for (const aviso of avisos.slice(0, 20)) console.log(`AVISO: ${aviso}`);
if (perigosasPuladas.size > 0) console.log(`Linhas perigosas nunca chamadas pelo admin: ${[...perigosasPuladas].join("; ")}`);
if (divergencias.length > 0) {
  const unicas = [...new Set(divergencias)];
  for (const divergencia of unicas.slice(0, MAXIMO_DIVERGENCIAS)) console.error(`DIVERGÊNCIA: ${divergencia}`);
  if (unicas.length > MAXIMO_DIVERGENCIAS) console.error(`... e mais ${unicas.length - MAXIMO_DIVERGENCIAS} divergência(s).`);
}
if (erro || divergencias.length > 0) exit(1);
console.log(
  `OK: ${chamadasDeRota} chamadas de rota (${ROTAS_DO_ADMIN} linhas do admin + ${linhas.length - ROTAS_DO_ADMIN} de arquivo × ${contas.length} contas, ` +
    `${perigosasChamadas} delas perigosas, só por contas negadas), ${chamadasDePagina} de página e ${chamadasAnonimas} sem sessão` +
    `${campoSensivelConferido ? "; a resposta do admin traz os campos do servidor e a de empreendimentos.ver não (R8)." : "; R8 não conferido (veja o AVISO)."}`,
);
