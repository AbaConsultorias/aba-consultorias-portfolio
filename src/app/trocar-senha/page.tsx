import type { Metadata } from "next";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { TrocarSenhaForm } from "@/components/auth/TrocarSenhaForm";
import { exigirPapel } from "@/lib/auth/guard";
import { PAPEIS_USUARIO } from "@/lib/auth/papeis";

export const metadata: Metadata = {
  title: "Trocar senha",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function TrocarSenhaPage() {
  await exigirPapel(PAPEIS_USUARIO, {
    semAcesso: "entrar",
    permitirTrocaSenhaPendente: true,
  });

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <TrocarSenhaForm />
      <LogoutButton />
    </div>
  );
}
