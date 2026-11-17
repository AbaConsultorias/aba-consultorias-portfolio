import "server-only";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BadRequestError, ConflictError, HttpError, InternalServerError, NotFoundError } from "@/app/api/HttpErrors";
import { conferirErro, ler, paginacao, paginaDe } from "@/lib/portal/andamento/servidor";
import { criarContaSchema, atualizarContaSchema, papelContaSchema, type PapelConta } from "./contas-schema";
import type { ConsultaPagina, Pagina, UUID } from "./tipos";
export type { PapelConta } from "./contas-schema";
export type ContaPortal = { id: UUID; nome: string; telefone: string | null; ativo: boolean; precisaTrocarSenha: boolean };

const perfilSchema = z.object({ id: z.uuid(), nome: z.string(), telefone: z.string().nullable(), ativo: z.boolean(), precisa_trocar_senha: z.boolean() });
const CAMPOS = "id,nome,telefone,ativo,precisa_trocar_senha";

export function identificadorParaEmail(identificador: string): string {
  const valor = identificador.trim().toLowerCase();
  return valor.includes("@") ? valor : `${valor}@acesso.abaconsultorias.com.br`;
}

export async function listarContas(papel: PapelConta, entrada: ConsultaPagina = {}): Promise<Pagina<ContaPortal>> {
  papelContaSchema.parse(papel);
  const sessao = await createClient();
  const { inicio, pagina, limite } = paginacao(entrada);
  const { data, error } = await sessao.from("profiles").select(CAMPOS).eq("papel", papel).order("nome").order("id").range(inicio, inicio + limite);
  conferirErro(error);
  return paginaDe(ler(perfilSchema.array(), data as unknown).map(({ precisa_trocar_senha, ...conta }) => ({ ...conta, precisaTrocarSenha: precisa_trocar_senha })), pagina, limite);
}

export async function auditar(admin: ReturnType<typeof createAdminClient>, registro: { registro_id: string; ator_id: string; acao: "INSERT" | "UPDATE"; antes: unknown; depois: unknown }) {
  let erro: unknown;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const { error } = await admin.from("auditoria").insert({ tabela: "profiles", ...registro });
    if (!error) return;
    erro = error;
  }
  conferirErro(erro);
}

// Mensagens fixas: o texto do Auth pode repetir o e-mail ou a senha informados.
export function erroDoAuth(error: { code?: string; status?: number }): HttpError {
  if (error.code === "email_exists" || error.code === "user_already_exists") return new ConflictError("Identificador já cadastrado.");
  if (error.code === "weak_password") return new BadRequestError("Senha fraca demais. Escolha outra, mais longa e menos comum.");
  if (error.code === "email_address_invalid" || error.code === "validation_failed") return new BadRequestError("Identificador inválido.");
  if (error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 429) {
    console.error("[portal] criação no Auth recusada:", error.code, error.status);
    return new BadRequestError("Não foi possível criar a conta com os dados informados.");
  }
  console.error("[portal] criação no Auth:", error.code, error.status);
  return new InternalServerError("Não foi possível concluir a operação.");
}

export async function criarConta(papel: PapelConta, entrada: z.infer<typeof criarContaSchema>, atorId: UUID): Promise<{ id: UUID }> {
  papelContaSchema.parse(papel);
  entrada = criarContaSchema.parse(entrada);
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email: identificadorParaEmail(entrada.identificador), password: entrada.senha, email_confirm: true });
  if (error) throw erroDoAuth(error);
  if (!data.user) throw new InternalServerError(null);
  const id = data.user.id;
  const perfil = { id, nome: entrada.nome, telefone: entrada.telefone ?? null, papel, ativo: true, precisa_trocar_senha: true };
  try {
    const gravar = await admin.from("profiles").insert(perfil);
    conferirErro(gravar.error);
    await auditar(admin, { registro_id: id, ator_id: atorId, acao: "INSERT", antes: null, depois: perfil });
  } catch (erro) {
    const desfazer = await admin.auth.admin.deleteUser(id);
    if (desfazer.error) {
      console.error("[portal] compensação Auth:", desfazer.error.code, desfazer.error.status);
      throw new InternalServerError("Cadastro não concluído; a equipe precisa reconciliar a conta antes de repetir.");
    }
    throw erro;
  }
  return { id };
}

export async function atualizarConta(papel: PapelConta, entrada: z.infer<typeof atualizarContaSchema>, atorId: UUID): Promise<{ id: UUID }> {
  papelContaSchema.parse(papel);
  entrada = atualizarContaSchema.parse(entrada);
  const sessao = await createClient();
  const { data, error } = await sessao.from("profiles").select(CAMPOS).eq("id", entrada.id).eq("papel", papel).maybeSingle();
  conferirErro(error);
  if (!data) throw new NotFoundError();
  const antes = ler(perfilSchema, data as unknown);
  const admin = createAdminClient();
  const depois = { nome: entrada.nome, telefone: entrada.telefone, ativo: entrada.ativo };
  const gravar = await admin.from("profiles").update(depois).eq("id", entrada.id).eq("papel", papel).select("id").maybeSingle();
  conferirErro(gravar.error);
  if (!gravar.data) throw new NotFoundError();
  try {
    await auditar(admin, { registro_id: entrada.id, ator_id: atorId, acao: "UPDATE", antes, depois });
  } catch {
    // O trigger registra a alteração sem ator; sinalizar reconciliação evita sucesso silencioso.
    throw new InternalServerError("Perfil salvo, mas a auditoria do responsável falhou. Reconciliar a auditoria antes de continuar.");
  }
  return { id: entrada.id };
}
