// Fluxos reais por HTTP contra o site local (Etapa 8, onda 5): a matriz de scripts/testar-permissoes-http.mjs prova só o guard,
// com corpo inválido; aqui o corpo é válido, porque as regras por campo (R3, R9, R12, R41, D5...) só agem depois da validação.
// Cada passo confere o status e, quando algo é negado, que o banco (lido com a secret key) ficou exatamente como estava.
// Uso, com o site rodando em localhost:3000: node --env-file=.env scripts/testar-fluxos-http.mjs
//
// O site local usa o banco de produção, com um conector real ativo. Por isso:
//  - só localhost; contas e dados são temporários, com nome "Teste E8 ... <sufixo>", criados com a secret key (ou pelas rotas
//    testadas) e apagados em finally, na ordem das chaves estrangeiras, mesmo se um fluxo falhar;
//  - nenhum registro que este script não criou é alterado; tudo fica sob um empreendimento temporário, com codigo_pasta de
//    6 dígitos começando em 99, e a única regra de pasta é criada com ativa=false;
//  - configuracoes_conector, conectores e o interruptor geral nunca são tocados com sucesso (a rota de configuração nem é chamada);
//  - nada vai ao R2 nem ao Storage: o documento temporário tem storage_path que não existe, nenhum assinar/confirmar é chamado e a
//    exclusão de documento só é exercitada por contas que devem ser negadas;
//  - liberacao_automatica do empreendimento temporário fica ligada só entre o "liga" e o "desliga" do fluxo 6, com reset no finally.
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const raiz = fileURLToPath(new URL("../", import.meta.url));

// permissoes.ts não importa nada: basta transpilar e executar.
function carregarPermissoes() {
  const arquivo = resolve(raiz, "src/lib/auth/permissoes.ts");
  const modulo = { exports: {} };
  const codigo = ts.transpileModule(readFileSync(arquivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: arquivo,
  }).outputText;
  runInThisContext(`(function(module, exports) {${codigo}\n})`, { filename: arquivo })(modulo, modulo.exports);
  return modulo.exports;
}

const { comPrerequisitos, MODELOS } = carregarPermissoes();

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
const MAXIMO_DIVERGENCIAS = 80;
const SEM_AREAS = "ainda não tem áreas liberadas";
const INEXISTENTE = "7e570000-e8e8-4e8e-8e8e-000000000001";

const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const sufixo = randomBytes(6).toString("hex");
const N = (texto) => `Teste E8 ${texto} ${sufixo}`;
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
      // Página HTML ou corpo vazio: fica só o status e o texto.
    }
    return { status: resposta.status, json, texto, cabecalhos: resposta.headers };
  };
}

// 429 nunca conta como aprovado: o servidor recusou antes de executar, então esperar e repetir é seguro; se persistir, o 429 vira divergência.
async function chamarComEspera(chamar, caminho, opcoes) {
  for (let tentativa = 0; ; tentativa += 1) {
    const resposta = await chamar(caminho, opcoes);
    if (resposta.status !== 429 || tentativa >= 6) return resposta;
    const aviso = Number(resposta.cabecalhos.get("retry-after"));
    await dormir((Number.isFinite(aviso) && aviso > 0 ? Math.min(aviso, 65) : 20) * 1000);
  }
}

// ---------------------------------------------------------------- Contas temporárias
const criados = new Set();

async function criarConta(papel, rotulo) {
  const email = `e8f-${rotulo.replaceAll("_", "")}-${sufixo}-${randomBytes(3).toString("hex")}@example.com`;
  const senha = `${randomBytes(18).toString("base64url")}aA1`;
  const { data, error } = await supabase.auth.admin.createUser({ email, password: senha, email_confirm: true });
  if (error) throw new Error(`createUser: ${error.code}`);
  criados.add(data.user.id);
  const perfil = await supabase.from("profiles").insert({ id: data.user.id, papel, nome: N(`conta ${rotulo}`), precisa_trocar_senha: false });
  if (perfil.error) throw new Error(`perfil: ${perfil.error.code}`);
  return { id: data.user.id, email, senha, papel, rotulo };
}

async function entrar(conta) {
  const chamar = novaSessao();
  const resposta = await chamar(`/${adminPath}/api/entrar`, { metodo: "POST", corpo: { email: conta.email, senha: conta.senha } });
  if (resposta.status !== 200) throw new Error(`login de "${conta.rotulo}": ${resposta.status}`);
  conta.chamar = chamar;
}

const modelo = (id) => MODELOS.find((item) => item.id === id).permissoes;
const DEFINICOES = [
  ["financeiro", modelo("financeiro")],
  ["campo", modelo("campo")],
  ["site", modelo("site")],
  ["atendimento", modelo("atendimento")],
  ["doc_e", ["documentos.editar"]],
  ["doc_l", ["documentos.liberar"]],
  ["doc_v", ["documentos.ver"]],
  ["ob_e", ["obras.editar"]],
  // PATCH de obra exige obras.editar na rota; obras.aprovar sozinha nem chega ao serviço.
  ["ob_a", ["obras.editar", "obras.aprovar"]],
  ["em_e", ["empreendimentos.editar"]],
  ["sr", ["servidor.regras"]],
  // PATCH de empreendimento exige empreendimentos.editar na rota: quem muda codigo_pasta precisa dos dois.
  ["sr_em", ["servidor.regras", "empreendimentos.editar"]],
  ["fo_e", ["fornecedores.editar"]],
  ["site_ver", ["site.ver"]],
  ["fin_revoga", modelo("financeiro")],
  ["sem", []],
];

