"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chamarEquipe } from "./chamarEquipe";

type Props = {
  adminPath: string;
  aoCriar: (senhaTemporaria: string) => void;
};

export function CriarConta({ adminPath, aoCriar }: Props) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [identificador, setIdentificador] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setEnviando(true);
    setErro(null);
    const resposta = await chamarEquipe<{ id: string; senhaTemporaria: string }>(adminPath, "", "POST", {
      nome,
      telefone: telefone.trim() || null,
      identificador,
    });
    setEnviando(false);
    if (!resposta.ok) {
      setErro(resposta.erro);
      return;
    }
    setNome("");
    setTelefone("");
    setIdentificador("");
    router.refresh();
    aoCriar(resposta.dados.senhaTemporaria);
  }

  return (
    <form noValidate onSubmit={enviar} className="space-y-4">
      <fieldset disabled={enviando} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="equipe-nome">Nome</Label>
          <Input id="equipe-nome" className="min-h-11" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="equipe-telefone">Telefone (opcional)</Label>
          <Input id="equipe-telefone" className="min-h-11" value={telefone} onChange={(e) => setTelefone(e.target.value)} autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="equipe-identificador">E-mail ou usuário de acesso</Label>
          <Input id="equipe-identificador" className="min-h-11" value={identificador} onChange={(e) => setIdentificador(e.target.value)} autoComplete="off" />
          <p className="text-sm text-muted-foreground">Sem espaços. Quem informar só um usuário entra com usuario@acesso.abaconsultorias.com.br. A senha é gerada pelo sistema e aparece uma única vez.</p>
        </div>
        <Button type="submit" className="min-h-11">
          <UserPlus aria-hidden="true" />
          {enviando ? "Criando…" : "Criar conta"}
        </Button>
      </fieldset>
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
    </form>
  );
}
