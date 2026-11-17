import { Suspense } from "react";
import type { Metadata } from "next";
import { AvisoConectorParado } from "@/components/admin/portal/conector/AvisoConectorParado";
import { exigirPapel } from "@/lib/auth/guard";
import { METADATA_INTERNA } from "@/lib/auth/metadata-interna";
import { PAPEIS_STAFF } from "@/lib/auth/papeis";
import { exigirContaInterna } from "@/lib/auth/permissoes-servidor";

export const dynamic = "force-dynamic";

// O guard roda antes de devolver qualquer metadata: sem acesso, o 404 sai sem
// título nem noindex próprios (exigirPapel é deduplicado com o do layout).
export async function generateMetadata(): Promise<Metadata> {
  await exigirPapel(PAPEIS_STAFF, { semAcesso: "404" });
  return METADATA_INTERNA;
}

export default async function AdminProtegidoLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { permissoes } = await exigirContaInterna();

  return (
    <>
      {permissoes.has("painel.servidor") && (
        <Suspense fallback={null}>
          <AvisoConectorParado />
        </Suspense>
      )}
      {children}
    </>
  );
}