// ---------------------------------------------------------------- Registro de resultados
const divergencias = [];
let verificacoes = 0;
let chamadasHttp = 0;
let fluxos = 0;
let fluxoAtual = "";

const falha = (passo, esperado, recebido) => divergencias.push(`${fluxoAtual} / ${passo}: esperado ${esperado}, recebido ${recebido}`);

function descrever(esperado) {
  if (Array.isArray(esperado)) return esperado.join(" ou ");
  if (typeof esperado === "object") return `qualquer status, menos ${esperado.naoEm.join(" e ")}`;
  return String(esperado);
}

function status(passo, resposta, esperado) {
  verificacoes += 1;
  const bate = Array.isArray(esperado)
    ? esperado.includes(resposta.status)
    : typeof esperado === "object" ? !esperado.naoEm.includes(resposta.status) : resposta.status === esperado;
  if (!bate) falha(passo, descrever(esperado), resposta.status);
  return bate;
}

function banco(passo, esperado, obtido) {
  verificacoes += 1;
  if (JSON.stringify(esperado) !== JSON.stringify(obtido)) falha(`${passo} (banco)`, JSON.stringify(esperado), JSON.stringify(obtido));
}

async function fluxo(nome, corpo) {
  fluxoAtual = nome;
  fluxos += 1;
  try {
    await corpo();
  } catch (e) {
    divergencias.push(`${nome} / exceção: ${e.message}`);
  }
}

// ---------------------------------------------------------------- Banco (secret key) e chamadas
async function linha(tabela, id, colunas) {
  const { data, error } = await supabase.from(tabela).select(colunas).eq("id", id).maybeSingle();
  if (error) throw new Error(`leitura de ${tabela}: ${error.code}`);
  return data;
}

async function contar(tabela, coluna, valor) {
  const { count, error } = await supabase.from(tabela).select("id", { count: "exact", head: true }).eq(coluna, valor);
  if (error) throw new Error(`contagem de ${tabela}: ${error.code}`);
  return count;
}

async function inserir(tabela, valores) {
  const { data, error } = await supabase.from(tabela).insert(valores).select("id").single();
  if (error) throw new Error(`insert em ${tabela}: ${error.code} ${error.message}`);
  return data.id;
}

const api = (conta, metodo, caminho, corpo) => {
  chamadasHttp += 1;
  return chamarComEspera(conta.chamar, `/${adminPath}/api/${caminho}`, { metodo, corpo });
};
const publica = (conta, caminho) => {
  chamadasHttp += 1;
  return chamarComEspera(conta.chamar, caminho, {});
};
const idDe = (resposta) => resposta.json?.details?.registro?.id ?? resposta.json?.details?.id ?? null;

// Passo negado: confere o status e que a linha ficou exatamente igual (e ainda existe).
async function negado(passo, tabela, id, colunas, chamada, esperado = 403) {
  const antes = await linha(tabela, id, colunas);
  const resposta = await chamada();
  status(passo, resposta, esperado);
  const depois = await linha(tabela, id, colunas);
  banco(`${passo}: a linha continua`, true, antes !== null && depois !== null);
  banco(`${passo}: nada mudou`, antes, depois);
  return resposta;
}

const senhaForte = () => `${randomBytes(12).toString("base64url")}aA1`;
const corpoConta = (nome) => ({ nome, telefone: null, identificador: `e8f-${randomBytes(5).toString("hex")}`, senha: senhaForte() });

// ---------------------------------------------------------------- Dados temporários
const fix = { emp: null, docId: null, fornecedores: new Set(), depoimentos: new Set(), contatos: new Set() };
const C = {};

async function criarEmpreendimento() {
  for (let tentativa = 0; tentativa < 20; tentativa += 1) {
    const codigo = `99${String(randomInt(10000)).padStart(4, "0")}`;
    const { data, error } = await supabase.from("empreendimentos").insert({ nome: N("empreendimento"), situacao: "ativo", codigo_pasta: codigo }).select("id").single();
    if (!error) return { id: data.id, codigo };
    if (error.code !== "23505") throw new Error(`empreendimento: ${error.code} ${error.message}`);
  }
  throw new Error("não achou um codigo_pasta 99xxxx livre");
}

async function codigoLivre(usado) {
  for (let tentativa = 0; tentativa < 20; tentativa += 1) {
    const codigo = `99${String(randomInt(10000)).padStart(4, "0")}`;
    if (codigo !== usado && await contar("empreendimentos", "codigo_pasta", codigo) === 0) return codigo;
  }
  throw new Error("não achou um segundo codigo_pasta 99xxxx livre");
}

