import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailConfigurado, enviarEmail, escaparHtml } from "@/lib/email/enviar";
import type { ContatoInput } from "./schema";

async function destinatario(supabase: ReturnType<typeof createAdminClient>) {
  const configurado = process.env.AVISO_CONTATO_PARA?.trim();
  if (configurado) return configurado;
  const { data, error } = await supabase.from("configuracoes_site").select("email").limit(1).maybeSingle<{ email: string | null }>();
  if (error) {
    console.error("[contato] falha ao ler o e-mail de aviso:", error.code);
    return null;
  }
  return data?.email?.trim() || null;
}

async function descreverInteresse(supabase: ReturnType<typeof createAdminClient>, loteamentoId: string | undefined, loteId: string | undefined) {
  const [loteamento, lote] = await Promise.all([
    loteamentoId ? supabase.from("loteamentos").select("nome").eq("id", loteamentoId).maybeSingle<{ nome: string }>() : null,
    loteId ? supabase.from("lotes").select("quadra,numero").eq("id", loteId).maybeSingle<{ quadra: string | null; numero: string | null }>() : null,
  ]);
  const partes: string[] = [];
  if (loteamento?.data) partes.push(`Loteamento ${loteamento.data.nome}`);
  if (lote?.data) partes.push(`lote ${[lote.data.quadra && `quadra ${lote.data.quadra}`, lote.data.numero && `nº ${lote.data.numero}`].filter(Boolean).join(", ")}`.trim());
  return partes.join(" · ") || null;
}

// Roda depois da resposta (after): qualquer falha vira só log e o visitante continua vendo sucesso.
export async function avisarContato(dados: ContatoInput, loteamentoId: string | null | undefined) {
  if (!emailConfigurado()) return;
  try {
    const supabase = createAdminClient();
    const [para, interesse] = await Promise.all([destinatario(supabase), descreverInteresse(supabase, loteamentoId ?? undefined, dados.loteId)]);
    if (!para) return;

    const campos: [string, string][] = [
      ["Nome", dados.nome],
      ["Telefone", dados.telefone || "não informado"],
      ["E-mail", dados.email || "não informado"],
      ["Página de origem", dados.origem],
      ["Interesse", interesse ?? "não informado"],
    ];
    const texto = `${campos.map(([rotulo, valor]) => `${rotulo}: ${valor}`).join("\n")}\n\nMensagem:\n${dados.mensagem}\n`;
    const html = `<p>Novo contato recebido pelo site.</p><ul>${campos.map(([rotulo, valor]) => `<li><strong>${escaparHtml(rotulo)}:</strong> ${escaparHtml(valor)}</li>`).join("")}</ul><p><strong>Mensagem:</strong></p><p>${escaparHtml(dados.mensagem).replace(/\r?\n/g, "<br>")}</p>`;

    await enviarEmail({
      para,
      assunto: `Novo contato pelo site: ${dados.nome.replace(/\s+/g, " ").slice(0, 80)}`,
      texto,
      html,
      responderPara: dados.email || undefined,
    });
  } catch (erro) {
    console.error("[contato] falha ao avisar por e-mail:", erro instanceof Error ? erro.name : "desconhecida");
  }
}
