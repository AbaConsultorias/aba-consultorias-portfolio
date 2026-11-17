"use client";

import { ErroDaArea } from "@/components/portal/comum/ErroDaArea";

export default function ErroFornecedor({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErroDaArea error={error} reset={reset} inicio="/fornecedor" />;
}
