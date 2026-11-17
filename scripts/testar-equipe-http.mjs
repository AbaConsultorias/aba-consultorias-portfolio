// Confere a tela Equipe de ponta a ponta, por HTTP, contra o site local (Etapa 8, contrato §7).
// Uso, com o site rodando em localhost:3000: node --env-file=.env scripts/testar-equipe-http.mjs
//
// O site local usa o banco de produção. Por isso as contas têm nome aleatório, senha que só existe na
// memória deste processo e são apagadas no fim, mesmo se um teste falhar. Só roda contra localhost.
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";
import { exit } from "node:process";

const BASE = "http://localhost:3000";
const adminPath = process.env.ADMIN_PATH;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!adminPath || !url || !secretKey) {
  console.error("Faltam ADMIN_PATH, NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY.");
  exit(1);
}

const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const sufixo = randomBytes(6).toString("hex");
const criados = new Set();
const falhas = [];
let verificacoes = 0;

function confere(nome, condicao, detalhe = "") {
  verificacoes++;
  if (!condicao) falhas.push(`${nome}${detalhe ? ` (${detalhe})` : ""}`);
}

function novaSessao() {
  const cookies = new Map();
  // O login do admin aceita 5 tentativas por hora por IP; cada sessão de teste simula um IP próprio.
  const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;
  return async function chamar(caminho, { metodo = "GET", corpo } = {}) {
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
      // Página HTML: fica só o status.
    }
    return { status: resposta.status, json, texto, cabecalhos: resposta.headers };
  };
}

async function criarConta(papel, { precisaTrocar = false } = {}) {
  const email = `e8t-${papel}-${sufixo}-${randomBytes(3).toString("hex")}@example.com`;
  const senha = `${randomBytes(18).toString("base64url")}aA1`;
  const { data, error } = await supabase.auth.admin.createUser({ email, password: senha, email_confirm: true });
  if (error) throw new Error(`createUser: ${error.code}`);
  criados.add(data.user.id);
  const perfil = await supabase.from("profiles").insert({ id: data.user.id, papel, nome: `Teste E8 ${papel}`, precisa_trocar_senha: precisaTrocar });
  if (perfil.error) throw new Error(`perfil: ${perfil.error.code}`);
  return { id: data.user.id, email, senha };
}

async function entrar(conta, chamar = novaSessao()) {
  const resposta = await chamar(`/${adminPath}/api/entrar`, { metodo: "POST", corpo: { email: conta.email, senha: conta.senha } });
  return { chamar, status: resposta.status };
}

const api = (resto = "") => `/${adminPath}/api/equipe${resto}`;
const pagina = `/${adminPath}/equipe`;
const NEGADO = new Set([401, 403, 404]);

