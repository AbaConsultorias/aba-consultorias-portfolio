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
import { entrarSchema, type EntrarInput } from "@/app/api/(modules)/entrar/schema";
import { MENSAGEM_SEM_CONEXAO, destinoDaResposta, lerResposta, mensagemDeErro } from "./resposta";

export function LoginForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<EntrarInput>({
    resolver: zodResolver(entrarSchema),
    defaultValues: { identificador: "", senha: "" },
  });

  async function onSubmit(data: EntrarInput) {
    setServerError(null);

    let res: Response;
    let resposta: Awaited<ReturnType<typeof lerResposta>>;
    try {
      res = await fetch("/api/entrar", {
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
      setServerError(mensagemDeErro(resposta, res.status));
      return;
    }

    // refresh() reexecuta os Server Components, pra área de destino já
    // ler a sessão nova gravada pelo /api/entrar.
    router.push(destino);
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>Acesse sua área com e-mail ou usuário e senha.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* noValidate: a validação de verdade é a do react-hook-form +
            Zod, mostrada por campo com FieldError — o balão nativo do
            navegador ficaria inconsistente com o resto do visual. */}
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <Controller
              name="identificador"
              control={control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="identificador">E-mail ou usuário</FieldLabel>
                  <Input
                    {...field}
                    id="identificador"
                    autoComplete="username"
                    autoCapitalize="none"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                </Field>
              )}
            />
            <Controller
              name="senha"
              control={control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="senha">Senha</FieldLabel>
                  <Input
                    {...field}
                    id="senha"
                    type="password"
                    autoComplete="current-password"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                </Field>
              )}
            />
            {serverError && (
              <p role="alert" className="text-sm text-destructive">
                {serverError}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Entrando..." : "Entrar"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
