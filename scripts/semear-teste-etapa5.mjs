// Dados e contas de teste da Etapa 5 (empreiteiro, fornecedor e cronograma).
// Uso:
//   node --env-file=.env scripts/semear-teste-etapa5.mjs          cria (apaga a rodada anterior antes)
//   node --env-file=.env scripts/semear-teste-etapa5.mjs --limpar só apaga
// Tudo fica num empreendimento "[TESTE]" separado e em contas "teste5-*"; os
// dados reais não são tocados. As senhas vão para teste-local/CONTAS-TESTE.md
// (fora do git) e nunca para o terminal.
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { exit, argv } from "node:process";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY no .env.");
  exit(1);
}

const DOMINIO = "acesso.abaconsultorias.com.br";
const PREFIXO = "[TESTE]";
const CONTAS = [
  { id: "teste5-cliente", papel: "cliente", nome: "Cliente Teste" },
  { id: "teste5-empreiteiro-a", papel: "empreiteiro", nome: "Empreiteiro A (teste)" },
  { id: "teste5-empreiteiro-b", papel: "empreiteiro", nome: "Empreiteiro B (teste)" },
  { id: "teste5-fornecedor-a", papel: "fornecedor", nome: "Fornecedor A (teste)" },
  { id: "teste5-fornecedor-b", papel: "fornecedor", nome: "Fornecedor B (teste)" },
];
const PASTA = "teste-local";

const db = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

function falhar(etapa, error) {
  if (!error) return;
  console.error(`Falha em ${etapa}:`, error.code ?? "", error.message ?? error);
  exit(1);
}

function gerarSenha(tamanho = 14) {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const numeros = "23456789";
  const todos = letras + numeros;
  const chars = [letras[randomInt(letras.length)], numeros[randomInt(numeros.length)]];
  while (chars.length < tamanho) chars.push(todos[randomInt(todos.length)]);
  return chars.join("");
}

async function usuariosDeTeste() {
  const achados = new Map();
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    falhar("listar usuários", error);
    for (const u of data.users) {
      const local = u.email?.endsWith(`@${DOMINIO}`) ? u.email.split("@")[0] : null;
      if (local && CONTAS.some((c) => c.id === local)) achados.set(local, u.id);
    }
    if (data.users.length < 200) break;
  }
  return achados;
}

async function listarRecursivo(bucket, pasta) {
  const caminhos = [];
  const { data, error } = await db.storage.from(bucket).list(pasta, { limit: 1000 });
  if (error) return caminhos;
  for (const item of data) {
    const caminho = `${pasta}/${item.name}`;
    if (item.id) caminhos.push(caminho);
    else caminhos.push(...(await listarRecursivo(bucket, caminho)));
  }
  return caminhos;
}

async function apagarPasta(bucket, pasta) {
  const caminhos = await listarRecursivo(bucket, pasta);
  for (let i = 0; i < caminhos.length; i += 100) {
    const { error } = await db.storage.from(bucket).remove(caminhos.slice(i, i + 100));
    falhar(`apagar arquivos de ${bucket}`, error);
  }
  return caminhos.length;
}

async function limpar() {
  const { data: emps, error: e1 } = await db.from("empreendimentos").select("id").like("nome", `${PREFIXO}%`);
  falhar("buscar empreendimentos de teste", e1);
  const { data: forns, error: e2 } = await db.from("fornecedores").select("id").like("razao_social", `${PREFIXO}%`);
  falhar("buscar fornecedores de teste", e2);
  const empIds = emps.map((e) => e.id);
  const fornIds = forns.map((f) => f.id);
  let arquivos = 0;

  if (empIds.length) {
    const { data: obras } = await db.from("obras").select("id").in("empreendimento_id", empIds);
    for (const o of obras ?? []) arquivos += await apagarPasta("obras", `relatos/${o.id}`);
    falhar("apagar obras", (await db.from("obras").delete().in("empreendimento_id", empIds)).error);
    falhar("apagar itens", (await db.from("itens_financeiros").delete().in("empreendimento_id", empIds)).error);
  }
  if (fornIds.length) {
    for (const f of fornIds) arquivos += await apagarPasta("fornecedores", f);
    falhar("apagar documentos", (await db.from("fornecedor_documentos").delete().in("fornecedor_id", fornIds)).error);
    falhar("apagar contratos", (await db.from("fornecedor_contratos").delete().in("fornecedor_id", fornIds)).error);
    falhar("apagar itens do fornecedor", (await db.from("itens_financeiros").delete().in("fornecedor_id", fornIds)).error);
    falhar("apagar fornecedores", (await db.from("fornecedores").delete().in("id", fornIds)).error);
  }
  if (empIds.length) falhar("apagar empreendimentos", (await db.from("empreendimentos").delete().in("id", empIds)).error);

  const usuarios = await usuariosDeTeste();
  for (const id of usuarios.values()) {
    // Relatos e documentos do usuário de teste em obras/fornecedores reais travariam a exclusão.
    falhar("apagar relatos da conta", (await db.from("relatos_obra").delete().eq("autor_id", id)).error);
    const { error } = await db.auth.admin.deleteUser(id);
    falhar("apagar conta de teste", error);
  }
  console.log(`Limpeza: ${empIds.length} empreendimento(s), ${fornIds.length} fornecedor(es), ${usuarios.size} conta(s), ${arquivos} arquivo(s).`);
}

