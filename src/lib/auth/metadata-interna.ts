import type { Metadata } from "next";

// Só para telas do caminho secreto já liberadas pelo guard (ou a de login): um
// 404 do admin não pode carregar título nem noindex diferentes do resto do site.
export const METADATA_INTERNA: Metadata = {
  title: "Acesso interno",
  robots: { index: false, follow: false },
};