async function preparar() {
  const sonda = await fetch(`${BASE}/${adminPath}/api/equipe`, { headers: { "x-real-ip": novoIp() } }).catch(() => null);
  if (!sonda) throw new Error(`o site não responde em ${BASE}: rode "npm run dev" antes`);
  if (sonda.status !== 404) throw new Error(`sem sessão a API do admin deveria responder 404, respondeu ${sonda.status}`);

  C.admin = await criarConta("admin", "admin");
  const preparo = await criarConta("admin", "preparo");
  for (const [rotulo, permissoes] of DEFINICOES) C[rotulo] = Object.assign(await criarConta("equipe", rotulo), { permissoes: comPrerequisitos(permissoes) });

  await entrar(preparo);
  for (const [rotulo] of DEFINICOES) {
    if (C[rotulo].permissoes.length === 0) continue;
    const salvar = await api(preparo, "PUT", `equipe/${C[rotulo].id}/permissoes`, { permissoes: C[rotulo].permissoes });
    if (salvar.status !== 200) throw new Error(`permissões de "${rotulo}": ${salvar.status} ${salvar.texto.slice(0, 120)}`);
  }
  await entrar(C.admin);
  for (const [rotulo] of DEFINICOES) await entrar(C[rotulo]);

  const emp = await criarEmpreendimento();
  fix.emp = emp.id;
  fix.codigoA = emp.codigo;
  fix.codigoB = await codigoLivre(emp.codigo);
  fix.p1 = await inserir("projetos", { empreendimento_id: fix.emp, nome: N("projeto regra") });
  fix.p2 = await inserir("projetos", { empreendimento_id: fix.emp, nome: N("projeto com documento") });
  fix.p3 = await inserir("projetos", { empreendimento_id: fix.emp, nome: N("projeto com atualização") });
  fix.p4 = await inserir("projetos", { empreendimento_id: fix.emp, nome: N("projeto vazio") });
  fix.atualizacaoVinculada = await inserir("atualizacoes", { empreendimento_id: fix.emp, projeto_id: fix.p3, titulo: N("atualização vinculada"), publicado: false });
  fix.obra = await inserir("obras", { empreendimento_id: fix.emp, nome: N("obra"), percentual: 20, situacao: "em_andamento" });
  fix.docId = await inserir("documentos", {
    empreendimento_id: fix.emp, projeto_id: fix.p2, titulo: N("documento"), storage_path: `${fix.emp}/teste-e8-${sufixo}.pdf`,
    mime: "application/pdf", tamanho: 1,
  });
  fix.depoimento = await inserir("depoimentos", { nome: N("depoimento"), texto: "texto de teste", origem: "cliente", nota: null, publicado: false, ordem: 0 });
  fix.depoimentos.add(fix.depoimento);
  fix.contato = await inserir("contatos", { nome: N("contato"), mensagem: "mensagem de teste", lido: false });
  fix.contatos.add(fix.contato);
}

// ---------------------------------------------------------------- Fluxos
const corpoDepoimento = (id, nome, texto) => ({ id, nome, cidade: null, texto, origem: "cliente", nota: null, quando: null, ordem: 0, publicado: false });
const corpoObra = (id, nome, situacao, percentual) => ({ id, nome, previstoInicio: null, previstoFim: null, situacao, percentual });
const corpoFornecedor = (razaoSocial) => ({ razaoSocial, nomeFantasia: null, cnpj: null, contatoNome: null, telefone: null, email: null, observacao: null, ativo: true });
const COLUNAS_EMP = "nome,situacao,codigo_pasta,liberacao_automatica";

async function fluxoFinanceiro() {
  const f = C.financeiro;
  const criarItem = await api(f, "POST", "portal/itens-financeiros", { empreendimentoId: fix.emp, fornecedorId: null, descricao: N("item"), valorContratadoCentavos: "100000", observacao: null });
  status("criar item", criarItem, 201);
  const itemId = idDe(criarItem);
  if (!itemId) return falha("criar item", "id do item na resposta", "sem id");

  const editarItem = await api(f, "PATCH", "portal/itens-financeiros", { id: itemId, fornecedorId: null, descricao: N("item editado"), valorContratadoCentavos: "150000", observacao: null });
  status("editar item", editarItem, 200);
  const item = await linha("itens_financeiros", itemId, "descricao,valor_contratado_centavos");
  banco("editar item", { descricao: N("item editado"), valor: 150000 }, { descricao: item?.descricao, valor: Number(item?.valor_contratado_centavos) });

  const criarParcela = await api(f, "POST", "portal/parcelas", { itemId, nome: N("parcela"), vencimento: "2030-01-15", valorPrevistoCentavos: "50000", observacao: null });
  status("criar parcela", criarParcela, 201);
  const parcelaId = idDe(criarParcela);
  if (!parcelaId) return falha("criar parcela", "id da parcela na resposta", "sem id");
  const editarParcela = await api(f, "PATCH", "portal/parcelas", {
    id: parcelaId, nome: N("parcela editada"), vencimento: "2030-02-15", valorPrevistoCentavos: "60000", valorPagoCentavos: "0", dataPagamento: null, observacao: null, corrigir: false,
  });
  status("editar parcela", editarParcela, 200);
  const parcela = await linha("parcelas", parcelaId, "nome,vencimento,valor_previsto_centavos");
  banco("editar parcela", { nome: N("parcela editada"), vencimento: "2030-02-15", valor: 60000 }, { nome: parcela?.nome, vencimento: parcela?.vencimento, valor: Number(parcela?.valor_previsto_centavos) });

  status("ler itens", await api(f, "GET", `portal/itens-financeiros?empreendimentoId=${fix.emp}`), 200);
  status("ler parcelas", await api(f, "GET", `portal/parcelas?itemId=${itemId}`), 200);
  status("ler empreendimentos (vem junto no modelo)", await api(f, "GET", "portal/empreendimentos"), 200);

  await negado("editar empreendimento", "empreendimentos", fix.emp, COLUNAS_EMP, () => api(f, "PATCH", "portal/empreendimentos", { id: fix.emp, nome: N("empreendimento pelo financeiro") }));
  status("ler site (depoimentos)", await api(f, "GET", "conteudo/depoimentos"), 403);
  status("ler site (configurações)", await api(f, "GET", "conteudo/configuracoes"), 403);
}

