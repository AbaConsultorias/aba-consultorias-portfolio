"use client";

import { useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { contatoSchema, type ContatoInput } from "@/app/api/(modules)/contato/schema";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useMovimentoReduzido } from "../ganchos";

type Campo = "nome" | "telefone" | "email" | "mensagem";
type Valores = Record<Campo | "site", string>;
const INICIAL: Valores = { nome: "", telefone: "", email: "", mensagem: "", site: "" };
const CAMPOS = [{ nome: "nome", rotulo: "Seu nome", tipo: "text", autoComplete: "name", limite: 120 }, { nome: "telefone", rotulo: "Telefone com DDD", tipo: "tel", autoComplete: "tel", limite: 32 }, { nome: "email", rotulo: "E-mail", tipo: "email", autoComplete: "email", limite: 254 }] as const;
const ESTILO_CAMPO = "min-h-12 rounded-xl border-brand-dark/20 bg-white px-4 text-base focus-visible:border-brand focus-visible:ring-brand/30";

function errosDosCampos(dados: unknown): Partial<Record<Campo, string>> {
  const resultado = contatoSchema.safeParse(dados);
  if (resultado.success) return {};
  const erros: Partial<Record<Campo, string>> = {};
  for (const erro of resultado.error.issues) {
    const campo = erro.path[0];
    if (campo === "nome" || campo === "telefone" || campo === "email" || campo === "mensagem") erros[campo] ??= erro.message;
  }
  return erros;
}

type Interesse = { id: string; nome: string; lote?: { quadra: string; numero: string } };
const LIMITE_MENSAGEM = 2000;

function prefixoDoInteresse(interesse?: Interesse) {
  if (!interesse) return "";
  const lote = interesse.lote ? `, quadra ${interesse.lote.quadra}, lote ${interesse.lote.numero}` : "";
  return `Interesse: Loteamento ${interesse.nome}${lote}`;
}

