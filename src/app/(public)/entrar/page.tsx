import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { destinoAposLogin } from "@/lib/auth/destino";
import { ehStaff } from "@/lib/auth/papeis";
import { obterAcessoAtual } from "@/lib/auth/sessao";

export const metadata: Metadata = { title: "Entrar", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function EntrarPage() {
  const acesso = await obterAcessoAtual();

  // Quem já está logado vai direto para a própria área. Staff fica de fora
  // de propósito: o painel não pode ser sugerido a partir de uma página pública.
  if (acesso?.perfil.ativo && !ehStaff(acesso.perfil.papel)) {
    redirect(destinoAposLogin(acesso.perfil));
  }

  return (
    <section className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-5 pt-36 pb-12 sm:px-8 sm:pt-40">
      <LoginForm />
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        O acesso é criado pela equipe da ABA Consultoria. Se ainda não recebeu
        seus dados, entre em contato conosco.
      </p>
    </section>
  );
}
