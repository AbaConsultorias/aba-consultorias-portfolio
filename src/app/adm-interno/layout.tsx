export const dynamic = "force-dynamic";

// Sem guard nem metadata aqui: entrar/ e trocar-senha/ ficam fora do grupo
// (protegido), que é quem exige o papel. Título e noindex só saem depois do
// guard, para um 404 daqui ser igual ao de qualquer URL desconhecida.
export default function AdmInternoLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
