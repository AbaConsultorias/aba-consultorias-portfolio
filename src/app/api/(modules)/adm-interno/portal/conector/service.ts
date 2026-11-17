import "server-only";
import { ConflictError, InternalServerError, NotFoundError } from "@/app/api/HttpErrors";
import { gerarChave } from "@/lib/conector/autenticacao";
import { createClient } from "@/lib/supabase/server";
import type { EmitirInput } from "./schema";

type Sessao = Awaited<ReturnType<typeof createClient>>;

// token_hash não é legível por usuário logado (privilégio por coluna): sempre se listam as colunas.
const COLUNAS_DO_CONECTOR = "id,nome,criado_em,ultimo_contato_em,versao,ultimo_ciclo";
const ERROS_NO_RESUMO = 20;
const CODIGO_DUPLICADO = "23505";

type LinhaConector = {
  id: string;
  nome: string;
  criado_em: string;
  ultimo_contato_em: string | null;
  versao: string | null;
  ultimo_ciclo: unknown;
};

export type ResumoDoCiclo = {
  inicio: string | null;
  fim: string | null;
  contagens: Record<string, number>;
  totalErros: number;
  erros: { codigoPasta: string | null; mensagem: string }[];
} | null;

export type EstadoDoConector =
  | { ativo: false }
  | { ativo: true; id: string; nome: string; criadoEm: string; ultimoContatoEm: string | null; versao: string | null; ultimoCiclo: ResumoDoCiclo };

function falhaDeBanco(operacao: string, error: { code?: string }): never {
  console.error("[conector] admin:", operacao, error.code);
  throw new InternalServerError(null);
}

const ehObjeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === "object" && valor !== null && !Array.isArray(valor);
const textoOuNulo = (valor: unknown): string | null => (typeof valor === "string" ? valor : null);

// ultimo_ciclo é jsonb gravado pelo programa do servidor: nada nele é confiável, então só se copia o que tem o tipo esperado.
export function resumirCiclo(ultimoCiclo: unknown): ResumoDoCiclo {
  if (!ehObjeto(ultimoCiclo)) return null;
  const contagens: Record<string, number> = {};
  if (ehObjeto(ultimoCiclo.contagens)) {
    for (const [nome, valor] of Object.entries(ultimoCiclo.contagens)) {
      if (typeof valor === "number" && Number.isFinite(valor)) contagens[nome] = valor;
    }
  }
  const lista = Array.isArray(ultimoCiclo.erros) ? (ultimoCiclo.erros as unknown[]) : [];
  const erros = lista.flatMap((item) => {
    if (!ehObjeto(item) || typeof item.mensagem !== "string") return [];
    return [{ codigoPasta: textoOuNulo(item.codigo_pasta), mensagem: item.mensagem.slice(0, 500) }];
  });
  return {
    inicio: textoOuNulo(ultimoCiclo.inicio),
    fim: textoOuNulo(ultimoCiclo.fim),
    contagens,
    totalErros: erros.length,
    erros: erros.slice(0, ERROS_NO_RESUMO),
  };
}

export async function estadoDoConector(sessao: Sessao): Promise<EstadoDoConector> {
  const { data, error } = await sessao.from("conectores").select(COLUNAS_DO_CONECTOR).is("revogado_em", null).maybeSingle();
  if (error) return falhaDeBanco("consulta do conector:", error);
  const linha = data as LinhaConector | null;
  if (!linha) return { ativo: false };
  return {
    ativo: true,
    id: linha.id,
    nome: linha.nome,
    criadoEm: linha.criado_em,
    ultimoContatoEm: linha.ultimo_contato_em,
    versao: linha.versao,
    ultimoCiclo: resumirCiclo(linha.ultimo_ciclo),
  };
}

// A chave só existe na resposta desta chamada: o banco guarda o sha256. Emitir revoga a anterior antes de gravar a nova
// (só há um conector ativo por vez); se a gravação falhar depois da revogação, fica sem chave ativa, nunca com duas.
export async function emitirChave({ nome }: EmitirInput, sessao: Sessao): Promise<{ id: string; nome: string; criadoEm: string; chave: string }> {
  const { chave, hash } = gerarChave();

  const { error: erroRevogacao } = await sessao.from("conectores")
    .update({ revogado_em: new Date().toISOString() }).is("revogado_em", null);
  if (erroRevogacao) return falhaDeBanco("revogação da chave anterior:", erroRevogacao);

  const { data, error } = await sessao.from("conectores").insert({ nome, token_hash: hash }).select("id,nome,criado_em").single();
  if (error) {
    if (error.code === CODIGO_DUPLICADO) throw new ConflictError("Outra chave foi emitida ao mesmo tempo. Tente de novo.");
    return falhaDeBanco("emissão da chave:", error);
  }
  const criado = data as { id: string; nome: string; criado_em: string };
  return { id: criado.id, nome: criado.nome, criadoEm: criado.criado_em, chave };
}

export async function revogarChave(sessao: Sessao): Promise<void> {
  const { data, error } = await sessao.from("conectores")
    .update({ revogado_em: new Date().toISOString() }).is("revogado_em", null).select("id");
  if (error) return falhaDeBanco("revogação da chave:", error);
  if (((data ?? []) as unknown[]).length === 0) throw new NotFoundError("Não há chave ativa.");
}
