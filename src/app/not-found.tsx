import type { Metadata } from "next";
import Image from "next/image";
import { Botao } from "@/components/publico/Botao";
import { linkWhatsApp } from "@/components/publico/dados";
import "@/components/publico/publico.css";

export const metadata: Metadata = {
  title: "Página não encontrada",
  robots: { index: false, follow: false },
};

// Estático e sem sessão: o 404 do caminho secreto da equipe tem de ser igual ao de qualquer URL.
export default function NaoEncontrado() {
  return (
    <div className="nova flex min-h-svh items-center justify-center bg-(--nova-fundo) px-5 py-16 text-(--nova-tinta) antialiased">
      <main className="flex w-full max-w-xl flex-col items-center gap-6 text-center">
        <Image src="/marca/aba-logo.png" alt="ABA Consultorias" width={56} height={68} priority />
        <p className="text-sm font-semibold tracking-widest text-(--nova-acento) uppercase">Erro 404</p>
        <h1 className="text-balance text-4xl font-medium tracking-tight sm:text-5xl">Página não encontrada</h1>
        <p className="text-pretty text-base leading-relaxed text-(--nova-tinta)/75">
          O endereço que você tentou abrir não existe ou mudou de lugar. Volte para o início ou fale com a nossa equipe pelo WhatsApp.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Botao href="/">Voltar para o início</Botao>
          <Botao
            href={linkWhatsApp("Olá! Gostaria de falar com a ABA Consultorias.")}
            variante="whatsapp"
            icone="whatsapp"
            externo
          >
            Falar no WhatsApp
          </Botao>
        </div>
      </main>
    </div>
  );
}