async function fluxoSite() {
  const s = C.site;
  const editar = await api(s, "PATCH", "conteudo/depoimentos", corpoDepoimento(fix.depoimento, N("depoimento editado"), "texto editado"));
  status("editar depoimento", editar, 200);
  const depoimento = await linha("depoimentos", fix.depoimento, "nome,texto");
  banco("editar depoimento", { nome: N("depoimento editado"), texto: "texto editado" }, depoimento);

  const marcar = await api(s, "PATCH", "conteudo/contatos", { id: fix.contato, lido: true });
  status("marcar contato como lido (contatos.editar)", marcar, 200);
  banco("marcar contato como lido", { lido: true }, await linha("contatos", fix.contato, "lido"));

  const COLUNAS_DEPOIMENTO = "nome,texto,ordem,publicado";
  const v = C.site_ver;
  status("site.ver lê depoimentos", await api(v, "GET", "conteudo/depoimentos"), 200);
  status("site.ver não lê contatos", await api(v, "GET", "conteudo/contatos"), 403);
  await negado("site.ver edita depoimento", "depoimentos", fix.depoimento, COLUNAS_DEPOIMENTO, () => api(v, "PATCH", "conteudo/depoimentos", corpoDepoimento(fix.depoimento, N("depoimento pelo site.ver"), "x")));
  await negado("site.ver marca contato", "contatos", fix.contato, "lido,mensagem", () => api(v, "PATCH", "conteudo/contatos", { id: fix.contato, lido: false }));

  const f = C.financeiro;
  await negado("financeiro edita depoimento", "depoimentos", fix.depoimento, COLUNAS_DEPOIMENTO, () => api(f, "PATCH", "conteudo/depoimentos", corpoDepoimento(fix.depoimento, N("depoimento pelo financeiro"), "x")));
  await negado("financeiro marca contato", "contatos", fix.contato, "lido,mensagem", () => api(f, "PATCH", "conteudo/contatos", { id: fix.contato, lido: false }));
}

async function fluxoCampo() {
  const c = C.campo;
  const criar = await api(c, "POST", "portal/atualizacoes", { empreendimentoId: fix.emp, titulo: N("atualização"), texto: null, dataVisita: null });
  status("criar atualização", criar, 201);
  const id = idDe(criar);
  if (!id) return falha("criar atualização", "id na resposta", "sem id");
  banco("criar atualização", { publicado: false }, await linha("atualizacoes", id, "publicado"));
  const publicar = await api(c, "PATCH", "portal/atualizacoes", { id, publicado: true });
  status("publicar atualização", publicar, 200);
  banco("publicar atualização", { publicado: true }, await linha("atualizacoes", id, "publicado"));
  status("ler atualizações", await api(c, "GET", `portal/atualizacoes?empreendimentoId=${fix.emp}`), 200);

  await negado("editar obra", "obras", fix.obra, "nome,percentual,situacao", () => api(c, "PATCH", "portal/obras", corpoObra(fix.obra, N("obra pelo campo"), "em_andamento", 20)));
  // Sem relato temporário para comparar no banco: o guard decide antes de olhar o id.
  status("aprovar relato", await api(c, "PATCH", "portal/relatos", { id: INEXISTENTE, acao: "aprovar", percentual: 10, situacao: "em_andamento" }), 403);
  status("devolver relato", await api(c, "PATCH", "portal/relatos", { id: INEXISTENTE, acao: "devolver", motivo: "teste" }), 403);
}

async function fluxoAtendimento() {
  const a = C.atendimento;
  status("listar clientes", await api(a, "GET", "portal/clientes"), 200);
  const nome = N("cliente");
  const criar = await api(a, "POST", "portal/clientes", { ...corpoConta(nome) });
  status("criar conta de cliente", criar, 201);
  const id = idDe(criar);
  if (id) {
    criados.add(id);
    banco("criar conta de cliente", { papel: "cliente", nome }, await linha("profiles", id, "papel,nome"));
  } else {
    falha("criar conta de cliente", "id na resposta", "sem id");
  }

  const empreiteiro = N("empreiteiro negado ao atendimento");
  status("criar empreiteiro", await api(a, "POST", "portal/empreiteiros", corpoConta(empreiteiro)), 403);
  banco("criar empreiteiro: nenhum perfil criado", 0, await contar("profiles", "nome", empreiteiro));
  const contaFornecedor = N("conta de fornecedor negada ao atendimento");
  status("criar conta de fornecedor", await api(a, "POST", "portal/fornecedor-contas", corpoConta(contaFornecedor)), 403);
  banco("criar conta de fornecedor: nenhum perfil criado", 0, await contar("profiles", "nome", contaFornecedor));
  const fornecedor = N("fornecedor negado ao atendimento");
  status("criar fornecedor", await api(a, "POST", "portal/fornecedores", corpoFornecedor(fornecedor)), 403);
  banco("criar fornecedor: nenhum cadastro criado", 0, await contar("fornecedores", "razao_social", fornecedor));
}

