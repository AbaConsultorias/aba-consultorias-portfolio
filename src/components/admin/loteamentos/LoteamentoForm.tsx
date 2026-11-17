"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/admin/comum/campos";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { chamarApi } from "@/components/admin/comum/cliente-api";

type Valores = {
  nome: string;
  slug: string;
  cidade: string;
  endereco: string;
  mapsUrl: string;
  descricao: string;
  publicado: boolean;
};

type Props = {
  adminPath: string;
  // Sem `id` cria um loteamento; com `id` edita.
  id?: string;
  inicial?: Partial<Valores>;
};

const FORMATO_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function gerarSlug(nome: string) {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function erroDeCampo(mensagem?: string) {
  return mensagem ? [{ message: mensagem }] : undefined;
}

export function LoteamentoForm({ adminPath, id, inicial }: Props) {
  const router = useRouter();
  const [valores, setValores] = useState<Valores>({
    nome: inicial?.nome ?? "",
    slug: inicial?.slug ?? "",
    cidade: inicial?.cidade ?? "",
    endereco: inicial?.endereco ?? "",
    mapsUrl: inicial?.mapsUrl ?? "",
    descricao: inicial?.descricao ?? "",
    publicado: inicial?.publicado ?? false,
  });
  const [slugManual, setSlugManual] = useState(Boolean(id));
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);

  function alterar<K extends keyof Valores>(campo: K, valor: Valores[K]) {
    setSalvo(false);
    setValores((atual) => ({ ...atual, [campo]: valor }));
  }

  function validar() {
    const novos: Record<string, string> = {};
    if (valores.nome.trim().length < 2) novos.nome = "Informe o nome.";
    if (!FORMATO_SLUG.test(valores.slug)) novos.slug = "Use só letras minúsculas, números e hífen.";
    if (valores.mapsUrl.trim() && !/^https:\/\/\S+$/.test(valores.mapsUrl.trim())) {
      novos.mapsUrl = "Use um link que comece com https://";
    }
    return novos;
  }

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErroGeral(null);
    setSalvo(false);

    const invalidos = validar();
    setErros(invalidos);
    if (Object.keys(invalidos).length > 0) return;

    setSalvando(true);
    const { publicado, ...demais } = valores;
    const corpo = { ...demais, nome: valores.nome.trim() };
    const resposta = id
      ? await chamarApi(adminPath, `loteamentos/${id}`, "PATCH", corpo)
      : await chamarApi<{ id: string }>(adminPath, "loteamentos", "POST", { ...corpo, publicado });
    setSalvando(false);

    if (!resposta.ok) {
      setErros(resposta.erros);
      setErroGeral(resposta.erro);
      return;
    }

    if (!id) {
      const novoId = (resposta.details as { id: string } | null)?.id;
      router.push(`/${adminPath}/conteudo/loteamentos/${novoId}`);
      router.refresh();
      return;
    }

    setSalvo(true);
    router.refresh();
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-5">
      <FieldGroup>
        <Field data-invalid={Boolean(erros.nome)}>
          <FieldLabel htmlFor="lot-nome">Nome</FieldLabel>
          <Input
            id="lot-nome"
            value={valores.nome}
            maxLength={120}
            aria-invalid={Boolean(erros.nome)}
            onChange={(e) => {
              const nome = e.target.value;
              alterar("nome", nome);
              if (!slugManual) setValores((atual) => ({ ...atual, slug: gerarSlug(nome) }));
            }}
          />
          <FieldError errors={erroDeCampo(erros.nome)} />
        </Field>

        <Field data-invalid={Boolean(erros.slug)}>
          <FieldLabel htmlFor="lot-slug">Endereço da página no site</FieldLabel>
          <Input
            id="lot-slug"
            value={valores.slug}
            maxLength={80}
            aria-invalid={Boolean(erros.slug)}
            onChange={(e) => {
              setSlugManual(true);
              alterar("slug", e.target.value.toLowerCase());
            }}
          />
          <FieldDescription>
            Gerado a partir do nome. O link fica /loteamentos/{valores.slug || "endereco-da-pagina"}. Mudar depois de
            publicado quebra links já divulgados.
          </FieldDescription>
          <FieldError errors={erroDeCampo(erros.slug)} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={Boolean(erros.cidade)}>
            <FieldLabel htmlFor="lot-cidade">Cidade</FieldLabel>
            <Input
              id="lot-cidade"
              value={valores.cidade}
              maxLength={120}
              aria-invalid={Boolean(erros.cidade)}
              onChange={(e) => alterar("cidade", e.target.value)}
            />
            <FieldError errors={erroDeCampo(erros.cidade)} />
          </Field>
          <Field data-invalid={Boolean(erros.endereco)}>
            <FieldLabel htmlFor="lot-endereco">Endereço</FieldLabel>
            <Input
              id="lot-endereco"
              value={valores.endereco}
              maxLength={255}
              aria-invalid={Boolean(erros.endereco)}
              onChange={(e) => alterar("endereco", e.target.value)}
            />
            <FieldError errors={erroDeCampo(erros.endereco)} />
          </Field>
        </div>

        <Field data-invalid={Boolean(erros.mapsUrl)}>
          <FieldLabel htmlFor="lot-maps">Link do Google Maps</FieldLabel>
          <Input
            id="lot-maps"
            type="url"
            inputMode="url"
            value={valores.mapsUrl}
            maxLength={500}
            placeholder="https://maps.google.com/..."
            aria-invalid={Boolean(erros.mapsUrl)}
            onChange={(e) => alterar("mapsUrl", e.target.value)}
          />
          <FieldError errors={erroDeCampo(erros.mapsUrl)} />
        </Field>

        <Field data-invalid={Boolean(erros.descricao)}>
          <FieldLabel htmlFor="lot-descricao">Descrição</FieldLabel>
          <Textarea
            id="lot-descricao"
            value={valores.descricao}
            maxLength={5000}
            rows={6}
            aria-invalid={Boolean(erros.descricao)}
            onChange={(e) => alterar("descricao", e.target.value)}
          />
          <FieldError errors={erroDeCampo(erros.descricao)} />
        </Field>

        {!id && (
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={valores.publicado}
              onChange={(e) => alterar("publicado", e.target.checked)}
              className="size-4 accent-[var(--brand)]"
            />
            Publicar no site assim que criar
          </label>
        )}
      </FieldGroup>

      <MensagemDeErro>{erroGeral}</MensagemDeErro>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={salvando}>
          {salvando ? "Salvando..." : id ? "Salvar alterações" : "Criar loteamento"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {salvo ? "Alterações salvas." : ""}
        </p>
      </div>
    </form>
  );
}
