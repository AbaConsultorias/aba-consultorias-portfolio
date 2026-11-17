import Image from "next/image";
import { LogoutButton } from "@/components/auth/LogoutButton";

type AreaShellProps = {
  titulo: string;
  nome: string;
  redirecionarAposSair?: string;
  children: React.ReactNode;
};

// Cabeçalho simples das áreas logadas (o Header do site público não entra aqui).
export function AreaShell({
  titulo,
  nome,
  redirecionarAposSair,
  children,
}: AreaShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Image
              src="/marca/aba-logo.png"
              alt="ABA Consultoria"
              width={32}
              height={39}
              priority
            />
            <span className="text-sm font-semibold text-primary">{titulo}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{nome}</span>
            <LogoutButton redirecionarPara={redirecionarAposSair} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