async function fluxoObras() {
  const e = C.ob_e;
  const novoNome = N("obra renomeada");
  status("ob_e renomeia a obra", await api(e, "PATCH", "portal/obras", corpoObra(fix.obra, novoNome, "em_andamento", 20)), 200);
  banco("ob_e renomeia a obra", { nome: novoNome, percentual: 20, situacao: "em_andamento" }, await linha("obras", fix.obra, "nome,percentual,situacao"));

  await negado("ob_e muda o percentual (R9)", "obras", fix.obra, "nome,percentual,situacao", () => api(e, "PATCH", "portal/obras", corpoObra(fix.obra, novoNome, "em_andamento", 30)));
  await negado("ob_e muda a situação (R9)", "obras", fix.obra, "nome,percentual,situacao", () => api(e, "PATCH", "portal/obras", corpoObra(fix.obra, novoNome, "concluida", 20)));

  const zero = N("obra criada com 0");
  const criarZero = await api(e, "POST", "portal/obras", { empreendimentoId: fix.emp, ...corpoObra(undefined, zero, "planejada", 0) });
  status("ob_e cria obra com percentual 0", criarZero, 201);
  const idZero = idDe(criarZero);
  if (idZero) banco("ob_e cria obra com percentual 0", { nome: zero, percentual: 0, situacao: "planejada" }, await linha("obras", idZero, "nome,percentual,situacao"));
  else falha("ob_e cria obra com percentual 0", "id na resposta", "sem id");

  const cinquenta = N("obra criada com 50");
  status("ob_e cria obra com percentual 50", await api(e, "POST", "portal/obras", { empreendimentoId: fix.emp, ...corpoObra(undefined, cinquenta, "planejada", 50) }), 403);
  banco("ob_e cria obra com percentual 50: nada criado", 0, await contar("obras", "nome", cinquenta));

  status("ob_a muda o percentual", await api(C.ob_a, "PATCH", "portal/obras", corpoObra(fix.obra, novoNome, "em_andamento", 35)), 200);
  banco("ob_a muda o percentual", { nome: novoNome, percentual: 35, situacao: "em_andamento" }, await linha("obras", fix.obra, "nome,percentual,situacao"));

  const contaEmpreiteiro = N("empreiteiro");
  const criarEmpreiteiro = await api(e, "POST", "portal/empreiteiros", corpoConta(contaEmpreiteiro));
  status("ob_e cria conta de empreiteiro", criarEmpreiteiro, 201);
  const idEmpreiteiro = idDe(criarEmpreiteiro);
  if (idEmpreiteiro) {
    criados.add(idEmpreiteiro);
    banco("ob_e cria conta de empreiteiro", { papel: "empreiteiro", nome: contaEmpreiteiro }, await linha("profiles", idEmpreiteiro, "papel,nome"));
  } else {
    falha("ob_e cria conta de empreiteiro", "id na resposta", "sem id");
  }
  const fornecedorDoEmpreiteiro = N("conta de fornecedor negada ao ob_e");
  status("ob_e cria conta de fornecedor", await api(e, "POST", "portal/fornecedor-contas", corpoConta(fornecedorDoEmpreiteiro)), 403);
  banco("ob_e cria conta de fornecedor: nenhum perfil criado", 0, await contar("profiles", "nome", fornecedorDoEmpreiteiro));

  const f = C.fo_e;
  const contaFornecedor = N("conta de fornecedor");
  const criarFornecedor = await api(f, "POST", "portal/fornecedor-contas", corpoConta(contaFornecedor));
  status("fo_e cria conta de fornecedor", criarFornecedor, 201);
  const idFornecedor = idDe(criarFornecedor);
  if (idFornecedor) {
    criados.add(idFornecedor);
    banco("fo_e cria conta de fornecedor", { papel: "fornecedor", nome: contaFornecedor }, await linha("profiles", idFornecedor, "papel,nome"));
  } else {
    falha("fo_e cria conta de fornecedor", "id na resposta", "sem id");
  }
  const empreiteiroDoFornecedor = N("empreiteiro negado ao fo_e");
  status("fo_e cria conta de empreiteiro", await api(f, "POST", "portal/empreiteiros", corpoConta(empreiteiroDoFornecedor)), 403);
  banco("fo_e cria conta de empreiteiro: nenhum perfil criado", 0, await contar("profiles", "nome", empreiteiroDoFornecedor));
}

async function fluxoEmpreendimento() {
  const e = C.em_e;
  const admin = C.admin;
  const novoNome = N("empreendimento renomeado");
  status("em_e edita o nome", await api(e, "PATCH", "portal/empreendimentos", { id: fix.emp, nome: novoNome }), 200);
  banco("em_e edita o nome", { nome: novoNome, codigo_pasta: fix.codigoA, liberacao_automatica: false }, await linha("empreendimentos", fix.emp, "nome,codigo_pasta,liberacao_automatica"));

  await negado("em_e liga a liberação automática (D5)", "empreendimentos", fix.emp, COLUNAS_EMP, () => api(e, "PATCH", "portal/empreendimentos", { id: fix.emp, liberacaoAutomatica: true }));
  await negado("em_e muda o codigo_pasta", "empreendimentos", fix.emp, COLUNAS_EMP, () => api(e, "PATCH", "portal/empreendimentos", { id: fix.emp, codigoPasta: fix.codigoB }));
  await negado("sr sem empreendimentos.editar muda o codigo_pasta", "empreendimentos", fix.emp, COLUNAS_EMP, () => api(C.sr, "PATCH", "portal/empreendimentos", { id: fix.emp, codigoPasta: fix.codigoB }));
  await negado("em_e exclui o empreendimento (R10)", "empreendimentos", fix.emp, COLUNAS_EMP, () => api(e, "DELETE", "portal/empreendimentos", { id: fix.emp }));

  // Ligada só entre o liga e o desliga; o finally garante o reset com a secret key.
  try {
    status("admin liga a liberação automática", await api(admin, "PATCH", "portal/empreendimentos", { id: fix.emp, liberacaoAutomatica: true }), 200);
    banco("admin liga a liberação automática", true, (await linha("empreendimentos", fix.emp, "liberacao_automatica"))?.liberacao_automatica);
    await negado("sr_em muda o codigo_pasta com a automática ligada (D5)", "empreendimentos", fix.emp, COLUNAS_EMP, () => api(C.sr_em, "PATCH", "portal/empreendimentos", { id: fix.emp, codigoPasta: fix.codigoB }));
    await negado("em_e muda o codigo_pasta com a automática ligada", "empreendimentos", fix.emp, COLUNAS_EMP, () => api(e, "PATCH", "portal/empreendimentos", { id: fix.emp, codigoPasta: fix.codigoB }));
    status("admin desliga a liberação automática", await api(admin, "PATCH", "portal/empreendimentos", { id: fix.emp, liberacaoAutomatica: false }), 200);
    banco("admin desliga a liberação automática", false, (await linha("empreendimentos", fix.emp, "liberacao_automatica"))?.liberacao_automatica);
  } finally {
    await supabase.from("empreendimentos").update({ liberacao_automatica: false }).eq("id", fix.emp);
  }

  status("sr_em muda o codigo_pasta com a automática desligada", await api(C.sr_em, "PATCH", "portal/empreendimentos", { id: fix.emp, codigoPasta: fix.codigoB }), 200);
  banco("sr_em muda o codigo_pasta", { nome: novoNome, codigo_pasta: fix.codigoB, liberacao_automatica: false }, await linha("empreendimentos", fix.emp, "nome,codigo_pasta,liberacao_automatica"));
}

