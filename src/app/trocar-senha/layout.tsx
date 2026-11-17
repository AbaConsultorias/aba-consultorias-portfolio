import Image from "next/image";

// Layout próprio: a troca de senha obrigatória fica fora do site público
// (sem Header, Footer nem o botão "Área do cliente").
export default function TrocarSenhaLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-foreground">
      <Image
        src="/marca/aba-logo.png"
        alt="ABA Consultoria"
        width={1131}
        height={1391}
        priority
        className="h-16 w-auto"
      />
      {children}
    </main>
  );
}
