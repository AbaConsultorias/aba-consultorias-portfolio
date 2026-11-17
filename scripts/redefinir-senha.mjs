// Gera uma nova senha temporária para uma conta existente.
// Uso: node --env-file=.env scripts/redefinir-senha.mjs
// A senha aparece só neste terminal; no próximo acesso o site obriga a trocar.
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, exit } from "node:process";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY no .env.");
  exit(1);
}

function gerarSenha(tamanho = 16) {
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
const email = (await rl.question("E-mail da conta: ")).trim().toLowerCase();
rl.close();

const supabase = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let userId;

for (let pagina = 1; !userId; pagina++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: pagina, perPage: 200 });
  if (error) {
    console.error("Não foi possível buscar a conta:", error.message);
    exit(1);
  }
  userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
  if (data.users.length < 200) break;
}

if (!userId) {
  console.error("Conta não encontrada.");
  exit(1);
}

const senha = gerarSenha();

const { error } = await supabase.auth.admin.updateUserById(userId, { password: senha });
if (error) {
  console.error("Não foi possível redefinir a senha:", error.message);
  exit(1);
}

const { error: erroPerfil } = await supabase.from("profiles").update({ precisa_trocar_senha: true }).eq("id", userId);
if (erroPerfil) {
  console.error("A senha foi trocada, mas não foi possível marcar a troca obrigatória no primeiro acesso:", erroPerfil.message);
  console.error("Rode o script de novo para gerar outra senha antes de entregá-la; a senha anterior não deve ser usada.");
  exit(1);
}

console.log("\nSenha temporária redefinida.");
console.log(`Nova senha temporária: ${senha}`);
console.log("Dica: selecione a senha com o mouse e copie (Ctrl+C) para colar no site.");