async function fluxoPastaRegras() {
  const sr = C.sr;
  const admin = C.admin;
  const prefixo = `Teste E8 regra ${sufixo}`;
  const COLUNAS_REGRA = "caminho_prefixo,liberar_automatico,ativa,projeto_id";
  // ativa=false em todo o fluxo: a regra nunca é aplicada pelo conector, mesmo ligada.
  const criar = await api(sr, "POST", "portal/pasta-regras", { empreendimentoId: fix.emp, caminhoPrefixo: prefixo, projetoId: fix.p1, liberarAutomatico: false, ativa: false });
  status("sr cria regra desligada", criar, [200, 201]);
  const id = idDe(criar);
  if (!id) return falha("sr cria regra desligada", "id na resposta", "sem id");
  try {
    banco("sr cria regra desligada", { caminho_prefixo: prefixo, liberar_automatico: false, ativa: false, projeto_id: fix.p1 }, await linha("pasta_regras", id, COLUNAS_REGRA));

    const ligada = `${prefixo} ligada`;
    status("sr cria regra com liberar_automatico (R3)", await api(sr, "POST", "portal/pasta-regras", { empreendimentoId: fix.emp, caminhoPrefixo: ligada, projetoId: fix.p1, liberarAutomatico: true, ativa: false }), 403);
    banco("sr cria regra com liberar_automatico: nada criado", 0, await contar("pasta_regras", "caminho_prefixo", ligada));

    status("admin liga a regra", await api(admin, "PATCH", "portal/pasta-regras", { id, liberarAutomatico: true }), 200);
    banco("admin liga a regra", { caminho_prefixo: prefixo, liberar_automatico: true, ativa: false, projeto_id: fix.p1 }, await linha("pasta_regras", id, COLUNAS_REGRA));
    await negado("sr altera a regra ligada (R3)", "pasta_regras", id, COLUNAS_REGRA, () => api(sr, "PATCH", "portal/pasta-regras", { id, caminhoPrefixo: `${prefixo} alterada` }));
    await negado("sr apaga a regra ligada (R3)", "pasta_regras", id, COLUNAS_REGRA, () => api(sr, "DELETE", "portal/pasta-regras", { id }));
    status("admin desliga a regra", await api(admin, "PATCH", "portal/pasta-regras", { id, liberarAutomatico: false }), 200);
    banco("admin desliga a regra", false, (await linha("pasta_regras", id, COLUNAS_REGRA))?.liberar_automatico);

    status("sr apaga a regra desligada", await api(sr, "DELETE", "portal/pasta-regras", { id }), 200);
    banco("sr apaga a regra desligada", null, await linha("pasta_regras", id, "id"));
  } finally {
    // Regra ligada que sobrasse, mesmo com ativa=false, é apagada aqui com a secret key.
    await supabase.from("pasta_regras").delete().eq("id", id);
  }
}

async function fluxoDocumentos() {
  const id = fix.docId;
  const COLUNAS_DOCUMENTO = "titulo,liberado_cliente,projeto_id,categoria_id,storage_path";
  const e = C.doc_e;
  const l = C.doc_l;
  const v = C.doc_v;
  const f = C.financeiro;
  const tituloNovo = N("documento renomeado");

  status("doc_e muda o título", await api(e, "PATCH", "portal/documentos", { id, titulo: tituloNovo }), 200);
  banco("doc_e muda o título", { titulo: tituloNovo, liberado_cliente: false }, await linha("documentos", id, "titulo,liberado_cliente"));
  await negado("doc_e muda liberado (R41)", "documentos", id, COLUNAS_DOCUMENTO, () => api(e, "PATCH", "portal/documentos", { id, liberado: true }));

  status("doc_l libera", await api(l, "PATCH", "portal/documentos", { id, liberado: true }), 200);
  banco("doc_l libera", { titulo: tituloNovo, liberado_cliente: true }, await linha("documentos", id, "titulo,liberado_cliente"));
  await negado("doc_l muda o título (R41)", "documentos", id, COLUNAS_DOCUMENTO, () => api(l, "PATCH", "portal/documentos", { id, titulo: N("documento renomeado pelo doc_l") }));
  await negado("doc_e exclui documento liberado (R12)", "documentos", id, COLUNAS_DOCUMENTO, () => api(e, "DELETE", "portal/documentos", { id }));
  await negado("doc_l exclui documento (R17)", "documentos", id, COLUNAS_DOCUMENTO, () => api(l, "DELETE", "portal/documentos", { id }));

  status("doc_v lê documentos", await api(v, "GET", `portal/documentos?empreendimentoId=${fix.emp}`), 200);
  await negado("doc_v muda o título", "documentos", id, COLUNAS_DOCUMENTO, () => api(v, "PATCH", "portal/documentos", { id, titulo: N("documento renomeado pelo doc_v") }));
  await negado("doc_v desfaz a liberação", "documentos", id, COLUNAS_DOCUMENTO, () => api(v, "PATCH", "portal/documentos", { id, liberado: false }));
  await negado("doc_v exclui documento (R17)", "documentos", id, COLUNAS_DOCUMENTO, () => api(v, "DELETE", "portal/documentos", { id }));

  status("financeiro lê documentos", await api(f, "GET", `portal/documentos?empreendimentoId=${fix.emp}`), 403);
  await negado("financeiro muda o título", "documentos", id, COLUNAS_DOCUMENTO, () => api(f, "PATCH", "portal/documentos", { id, titulo: N("documento renomeado pelo financeiro") }));
  await negado("financeiro muda liberado", "documentos", id, COLUNAS_DOCUMENTO, () => api(f, "PATCH", "portal/documentos", { id, liberado: false }));
  await negado("financeiro exclui documento", "documentos", id, COLUNAS_DOCUMENTO, () => api(f, "DELETE", "portal/documentos", { id }));
}

