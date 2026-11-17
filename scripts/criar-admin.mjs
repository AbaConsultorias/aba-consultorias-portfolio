// Cria a primeira conta de administrador (ou outra conta de staff).
// Uso: node --env-file=.env scripts/criar-admin.mjs
// Pergunta e-mail e nome, gera uma senha temporária aleatória e mostra só
// neste terminal. No primeiro acesso o site obriga a trocar a senha.
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, exit } from "node:process";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const adminPath = process.env.ADMIN_PATH;

if (!url || !secretKey) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY no .env.");
  exit(1);
}

function gerarSenha(tamanho = 16) {
  // Sem caracteres parecidos (0/O, 1/l/I) para facilitar digitar.
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const numeros = "23456789";
  const todos = letras + numeros;
  const chars = [letras[randomInt(letras.length)], numeros[randomInt(numeros.length)]];
  while (chars.length < tamanho) chars.push(todos[randomInt(todos.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const rl = createInterface({ input: stdin, output: stdout });
const email = (await rl.question("E-mail do administrador: ")).trim().toLowerCase();
const nome = (await rl.question("Nome: ")).trim();
const papelResposta = (await rl.question("Papel [admin/equipe] (Enter = admin): ")).trim().toLowerCase();
rl.close();

const papel = papelResposta === "equipe" ? "equipe" : "admin";

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !nome) {
  console.error("E-mail ou nome inválido.");
  exit(1);
}

const supabase = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const senha = gerarSenha();

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password: senha,
  email_confirm: true,
});

if (error || !data.user) {
  console.error("Não foi possível criar a conta:", error?.message);
  exit(1);
}

const { error: erroPerfil } = await supabase.from("profiles").insert({
  id: data.user.id,
  papel,
  nome,
  precisa_trocar_senha: true,
});

if (erroPerfil) {
  // Sem perfil a conta não entra em lugar nenhum; desfaz para não sobrar lixo.
  await supabase.auth.admin.deleteUser(data.user.id);
  console.error("Não foi possível criar o perfil:", erroPerfil.message);
  exit(1);
}

console.log("\nConta criada.");
console.log(`Papel: ${papel}`);
console.log(`Senha temporária: ${senha}`);
console.log("Anote a senha agora; ela não será mostrada de novo.");
if (adminPath) {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
  console.log(`Painel: ${site}/${adminPath}/entrar`);
  console.log("O caminho vem do ADMIN_PATH do ambiente onde o painel roda: em produção vale o da Vercel, que pode ser outro.");
}