async function testar() {
  // Sem sessão: a rota e a tela não existem para quem está de fora.
  const anonimo = novaSessao();
  confere("anon: GET da API é 404", (await anonimo(api())).status === 404);
  confere("anon: POST da API é 404", (await anonimo(api(), { metodo: "POST", corpo: {} })).status === 404);
  confere("anon: página é 404", (await anonimo(pagina)).status === 404);

  const contaAdmin = await criarConta("admin");
  const admin = await entrar(contaAdmin);
  confere("admin entra", admin.status === 200, String(admin.status));

  const lista = await admin.chamar(api());
  confere("admin lista a equipe", lista.status === 200, String(lista.status));
  const contaNaLista = lista.json?.details?.registros?.find((r) => r.id === contaAdmin.id);
  confere("a lista traz a conta admin com o identificador", contaNaLista?.identificador === contaAdmin.email);
  const paginaAdmin = await admin.chamar(pagina);
  confere("admin abre a página", paginaAdmin.status === 200, String(paginaAdmin.status));

  // Criar: papel do corpo é ignorado, a senha vem uma vez, sem permissão nenhuma.
  const identificador = `e8t${sufixo}`;
  const criar = await admin.chamar(api(), { metodo: "POST", corpo: { nome: "Teste E8 criada", identificador, papel: "admin", telefone: null } });
  confere("admin cria conta", criar.status === 201, `${criar.status} ${criar.texto.slice(0, 160)}`);
  const novaId = criar.json?.details?.id;
  const senhaTemporaria = criar.json?.details?.senhaTemporaria;
  if (!novaId || !senhaTemporaria) throw new Error("a criação não devolveu id e senha");
  criados.add(novaId);
  confere("resposta com senha não fica em cache", (criar.cabecalhos.get("cache-control") ?? "").includes("no-store"));
  const { data: perfilNovo } = await supabase.from("profiles").select("papel,ativo,precisa_trocar_senha").eq("id", novaId).single();
  confere("papel do corpo foi ignorado", perfilNovo?.papel === "equipe", perfilNovo?.papel);
  confere("conta nova pede troca de senha", perfilNovo?.precisa_trocar_senha === true);
  const relistar = await admin.chamar(api());
  const novaNaLista = relistar.json?.details?.registros?.find((r) => r.id === novaId);
  confere("conta nova começa sem permissão", Array.isArray(novaNaLista?.permissoes) && novaNaLista.permissoes.length === 0);
  confere("a lista nunca traz senha", !relistar.texto.includes(senhaTemporaria));
  const { data: auditoriaDaConta, error: erroAuditoria } = await supabase.from("auditoria").select("antes,depois").eq("registro_id", novaId);
  confere("a auditoria registra a conta", !erroAuditoria && (auditoriaDaConta?.length ?? 0) > 0);
  confere("a auditoria não guarda a senha", !JSON.stringify(auditoriaDaConta).includes(senhaTemporaria));

  // Primeiro acesso: entra, mas nada abre antes de trocar a senha.
  const nova = await entrar({ email: `${identificador}@acesso.abaconsultorias.com.br`, senha: senhaTemporaria });
  confere("conta nova entra com a senha temporária", nova.status === 200, String(nova.status));
  confere("troca pendente: API de equipe negada", NEGADO.has((await nova.chamar(api())).status));

  // Primeiro acesso de verdade: trocar a senha conclui, limpa a marca e abre uma sessão nova.
  const contaTroca = await criarConta("equipe", { precisaTrocar: true });
  const sessaoTroca = await entrar(contaTroca);
  const novaSenhaTroca = `${randomBytes(15).toString("base64url")}aA1`;
  const troca = await sessaoTroca.chamar("/api/trocar-senha", { metodo: "POST", corpo: { senhaAtual: contaTroca.senha, novaSenha: novaSenhaTroca, confirmacao: novaSenhaTroca } });
  confere("primeiro acesso: trocar a senha conclui", troca.status === 200, `${troca.status} ${troca.texto.slice(0, 160)}`);
  const { data: perfilTroca } = await supabase.from("profiles").select("precisa_trocar_senha").eq("id", contaTroca.id).single();
  confere("primeiro acesso: a marca de troca foi limpa", perfilTroca?.precisa_trocar_senha === false);
  confere("primeiro acesso: segue logado com a sessão nova", (await sessaoTroca.chamar(`/${adminPath}`)).status === 200);
  confere("primeiro acesso: a senha antiga não entra mais", (await entrar(contaTroca)).status !== 200);
  confere("primeiro acesso: a senha nova entra", (await entrar({ email: contaTroca.email, senha: novaSenhaTroca })).status === 200);

  // Permissões: conjunto inválido recusado; o válido grava; alvo admin recusado.
  const semPre = await admin.chamar(api(`/${novaId}/permissoes`), { metodo: "PUT", corpo: { permissoes: ["site.editar"] } });
  confere("permissão sem pré-requisito é recusada", semPre.status === 400, String(semPre.status));
  const inventada = await admin.chamar(api(`/${novaId}/permissoes`), { metodo: "PUT", corpo: { permissoes: ["admin.tudo"] } });
  confere("permissão inventada é recusada", inventada.status === 400, String(inventada.status));
  const salvar = await admin.chamar(api(`/${novaId}/permissoes`), { metodo: "PUT", corpo: { permissoes: ["financeiro.ver", "financeiro.editar", "empreendimentos.ver"] } });
  confere("admin grava permissões", salvar.status === 200, `${salvar.status} ${salvar.texto.slice(0, 160)}`);
  const { data: linhas } = await supabase.from("equipe_permissoes").select("permissao,concedida_por").eq("profile_id", novaId);
  confere("as três permissões foram gravadas", linhas?.length === 3);
  confere("concedida_por é o admin da sessão", linhas?.every((l) => l.concedida_por === contaAdmin.id));
  const alvoAdmin = await admin.chamar(api(`/${contaAdmin.id}/permissoes`), { metodo: "PUT", corpo: { permissoes: ["site.ver"] } });
  confere("não dá permissão a uma conta admin", alvoAdmin.status === 404, String(alvoAdmin.status));
  const desativarAdmin = await admin.chamar(api(), { metodo: "PATCH", corpo: { id: contaAdmin.id, nome: "Nome válido", telefone: null, ativo: false } });
  confere("não desativa conta admin pela tela", desativarAdmin.status === 404, String(desativarAdmin.status));
  const senhaAdmin = await admin.chamar(api(`/${contaAdmin.id}/senha`), { metodo: "POST" });
  confere("não redefine senha de conta admin", senhaAdmin.status === 404, String(senhaAdmin.status));

  // Equipe, mesmo com as permissões concedíveis, não toca na gestão de contas.
  const contaEquipe = await criarConta("equipe");
  const permissoesTodas = (await supabase.rpc("catalogo_permissoes")).data;
  const prontas = await admin.chamar(api(`/${contaEquipe.id}/permissoes`), { metodo: "PUT", corpo: { permissoes: permissoesTodas } });
  confere("admin concede todas as 22", prontas.status === 200, `${prontas.status} ${prontas.texto.slice(0, 160)}`);
  const equipe = await entrar(contaEquipe);
  confere("equipe entra", equipe.status === 200, String(equipe.status));
  confere("equipe: lista negada", NEGADO.has((await equipe.chamar(api())).status));
  confere("equipe: criar negado", NEGADO.has((await equipe.chamar(api(), { metodo: "POST", corpo: { nome: "x", identificador: `x${sufixo}` } })).status));
  confere("equipe: página é 404", (await equipe.chamar(pagina)).status === 404);
  confere("equipe: mudar as próprias permissões negado", NEGADO.has((await equipe.chamar(api(`/${contaEquipe.id}/permissoes`), { metodo: "PUT", corpo: { permissoes: [] } })).status));
  confere("equipe: redefinir senha alheia negado", NEGADO.has((await equipe.chamar(api(`/${novaId}/senha`), { metodo: "POST" })).status));
  confere("equipe: desativar alguém negado", NEGADO.has((await equipe.chamar(api(), { metodo: "PATCH", corpo: { id: novaId, nome: "x", telefone: null, ativo: false } })).status));

  // Conta de cliente não é atingível por estas rotas.
  const contaCliente = await criarConta("cliente");
  const alvoCliente = await admin.chamar(api(`/${contaCliente.id}/senha`), { metodo: "POST" });
  confere("não redefine senha de cliente por aqui", alvoCliente.status === 404, String(alvoCliente.status));

  // Redefinir: gera outra senha e volta a exigir a troca.
  await supabase.from("profiles").update({ precisa_trocar_senha: false }).eq("id", novaId);
  const redefinir = await admin.chamar(api(`/${novaId}/senha`), { metodo: "POST" });
  const outraSenha = redefinir.json?.details?.senhaTemporaria;
  confere("redefinir devolve outra senha", redefinir.status === 200 && Boolean(outraSenha) && outraSenha !== senhaTemporaria, String(redefinir.status));
  const { data: depoisReset } = await supabase.from("profiles").select("precisa_trocar_senha").eq("id", novaId).single();
  confere("redefinir volta a exigir troca", depoisReset?.precisa_trocar_senha === true);
  confere("senha antiga deixa de entrar", (await entrar({ email: `${identificador}@acesso.abaconsultorias.com.br`, senha: senhaTemporaria })).status !== 200);

  // Desativar: corta a sessão aberta na próxima requisição e impede novo login; reativar devolve o login.
  const sessaoAberta = await entrar(contaEquipe);
  const area = `/${adminPath}/api/portal/empreendimentos`;
  confere("antes de desativar a sessão funciona", (await sessaoAberta.chamar(area)).status === 200);
  const desativar = await admin.chamar(api(), { metodo: "PATCH", corpo: { id: contaEquipe.id, nome: "Teste E8 equipe", telefone: null, ativo: false } });
  confere("admin desativa", desativar.status === 200, `${desativar.status} ${desativar.texto.slice(0, 160)}`);
  confere("sessão aberta é cortada na hora", NEGADO.has((await sessaoAberta.chamar(area)).status));
  confere("conta desativada não entra", (await entrar(contaEquipe)).status !== 200);
  const reativar = await admin.chamar(api(), { metodo: "PATCH", corpo: { id: contaEquipe.id, nome: "Teste E8 equipe", telefone: null, ativo: true } });
  confere("admin reativa", reativar.status === 200, String(reativar.status));
  confere("conta reativada entra", (await entrar(contaEquipe)).status === 200);

  // O corpo inválido não passa.
  confere("id inválido é recusado", (await admin.chamar(api("/nao-e-uuid/senha"), { metodo: "POST" })).status === 400);
}

async function limpar() {
  for (const id of criados) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) console.error("Não apagou uma conta de teste:", id, error.code);
  }
  const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true }).like("nome", "Teste E8%");
  if (count) console.error(`Sobraram ${count} perfis de teste.`);
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
for (const falha of falhas) console.error("FALHA:", falha);
if (erro || falhas.length) exit(1);
console.log(`OK: ${verificacoes} verificações da tela Equipe.`);
