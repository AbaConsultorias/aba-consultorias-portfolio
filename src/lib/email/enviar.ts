import "server-only";

const URL_RESEND = "https://api.resend.com/emails";
const TEMPO_LIMITE_MS = 8_000;

export type Email = {
  para: string | null | undefined;
  assunto: string;
  texto: string;
  html: string;
  responderPara?: string;
};

export function emailConfigurado() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_REMETENTE);
}

export function escaparHtml(valor: string) {
  return valor.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Nunca lança: sem as variáveis do Resend o site segue funcionando sem e-mail, e
// uma falha de envio não pode derrubar quem chamou. O log guarda só status/nome do
// erro, sem destinatário nem conteúdo.
export async function enviarEmail({ para, assunto, texto, html, responderPara }: Email): Promise<void> {
  const chave = process.env.RESEND_API_KEY;
  const remetente = process.env.EMAIL_REMETENTE;
  if (!chave || !remetente || !para) return;

  const controle = new AbortController();
  const temporizador = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    const resposta = await fetch(URL_RESEND, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: remetente, to: [para], subject: assunto, text: texto, html, ...(responderPara && { reply_to: responderPara }) }),
      signal: controle.signal,
    });
    if (!resposta.ok) console.error("[email] Resend recusou o envio:", resposta.status);
  } catch (erro) {
    console.error("[email] falha ao enviar:", erro instanceof Error ? erro.name : "desconhecida");
  } finally {
    clearTimeout(temporizador);
  }
}
