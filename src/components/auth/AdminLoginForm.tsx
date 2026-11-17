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
  entrarAdminSchema,
  type EntrarAdminInput,
} from "@/app/api/(modules)/adm-interno/entrar/schema";
import { MENSAGEM_SEM_CONEXAO, destinoDaResposta, lerResposta, mensagemDeErro } from "./resposta";

// adminPath chega do Server Component da página (nunca por NEXT_PUBLIC_).
export function AdminLoginForm({ adminPath }: { adminPath: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<EntrarAdminInput>({
    resolver: zodResolver(entrarAdminSchema),
    defaultValues: { email: "", senha: "" },
  });

  async function onSubmit(data: EntrarAdminInput) {
    setServerError(null);

    let res: Response;
    let resposta: Awaited<ReturnType<typeof lerResposta>>;
    try {
      res = await fetch(`/${adminPath}/api/entrar`, {
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

    router.push(destino);
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Acesso interno</CardTitle>
        <CardDescription>Entre com seu e-mail e senha.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <Controller
              name="email"
              control={control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="email">E-mail</FieldLabel>
                  <Input
                    {...field}
                    id="email"
                    type="email"
                    autoComplete="username"
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