export function FormularioContato({ interesse }: { interesse?: Interesse }) {
  const prefixo = prefixoDoInteresse(interesse);
  const limiteDigitado = prefixo ? LIMITE_MENSAGEM - prefixo.length - 2 : LIMITE_MENSAGEM;
  const [valores, setValores] = useState<Valores>(INICIAL);
  const [tocados, setTocados] = useState<Partial<Record<Campo, boolean>>>({});
  const [enviando, setEnviando] = useState(false);
  const [estado, setEstado] = useState<"inicial" | "sucesso" | "erro">("inicial");
  const [mensagemErro, setMensagemErro] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const reduzir = useMovimentoReduzido();
  const dados: ContatoInput = { ...valores, origem: "contato", loteamentoId: interesse?.id };
  const erros = errosDosCampos(dados);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setTocados({ nome: true, telefone: true, email: true, mensagem: true });
    const validacao = contatoSchema.safeParse(dados);
    if (!validacao.success) {
      const primeiro = validacao.error.issues[0]?.path[0];
      if (typeof primeiro === "string") (form.current?.elements.namedItem(primeiro) as HTMLElement | null)?.focus();
      return;
    }
    setEnviando(true);
    setEstado("inicial");
    try {
      const corpo = prefixo ? { ...validacao.data, mensagem: `${prefixo}\n\n${validacao.data.mensagem}` } : validacao.data;
      const resposta = await fetch("/api/contato", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      if (!resposta.ok) {
        setMensagemErro(resposta.status === 429 ? "Aguarde alguns minutos e tente novamente." : "Não foi possível enviar sua mensagem. Tente novamente ou fale com a equipe pelo WhatsApp.");
        setEstado("erro");
        return;
      }
      setEstado("sucesso");
      setValores(INICIAL);
      setTocados({});
    } catch {
      setMensagemErro("Não foi possível conectar. Confira sua conexão e tente novamente.");
      setEstado("erro");
    } finally { setEnviando(false); }
  }

  return <form ref={form} onSubmit={enviar} noValidate aria-busy={enviando} className="rounded-[2rem] border border-brand-dark/10 bg-white p-6 sm:p-10">
    <h2 className="text-2xl font-semibold tracking-tight">Conte o que você precisa</h2>
    <p className="mt-3 text-sm leading-6 text-[#526B78]">Informe telefone ou e-mail para que a equipe possa responder.</p>
    {prefixo && <p className="mt-5 rounded-xl bg-brand/10 p-4 text-sm font-semibold text-brand-dark">{prefixo}</p>}
    <fieldset disabled={enviando} className="mt-8 space-y-6">
      <legend className="sr-only">Seus dados e mensagem</legend>
      {CAMPOS.map((campo) => <Field key={campo.nome} data-invalid={tocados[campo.nome] && !!erros[campo.nome]}>
        <FieldLabel htmlFor={`contato-${campo.nome}`}>{campo.rotulo}{campo.nome === "nome" ? " (obrigatório)" : ""}</FieldLabel>
        <Input id={`contato-${campo.nome}`} name={campo.nome} type={campo.tipo} autoComplete={campo.autoComplete} maxLength={campo.limite} required={campo.nome === "nome"} value={valores[campo.nome]} onChange={(e) => setValores({ ...valores, [campo.nome]: e.target.value })} onBlur={() => setTocados({ ...tocados, [campo.nome]: true })} aria-invalid={!!tocados[campo.nome] && !!erros[campo.nome]} aria-describedby={tocados[campo.nome] && erros[campo.nome] ? `erro-${campo.nome}` : undefined} className={ESTILO_CAMPO} />
        {tocados[campo.nome] && erros[campo.nome] && <p id={`erro-${campo.nome}`} className="text-sm text-destructive">{erros[campo.nome]}</p>}
      </Field>)}
      <Field data-invalid={tocados.mensagem && !!erros.mensagem}><FieldLabel htmlFor="contato-mensagem">Mensagem (obrigatória)</FieldLabel>
        <textarea id="contato-mensagem" name="mensagem" required rows={5} maxLength={limiteDigitado} value={valores.mensagem} onChange={(e) => setValores({ ...valores, mensagem: e.target.value })} onBlur={() => setTocados({ ...tocados, mensagem: true })} aria-invalid={!!tocados.mensagem && !!erros.mensagem} aria-describedby={tocados.mensagem && erros.mensagem ? "erro-mensagem" : undefined} className={`${ESTILO_CAMPO} w-full min-w-0 resize-y border py-3 outline-none transition-colors duration-500 focus-visible:ring-3 aria-invalid:border-destructive`} />
        {tocados.mensagem && erros.mensagem && <p id="erro-mensagem" className="text-sm text-destructive">{erros.mensagem}</p>}
      </Field>
      <div aria-hidden="true" className="hidden"><label htmlFor="contato-site">Site</label><input id="contato-site" name="site" tabIndex={-1} autoComplete="off" value={valores.site} onChange={(e) => setValores({ ...valores, site: e.target.value })} /></div>
      <Button type="submit" disabled={enviando} className="min-h-12 w-full rounded-full bg-brand-dark px-6 text-white transition-colors duration-500 hover:bg-brand focus-visible:ring-brand/40">{enviando ? "Enviando mensagem…" : "Enviar mensagem"}<ArrowUpRight aria-hidden="true" className="size-4" /></Button>
    </fieldset>
    <div aria-live="polite" aria-atomic="true"><AnimatePresence mode="wait">{estado !== "inicial" && <motion.div key={estado} initial={{ opacity: 0, y: reduzir ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduzir ? 0 : -8 }} transition={{ duration: reduzir ? 0 : 0.3 }} className={`mt-6 rounded-xl border p-4 text-sm leading-6 ${estado === "sucesso" ? "border-emerald-800/20 bg-emerald-50 text-emerald-900" : "border-destructive/20 bg-destructive/5 text-destructive"}`}>
      {estado === "sucesso" ? <p className="flex gap-3"><CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" /><span>Mensagem recebida. Obrigado pelo contato! A equipe responderá pelos dados informados.</span></p> : mensagemErro}
    </motion.div>}</AnimatePresence></div>
  </form>;
}