// --- arquivos de exemplo para os envios -------------------------------------

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(largura, altura, [r, g, b]) {
  const bloco = (tipo, dados) => {
    const t = Buffer.from(tipo);
    const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
    return Buffer.concat([tam, t, dados, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const linha = Buffer.alloc(1 + largura * 3);
  const bruto = [];
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const listra = ((x >> 5) + (y >> 5)) % 2 ? 40 : 0;
      linha[1 + x * 3] = Math.min(255, r + listra); linha[2 + x * 3] = Math.min(255, g + listra); linha[3 + x * 3] = Math.min(255, b + listra);
    }
    bruto.push(Buffer.from(linha));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", ihdr), bloco("IDAT", deflateSync(Buffer.concat(bruto))), bloco("IEND", Buffer.alloc(0)),
  ]);
}

function pdf(titulo) {
  const texto = `BT /F1 18 Tf 72 720 Td (${titulo}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${texto.length} >>\nstream\n${texto}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let corpo = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(corpo.length); corpo += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = corpo.length;
  corpo += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  corpo += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corpo, "latin1");
}

function gerarArquivos() {
  const dir = `${PASTA}/arquivos`;
  mkdirSync(`${dir}/fotos`, { recursive: true });
  const cores = [[200, 90, 60], [60, 140, 200], [90, 170, 90], [210, 170, 50], [150, 90, 180], [60, 170, 170], [200, 110, 150], [120, 120, 120], [170, 120, 70], [80, 100, 160], [230, 80, 80]];
  cores.forEach((cor, i) => writeFileSync(`${dir}/fotos/foto-${String(i + 1).padStart(2, "0")}.png`, png(800, 600, cor)));
  writeFileSync(`${dir}/contrato-fornecedor-a.pdf`, pdf("Contrato de teste - Fornecedor A"));
  writeFileSync(`${dir}/nota-fiscal-teste.pdf`, pdf("Nota fiscal de teste"));
  writeFileSync(`${dir}/certidao-teste.png`, png(600, 800, [240, 240, 240]));
  // PNG com extensão .pdf: o site deve recusar pelo conteúdo, não pelo nome.
  writeFileSync(`${dir}/falso-pdf.pdf`, png(50, 50, [0, 0, 0]));
  writeFileSync(`${dir}/texto-qualquer.txt`, "arquivo de texto: o site deve recusar\n");
}

// --- criação ----------------------------------------------------------------

async function criarConta(conta) {
  const senha = gerarSenha();
  const { data, error } = await db.auth.admin.createUser({ email: `${conta.id}@${DOMINIO}`, password: senha, email_confirm: true });
  falhar(`criar conta ${conta.id}`, error);
  const perfil = { id: data.user.id, papel: conta.papel, nome: conta.nome, ativo: true, precisa_trocar_senha: false };
  const { error: erroPerfil } = await db.from("profiles").insert(perfil);
  if (erroPerfil) await db.auth.admin.deleteUser(data.user.id);
  falhar(`perfil ${conta.id}`, erroPerfil);
  return { ...conta, uid: data.user.id, senha };
}

async function inserir(tabela, linhas) {
  const { data, error } = await db.from(tabela).insert(linhas, { defaultToNull: false }).select("id");
  falhar(`inserir em ${tabela}`, error);
  return data.map((l) => l.id);
}

function mesDeslocado(base, meses, dia) {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + meses, dia));
  return d.toISOString().slice(0, 10);
}

async function semear() {
  const contas = {};
  for (const c of CONTAS) contas[c.id] = await criarConta(c);

  const [emp] = await inserir("empreendimentos", [{ nome: `${PREFIXO} Residencial Etapa 5`, cidade: "Caratinga" }]);
  await inserir("empreendimento_clientes", [{ empreendimento_id: emp, profile_id: contas["teste5-cliente"].uid }]);

  const [fornA, fornB] = await inserir("fornecedores", [
    { razao_social: `${PREFIXO} Concreto Forte Ltda`, nome_fantasia: "Concreto Forte (teste)", cnpj: "11222333000181", contato_nome: "Contato A", observacao: "Fornecedor de teste A" },
    { razao_social: `${PREFIXO} Elétrica Luz Ltda`, nome_fantasia: "Elétrica Luz (teste)", contato_nome: "Contato B" },
  ]);
  await inserir("fornecedor_usuarios", [
    { fornecedor_id: fornA, profile_id: contas["teste5-fornecedor-a"].uid },
    { fornecedor_id: fornB, profile_id: contas["teste5-fornecedor-b"].uid },
  ]);

  const hoje = new Date();
  const m = (meses, dia) => mesDeslocado(hoje, meses, dia);
  const [terraplenagem, estrutura, eletrica, projeto] = await inserir("itens_financeiros", [
    { empreendimento_id: emp, fornecedor_id: fornA, descricao: "Terraplenagem", valor_contratado_centavos: 3000000 },
    { empreendimento_id: emp, fornecedor_id: fornA, descricao: "Estrutura de concreto", valor_contratado_centavos: 12000000 },
    { empreendimento_id: emp, fornecedor_id: fornB, descricao: "Instalação elétrica", valor_contratado_centavos: 4500000 },
    { empreendimento_id: emp, descricao: "Projeto arquitetônico", valor_contratado_centavos: 1500000 },
    { empreendimento_id: emp, descricao: "Paisagismo (sem parcelas)", valor_contratado_centavos: 800000 },
  ]);
  await inserir("parcelas", [
    { item_id: terraplenagem, vencimento: m(-3, 10), valor_previsto_centavos: 1000000, valor_pago_centavos: 1000000, data_pagamento: m(-3, 10), nome: "Entrada" },
    { item_id: terraplenagem, vencimento: m(-2, 10), valor_previsto_centavos: 1000000, valor_pago_centavos: 1000000, data_pagamento: m(-2, 12) },
    { item_id: terraplenagem, vencimento: m(-1, 10), valor_previsto_centavos: 1000000, valor_pago_centavos: 400000, data_pagamento: m(-1, 11) },
    { item_id: estrutura, vencimento: m(-1, 20), valor_previsto_centavos: 3000000 },
    { item_id: estrutura, vencimento: m(0, 28), valor_previsto_centavos: 3000000 },
    { item_id: estrutura, vencimento: m(1, 28), valor_previsto_centavos: 3000000 },
    { item_id: estrutura, vencimento: m(3, 28), valor_previsto_centavos: 2000000 },
    { item_id: eletrica, vencimento: m(1, 15), valor_previsto_centavos: 1500000 },
    { item_id: eletrica, vencimento: m(2, 15), valor_previsto_centavos: 1500000 },
    { item_id: eletrica, vencimento: m(4, 15), valor_previsto_centavos: 1500000 },
    { item_id: projeto, vencimento: m(-4, 5), valor_previsto_centavos: 1500000, valor_pago_centavos: 1500000, data_pagamento: m(-4, 5), nome: "Projeto completo" },
  ]);

  const [obraA, obraB] = await inserir("obras", [
    { empreendimento_id: emp, nome: "Bloco A — fundação e estrutura", previsto_inicio: m(-2, 1), previsto_fim: m(4, 30), situacao: "em_andamento", percentual: 35 },
    { empreendimento_id: emp, nome: "Bloco B — instalações", previsto_inicio: m(1, 1), previsto_fim: m(6, 30), situacao: "planejada", percentual: 0 },
  ]);
  await inserir("obra_empreiteiros", [
    { obra_id: obraA, profile_id: contas["teste5-empreiteiro-a"].uid },
    { obra_id: obraB, profile_id: contas["teste5-empreiteiro-b"].uid },
  ]);

  gerarArquivos();
  const linhas = CONTAS.map((c) => `| ${c.papel} | ${c.nome} | \`${c.id}\` | \`${contas[c.id].senha}\` |`).join("\n");
  writeFileSync(`${PASTA}/CONTAS-TESTE.md`, `# Contas de teste da Etapa 5

Geradas por \`scripts/semear-teste-etapa5.mjs\`. Fora do git. Rodar o script de novo troca todas as senhas.
Entrar em http://localhost:3000/entrar com o identificador (sem @) e a senha.

| Papel | Nome | Identificador | Senha |
|---|---|---|---|
${linhas}

Empreendimento: **${PREFIXO} Residencial Etapa 5**. Fornecedor A = Concreto Forte (CNPJ 11.222.333/0001-81), Fornecedor B = Elétrica Luz (sem CNPJ).
Empreiteiro A está na obra "Bloco A"; Empreiteiro B na "Bloco B".
Arquivos para enviar: \`teste-local/arquivos/\`.
`);
  console.log("Dados de teste criados. Contas e senhas em teste-local/CONTAS-TESTE.md.");
}

await limpar();
if (!argv.includes("--limpar")) await semear();
