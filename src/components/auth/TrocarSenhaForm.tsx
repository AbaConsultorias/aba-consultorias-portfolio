"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  trocarSenhaSchema,
  type TrocarSenhaInput,
} from "@/app/api/(modules)/trocar-senha/schema";
import { MENSAGEM_SEM_CONEXAO, destinoDaResposta, lerResposta, mensagemDeErro } from "./resposta";

const CAMPOS = [
  { name: "senhaAtual", label: "Senha atual", autoComplete: "current-password" },
  { name: "novaSenha", label: "Nova senha", autoComplete: "new-password" },
  { name: "confirmacao", label: "Confirmar nova senha", autoComplete: "new-password" },
] as const;

// Erros de campo do servidor chegam em details como
// { campo: { errors: ["..."] } } (mesmo formato do validation()).
function errosDeCampo(details: unknown) {
  if (typeof details !== "object" || details === null) return [];

  return CAMPOS.flatMap(({ name }) => {
    const campo = (details as Record<string, unknown>)[name];
    const mensagem = (campo as { errors?: unknown } | undefined)?.errors;
    return Array.isArray(mensagem) && typeof mensagem[0] === "string"
      ? [{ name, message: mensagem[0] }]
      : [];
  });
}

export function TrocarSenhaForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { isSubmitting },
  } = useForm<TrocarSenhaInput>({
    resolver: zodResolver(trocarSenhaSchema),
    defaultValues: { senhaAtual: "", novaSenha: "", confirmacao: "" },
  });

  async function onSubmit(data: TrocarSenhaInput) {
    setServerError(null);

    let res: Response;
    let resposta: Awaited<ReturnType<typeof lerResposta>>;
    try {
      res = await fetch("/api/trocar-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      resposta = await lerResposta(res);
    } catch {
      setServerError(MENSAGEM_SEM_CONEXAO);
      return;
    }
    const destino = destinoDaResposta(resposta);

    if (!res.ok || !destino) {
      const erros = errosDeCampo(resposta.details);
      if (erros.length > 0) {
        erros.forEach(({ name, message }) => setError(name, { message }));
      } else {
        setServerError(mensagemDeErro(resposta, res.status));
      }
      return;
    }

    router.push(destino);
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Trocar senha</CardTitle>
        <CardDescription>
          A nova senha precisa ter pelo menos 10 caracteres, com letra e número.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            {CAMPOS.map(({ name, label, autoComplete }) => (
              <Controller
                key={name}
                name={name}
                control={control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={name}>{label}</FieldLabel>
                    <Input
                      {...field}
                      id={name}
                      type="password"
                      autoComplete={autoComplete}
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                  </Field>
                )}
              />
            ))}
            {serverError && (
              <p role="alert" className="text-sm text-destructive">
                {serverError}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Salvando..." : "Salvar nova senha"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