async function fluxoArquivos() {
  const id = fix.docId;
  const negadoSemAssinar = await publica(C.financeiro, `/api/portal/documentos/${id}/download`);
  status("financeiro baixa o documento (R19)", negadoSemAssinar, 403);
  banco("financeiro baixa o documento: nenhum download registrado", 0, await contar("downloads_log", "arquivo_id", id));
  // Com documentos.ver o id inexistente passa do guard e para no 404, sem assinar URL nem gravar linha em downloads_log.
  status("doc_v passa do guard do download", await publica(C.doc_v, `/api/portal/documentos/${INEXISTENTE}/download`), { naoEm: [401, 403] });
  status("atendimento passa do guard do download", await publica(C.atendimento, `/api/portal/documentos/${INEXISTENTE}/download`), { naoEm: [401, 403] });
  status("campo (sem documentos.ver) baixa o documento", await publica(C.campo, `/api/portal/documentos/${id}/download`), 403);
}

async function fluxoFornecedores() {
  const e = C.fo_e;
  const razao = N("fornecedor");
  const criar = await api(e, "POST", "portal/fornecedores", corpoFornecedor(razao));
  status("fo_e cria fornecedor", criar, 201);
  const id = idDe(criar);
  if (!id) return falha("fo_e cria fornecedor", "id na resposta", "sem id");
  fix.fornecedores.add(id);
  banco("fo_e cria fornecedor", { razao_social: razao }, await linha("fornecedores", id, "razao_social"));

  const razaoNova = N("fornecedor editado");
  status("fo_e edita fornecedor", await api(e, "PATCH", "portal/fornecedores", { id, ...corpoFornecedor(razaoNova) }), 200);
  banco("fo_e edita fornecedor", { razao_social: razaoNova }, await linha("fornecedores", id, "razao_social"));

  await negado("fo_e exclui fornecedor (R11)", "fornecedores", id, "razao_social,ativo", () => api(e, "DELETE", "portal/fornecedores", { id }));
  status("admin exclui fornecedor", await api(C.admin, "DELETE", "portal/fornecedores", { id }), 200);
  banco("admin exclui fornecedor", null, await linha("fornecedores", id, "id"));
}

async function fluxoExcluirProjeto() {
  const e = C.em_e;
  await negado("em_e exclui projeto com documento (R33)", "projetos", fix.p2, "nome,empreendimento_id", () => api(e, "DELETE", "portal/projetos", { id: fix.p2 }), 409);
  await negado("em_e exclui projeto com atualização (R33)", "projetos", fix.p3, "nome,empreendimento_id", () => api(e, "DELETE", "portal/projetos", { id: fix.p3 }), 409);
  // Controle: o mesmo caminho apaga um projeto sem vínculos, então o 409 acima não é defeito da rota.
  status("em_e exclui projeto sem vínculos", await api(e, "DELETE", "portal/projetos", { id: fix.p4 }), 200);
  banco("em_e exclui projeto sem vínculos", null, await linha("projetos", fix.p4, "id"));
}

async function fluxoSemPermissao() {
  const s = C.sem;
  const painel = await publica(s, `/${adminPath}`);
  status("painel da conta sem permissão", painel, 200);
  verificacoes += 1;
  if (painel.status === 200 && !painel.texto.includes(SEM_AREAS)) falha("painel da conta sem permissão", `texto "${SEM_AREAS}"`, "texto ausente");
  status("portal da conta sem permissão", await publica(s, `/${adminPath}/portal`), 404);
}

async function fluxoRetirarPermissao() {
  const conta = C.fin_revoga;
  const consulta = `portal/itens-financeiros?empreendimentoId=${fix.emp}`;
  status("antes de retirar", await api(conta, "GET", consulta), 200);
  status("admin retira financeiro.ver", await api(C.admin, "PUT", `equipe/${conta.id}/permissoes`, { permissoes: ["empreendimentos.ver"] }), 200);
  status("depois de retirar (itens)", await api(conta, "GET", consulta), 403);
  status("depois de retirar (parcelas)", await api(conta, "GET", `portal/parcelas?itemId=${INEXISTENTE}`), 403);
  status("admin devolve financeiro", await api(C.admin, "PUT", `equipe/${conta.id}/permissoes`, { permissoes: conta.permissoes }), 200);
  status("depois de devolver", await api(conta, "GET", consulta), 200);
}

