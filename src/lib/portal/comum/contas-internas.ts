import "server-only";
import { randomInt } from "node:crypto";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ConflictError, InternalServerError, NotFoundError } from "@/app/api/HttpErrors";
import { conferirErro, ler } from "@/lib/portal/andamento/servidor";
import { PERMISSOES, PREREQUISITOS, ehPermissao, type Permissao } from "@/lib/auth/permissoes";
import { atualizarContaSchema, criarContaSchema } from "./contas-schema";
import { auditar, erroDoAuth, identificadorParaEmail } from "./contas";
import type { UUID } from "./tipos";

// O papel de uma conta criada aqui é sempre este: nunca vem do corpo da requisição.
const PAPEL_EQUIPE = "equipe";
const TAMANHO_SENHA = 16;
const BLOQUEIO_PERMANENTE = "876000h";
const CAMPOS = "id,nome,telefone,ativo,precisa_trocar_senha";

export const criarContaInternaSchema = criarContaSchema.pick({ nome: true, telefone: true, identificador: true });
export const atualizarContaInternaSchema = atualizarContaSchema;
export const idContaInternaSchema = z.uuid();
export const permissoesEquipeSchema = z.object({
  permissoes: z
    .array(z.enum(PERMISSOES))
    .max(PERMISSOES.length)
    .refine((lista) => new Set(lista).size === lista.length, "Há permissões repetidas.")
    .refine(
      (lista) => lista.every((permissao) => (PREREQUISITOS[permissao] ?? []).every((prerequisito) => lista.includes(prerequisito))),
      "Falta uma permissão exigida por outra que foi marcada.",
    ),
});

export type CriarContaInternaInput = z.infer<typeof criarContaInternaSchema>;
export type AtualizarContaInternaInput = z.infer<typeof atualizarContaInternaSchema>;

export type ContaInterna = {
  id: UUID;
  nome: string;
  telefone: string | null;
  papel: "admin" | "equipe";
  ativo: boolean;
  precisaTrocarSenha: boolean;
  identificador: string;
  ultimoAcesso: string | null;
  permissoes: Permissao[];
};

const contaInternaSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
  telefone: z.string().nullable(),
  papel: z.enum(["admin", "equipe"]),
  ativo: z.boolean(),
  precisa_trocar_senha: z.boolean(),
  identificador: z.string(),
  ultimo_acesso: z.string().nullable(),
  permissoes: z.array(z.string()),
});
const perfilSchema = z.object({ id: z.uuid(), nome: z.string(), telefone: z.string().nullable(), ativo: z.boolean(), precisa_trocar_senha: z.boolean() });

const LETRAS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const NUMEROS = "23456789";

// Sem caracteres parecidos (0/O, 1/l/I), como em scripts/criar-admin.mjs.
export function gerarSenhaTemporaria(): string {
  const todos = LETRAS + NUMEROS;
  const caracteres = [LETRAS[randomInt(LETRAS.length)], NUMEROS[randomInt(NUMEROS.length)]];
  while (caracteres.length < TAMANHO_SENHA) caracteres.push(todos[randomInt(todos.length)]);
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return caracteres.join("");
}

export async function listar(): Promise<ContaInterna[]> {
  const sessao = await createClient();
  const { data, error } = await sessao.rpc("listar_contas_internas");
  conferirErro(error);
  return ler(contaInternaSchema.array(), data as unknown).map(({ precisa_trocar_senha, ultimo_acesso, permissoes, ...conta }) => ({
    ...conta,
    precisaTrocarSenha: precisa_trocar_senha,
    ultimoAcesso: ultimo_acesso,
    permissoes: permissoes.filter(ehPermissao),
  }));
}

async function lerContaDaEquipe(id: UUID) {
  const sessao = await createClient();
  const { data, error } = await sessao.from("profiles").select(CAMPOS).eq("id", id).eq("papel", PAPEL_EQUIPE).maybeSingle();
  conferirErro(error);
  if (!data) throw new NotFoundError("Conta não encontrada.");
  return ler(perfilSchema, data as unknown);
}

export async function criar(entrada: CriarContaInternaInput, atorId: UUID): Promise<{ id: UUID; senhaTemporaria: string }> {
  entrada = criarContaInternaSchema.parse(entrada);
  const senhaTemporaria = gerarSenhaTemporaria();
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email: identificadorParaEmail(entrada.identificador), password: senhaTemporaria, email_confirm: true });
  if (error) throw erroDoAuth(error);
  if (!data.user) throw new InternalServerError(null);
  const id = data.user.id;
  const perfil = { id, nome: entrada.nome, telefone: entrada.telefone ?? null, papel: PAPEL_EQUIPE, ativo: true, precisa_trocar_senha: true };
  try {
    const gravar = await admin.from("profiles").insert(perfil);
    conferirErro(gravar.error);
    await auditar(admin, { registro_id: id, ator_id: atorId, acao: "INSERT", antes: null, depois: perfil });
  } catch (erro) {
    const desfazer = await admin.auth.admin.deleteUser(id);
    if (desfazer.error) {
      console.error("[equipe] compensação Auth:", desfazer.error.code, desfazer.error.status);
      throw new InternalServerError("Cadastro não concluído; a equipe precisa reconciliar a conta antes de repetir.");
    }
    throw erro;
  }
  return { id, senhaTemporaria };
}