// ---------------------------------------------------------------- Limpeza
const falhasDeLimpeza = [];
async function apagar(descricao, consulta) {
  const { error } = await consulta;
  if (error) falhasDeLimpeza.push(`${descricao}: ${error.code ?? error.message}`);
}

async function limparDados() {
  const emp = fix.emp;
  if (emp) {
    const itens = await supabase.from("itens_financeiros").select("id").eq("empreendimento_id", emp);
    const idsItens = (itens.data ?? []).map((item) => item.id);
    if (idsItens.length > 0) await apagar("parcelas", supabase.from("parcelas").delete().in("item_id", idsItens));
    await apagar("itens_financeiros", supabase.from("itens_financeiros").delete().eq("empreendimento_id", emp));
    if (fix.docId) await apagar("downloads_log", supabase.from("downloads_log").delete().eq("arquivo_id", fix.docId));
    await apagar("documentos", supabase.from("documentos").delete().eq("empreendimento_id", emp));
    await apagar("atualizacoes", supabase.from("atualizacoes").delete().eq("empreendimento_id", emp));
    await apagar("obras", supabase.from("obras").delete().eq("empreendimento_id", emp));
    await apagar("pasta_regras", supabase.from("pasta_regras").delete().eq("empreendimento_id", emp));
    await apagar("projetos", supabase.from("projetos").delete().eq("empreendimento_id", emp));
    await apagar("empreendimentos", supabase.from("empreendimentos").delete().eq("id", emp));
  }
  for (const id of fix.fornecedores) await apagar("fornecedores", supabase.from("fornecedores").delete().eq("id", id));
  await apagar("fornecedores do sufixo", supabase.from("fornecedores").delete().like("razao_social", `Teste E8%${sufixo}%`));
  for (const id of fix.depoimentos) await apagar("depoimentos", supabase.from("depoimentos").delete().eq("id", id));
  for (const id of fix.contatos) await apagar("contatos", supabase.from("contatos").delete().eq("id", id));
}

async function limparContas() {
  // Contas criadas pelas rotas cujo id não chegou até aqui: o nome leva o sufixo desta execução.
  const sobras = await supabase.from("profiles").select("id").like("nome", `Teste E8%${sufixo}%`);
  for (const perfil of sobras.data ?? []) criados.add(perfil.id);
  for (const id of criados) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) falhasDeLimpeza.push(`conta ${id}: ${error.code}`);
  }
}

async function contarPerfis(padrao) {
  const { count, error } = await supabase.from("profiles").select("id", { count: "exact", head: true }).like("nome", padrao);
  if (error) throw new Error(`contagem de perfis: ${error.code}`);
  return count ?? 0;
}

// ---------------------------------------------------------------- Execução
const avisos = [];
let erro = null;
let perfisProprios = null;
try {
  await preparar();
  await fluxo("1 financeiro", fluxoFinanceiro);
  await fluxo("2 site", fluxoSite);
  await fluxo("3 campo", fluxoCampo);
  await fluxo("4 atendimento", fluxoAtendimento);
  await fluxo("5 obras e contas", fluxoObras);
  await fluxo("6 empreendimento", fluxoEmpreendimento);
  await fluxo("7 pasta-regras", fluxoPastaRegras);
  await fluxo("8 documentos", fluxoDocumentos);
  await fluxo("9 arquivos", fluxoArquivos);
  await fluxo("10 fornecedores", fluxoFornecedores);
  await fluxo("11 excluir projeto", fluxoExcluirProjeto);
  await fluxo("12 conta sem permissão", fluxoSemPermissao);
  await fluxo("13 retirar permissão", fluxoRetirarPermissao);
} catch (e) {
  erro = e;
} finally {
  try {
    await limparDados();
  } catch (e) {
    falhasDeLimpeza.push(`dados: ${e.message}`);
  }
  try {
    await limparContas();
  } catch (e) {
    falhasDeLimpeza.push(`contas: ${e.message}`);
  }
  try {
    perfisProprios = await contarPerfis(`Teste E8%${sufixo}%`);
    const todos = await contarPerfis("Teste E8%");
    if (todos > perfisProprios) avisos.push(`${todos - perfisProprios} perfil(is) "Teste E8" de outras execuções continuam no banco; este script não os apaga.`);
  } catch (e) {
    falhasDeLimpeza.push(`conferência final: ${e.message}`);
  }
}

if (erro) console.error("Interrompido:", erro.message);
for (const aviso of avisos) console.log(`AVISO: ${aviso}`);
for (const falhaDeLimpeza of falhasDeLimpeza) console.error(`LIMPEZA: ${falhaDeLimpeza}`);
if (perfisProprios) console.error(`LIMPEZA: sobraram ${perfisProprios} perfis "Teste E8" desta execução.`);
if (divergencias.length > 0) {
  const unicas = [...new Set(divergencias)];
  for (const divergencia of unicas.slice(0, MAXIMO_DIVERGENCIAS)) console.error(`DIVERGÊNCIA: ${divergencia}`);
  if (unicas.length > MAXIMO_DIVERGENCIAS) console.error(`... e mais ${unicas.length - MAXIMO_DIVERGENCIAS} divergência(s).`);
}
if (erro || divergencias.length > 0 || falhasDeLimpeza.length > 0 || perfisProprios) exit(1);
console.log(`OK: ${verificacoes} verificações em ${fluxos} fluxos (${chamadasHttp} chamadas HTTP); nenhum perfil "Teste E8" desta execução sobrou.`);