async function definirBloqueio(admin: ReturnType<typeof createAdminClient>, id: UUID, bloqueado: boolean) {
  const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: bloqueado ? BLOQUEIO_PERMANENTE : "none" });
  if (!error) return;
  console.error("[equipe] bloqueio no Auth:", error.code, error.status);
  throw new InternalServerError(
    bloqueado
      ? "A conta já não acessa o painel, mas o encerramento da sessão não foi concluído. Salve de novo para concluir."
      : "Não foi possível reativar a conta. Tente novamente.",
  );
}

export async function atualizar(entrada: AtualizarContaInternaInput, atorId: UUID): Promise<{ id: UUID }> {
  entrada = atualizarContaInternaSchema.parse(entrada);
  const antes = await lerContaDaEquipe(entrada.id);
  const admin = createAdminClient();
  const depois = { nome: entrada.nome, telefone: entrada.telefone, ativo: entrada.ativo };
  const reativando = !antes.ativo && entrada.ativo;
  if (reativando) await definirBloqueio(admin, entrada.id, false);
  const gravar = await admin.from("profiles").update(depois).eq("id", entrada.id).eq("papel", PAPEL_EQUIPE).select("id").maybeSingle();
  conferirErro(gravar.error);
  if (!gravar.data) throw new NotFoundError("Conta não encontrada.");
  // Sempre que a conta termina inativa o bloqueio é reaplicado: uma tentativa anterior que falhou no Auth se corrige ao salvar de novo.
  if (!entrada.ativo) await definirBloqueio(admin, entrada.id, true);
  try {
    await auditar(admin, { registro_id: entrada.id, ator_id: atorId, acao: "UPDATE", antes, depois });
  } catch {
    // O trigger registra a alteração sem ator; sinalizar reconciliação evita sucesso silencioso.
    throw new InternalServerError("Conta salva, mas a auditoria do responsável falhou. Reconciliar a auditoria antes de continuar.");
  }
  return { id: entrada.id };
}

export async function redefinirSenha(id: UUID, atorId: UUID): Promise<{ id: UUID; senhaTemporaria: string }> {
  id = idContaInternaSchema.parse(id);
  const antes = await lerContaDaEquipe(id);
  if (!antes.ativo) throw new ConflictError("Reative a conta antes de redefinir a senha.");
  const senhaTemporaria = gerarSenhaTemporaria();
  const admin = createAdminClient();
  // A troca obrigatória vai primeiro: se a senha falhar em seguida, a conta só pede troca com a senha antiga.
  const marcar = await admin.from("profiles").update({ precisa_trocar_senha: true }).eq("id", id).eq("papel", PAPEL_EQUIPE).eq("ativo", true).select("id").maybeSingle();
  conferirErro(marcar.error);
  if (!marcar.data) throw new NotFoundError("Conta não encontrada.");
  const { error } = await admin.auth.admin.updateUserById(id, { password: senhaTemporaria });
  if (error) {
    console.error("[equipe] redefinição no Auth:", error.code, error.status);
    throw new InternalServerError("Não foi possível redefinir a senha. Tente novamente.");
  }
  // Uma troca de senha em andamento pode ter limpado a marca nesse intervalo; a temporária nunca fica sem troca obrigatória.
  const remarcar = await admin.from("profiles").update({ precisa_trocar_senha: true }).eq("id", id).eq("papel", PAPEL_EQUIPE).select("id").maybeSingle();
  conferirErro(remarcar.error);
  if (!remarcar.data) throw new NotFoundError("Conta não encontrada.");
  try {
    await auditar(admin, {
      registro_id: id,
      ator_id: atorId,
      acao: "UPDATE",
      antes: { precisa_trocar_senha: antes.precisa_trocar_senha },
      depois: { precisa_trocar_senha: true, senha_redefinida: true },
    });
  } catch {
    throw new InternalServerError("A senha foi redefinida, mas a auditoria falhou e a nova senha não pode ser exibida. Redefina de novo para ver uma senha.");
  }
  return { id, senhaTemporaria };
}

export async function salvarPermissoes(id: UUID, permissoes: readonly Permissao[]): Promise<{ id: UUID; permissoes: Permissao[] }> {
  id = idContaInternaSchema.parse(id);
  const lista = permissoesEquipeSchema.parse({ permissoes }).permissoes;
  await lerContaDaEquipe(id);
  const sessao = await createClient();
  const { error } = await sessao.rpc("salvar_permissoes_equipe", { p_profile_id: id, p_permissoes: lista });
  conferirErro(error);
  return { id, permissoes: lista };
}
