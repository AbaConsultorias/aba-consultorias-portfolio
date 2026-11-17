"use client";

import type { Configuracoes } from "@/lib/conteudo/tipos";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "motion/react";
import { NAV_LINKS } from "@/components/site/nav-links";
import { cn } from "@/lib/utils";
import { IconeWhatsApp } from "./Icones";
import { linkWhatsApp } from "./dados";

const EASE = [0.33, 1, 0.68, 1] as const;

export function Cabecalho({ configuracoes, variante }: { configuracoes: Configuracoes; variante?: "sobreEscuro" | "claro" }) {
  const pathname = usePathname();
  const varianteAtual = variante ?? (pathname === "/" ? "sobreEscuro" : "claro");
  const { scrollY, scrollYProgress } = useScroll();
  const progresso = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: 0.001 });
  const [rolou, setRolou] = useState(false);
  const [escondido, setEscondido] = useState(false);
  const [aberto, setAberto] = useState(false);
  const botaoMenu = useRef<HTMLButtonElement>(null);
  const primeiroLink = useRef<HTMLAnchorElement>(null);

  useMotionValueEvent(scrollY, "change", (y) => {
    const anterior = scrollY.getPrevious() ?? 0;
    setRolou(y > 40);
    setEscondido((atual) => {
      if (y < 320) return false;
      if (y > anterior + 4) return true;
      if (y < anterior - 4) return false;
      return atual;
    });
  });

  useEffect(() => {
    const sincronizar = () => setRolou(window.scrollY > 40);
    sincronizar();
  }, []);

  useEffect(() => {
    if (!aberto) return;
    const raiz = document.documentElement;
    const overflowAnterior = raiz.style.overflow;
    raiz.style.overflow = "hidden";
    primeiroLink.current?.focus();
    const fecharNoEsc = (evento: KeyboardEvent) => {
      if (evento.key !== "Escape") return;
      setAberto(false);
      botaoMenu.current?.focus();
    };
    window.addEventListener("keydown", fecharNoEsc);
    return () => {
      raiz.style.overflow = overflowAnterior;
      window.removeEventListener("keydown", fecharNoEsc);
    };
  }, [aberto]);

  const visivel = !escondido || aberto;

  return (
    <>
      <motion.div aria-hidden="true" style={{ scaleX: progresso }} className="fixed inset-x-0 top-0 z-[70] h-[3px] origin-left bg-(--nova-acento)" />

      <AnimatePresence>
        {aberto && (
          <motion.div
            key="veu"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            onClick={() => setAberto(false)}
            className="fixed inset-0 z-40 bg-brand-dark/35 backdrop-blur-sm lg:hidden"
          />
        )}
      </AnimatePresence>

      <motion.header
        initial={false}
        animate={{ y: visivel ? "0%" : "-130%" }}
        transition={{ duration: 0.6, ease: EASE }}
        onFocusCapture={() => setEscondido(false)}
        className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4"
      >
        <div
          className={cn(
            "relative mx-auto flex max-w-7xl items-center justify-between gap-3 rounded-full border py-1.5 pr-2 pl-5 sm:pl-6",
            "transition-[background-color,box-shadow,border-color] duration-700",
            varianteAtual === "claro"
              ? "border-brand-dark/8 bg-white shadow-[0_18px_44px_-22px_rgba(28,40,50,0.55)]"
              : rolou || aberto
              ? "border-brand-dark/8 bg-white/90 shadow-[0_18px_44px_-22px_rgba(28,40,50,0.55)] backdrop-blur-xl"
              : "border-white/50 bg-white/75 shadow-[0_8px_30px_-20px_rgba(28,40,50,0.4)] backdrop-blur-md",
          )}
        >
          <Link href="/" className="shrink-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--nova-acento)">
            <Image
              src="/marca/aba-logo.png"
              alt="ABA Consultoria — página inicial"
              width={1131}
              height={1391}
              sizes="64px"
              className={cn("w-auto transition-[height] duration-700", rolou ? "h-14" : "h-14 sm:h-16")}
            />
          </Link>

          <nav aria-label="Principal" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {NAV_LINKS.map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={(href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)) ? "page" : undefined}
                    className="group relative block rounded-full px-3.5 py-2.5 text-sm font-medium text-brand-dark/80 transition-colors duration-500 hover:text-brand-dark focus-visible:outline-2 focus-visible:outline-(--nova-acento) aria-[current=page]:text-brand-dark"
                  >
                    {label}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-x-3.5 bottom-1.5 h-px origin-right scale-x-0 bg-(--nova-acento) transition-[scale,opacity] duration-500 group-hover:origin-left group-hover:scale-x-100 group-aria-[current=page]:scale-x-100",
                        "motion-reduce:scale-x-100 motion-reduce:opacity-0 motion-reduce:group-hover:opacity-100 motion-reduce:group-aria-[current=page]:opacity-100",
                      )}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/entrar"
              className={cn(
                "group relative isolate hidden min-h-11 items-center overflow-hidden rounded-full bg-brand-dark px-5 text-sm font-semibold text-white sm:inline-flex",
                "transition-shadow duration-500 hover:shadow-[0_12px_28px_-12px_rgba(28,40,50,0.6)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--nova-acento)",
              )}
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 -z-10 origin-bottom scale-y-0 bg-(--nova-acento) transition-[scale,opacity] duration-500 group-hover:scale-y-100 motion-reduce:scale-y-100 motion-reduce:opacity-0 motion-reduce:group-hover:opacity-100"
              />
              Área do cliente
            </Link>

            <button
              ref={botaoMenu}
              type="button"
              aria-expanded={aberto}
              aria-controls="menu-movel"
              aria-label={aberto ? "Fechar menu" : "Abrir menu"}
              onClick={() => setAberto((atual) => !atual)}
              className="grid size-12 place-items-center rounded-full bg-brand-dark text-white transition-colors duration-500 hover:bg-(--nova-acento) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--nova-acento) lg:hidden"
            >
              <span aria-hidden="true" className="relative block h-3 w-5">
                <span className={cn("absolute left-0 h-0.5 w-5 rounded-full bg-current transition-[top,rotate] duration-500 motion-reduce:transition-none", aberto ? "top-[5px] rotate-45" : "top-0")} />
                <span className={cn("absolute left-0 h-0.5 rounded-full bg-current transition-[top,rotate,width] duration-500 motion-reduce:transition-none", aberto ? "top-[5px] w-5 -rotate-45" : "top-2.5 w-3.5")} />
              </span>
            </button>
          </div>

          <AnimatePresence>
            {aberto && (
              <motion.nav
                key="menu"
                id="menu-movel"
                aria-label="Menu"
                initial={{ opacity: 0, y: -16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12, scale: 0.98 }}
                transition={{ duration: 0.45, ease: EASE }}
                className="absolute inset-x-0 top-full mt-2 origin-top rounded-[2rem] border border-brand-dark/8 bg-white p-3 shadow-[0_30px_60px_-30px_rgba(28,40,50,0.6)] lg:hidden"
              >
                <motion.ul
                  initial="fechado"
                  animate="aberto"
                  variants={{ aberto: { transition: { staggerChildren: 0.05, delayChildren: 0.08 } }, fechado: {} }}
                >
                  {NAV_LINKS.map(({ href, label }, indice) => (
                    <motion.li
                      key={href}
                      variants={{ fechado: { opacity: 0, y: 12 }, aberto: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } } }}
                    >
                      <Link
                        ref={indice === 0 ? primeiroLink : undefined}
                        href={href}
                        aria-current={(href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)) ? "page" : undefined}
                        onClick={() => setAberto(false)}
                        className="flex min-h-13 items-center justify-between rounded-2xl px-4 text-lg font-semibold text-brand-dark transition-colors duration-500 hover:bg-(--nova-fundo) focus-visible:outline-2 focus-visible:outline-(--nova-acento)"
                      >
                        {label}
                        <span className="text-xs font-medium tabular-nums text-[#526B78]">0{indice + 1}</span>
                      </Link>
                    </motion.li>
                  ))}
                </motion.ul>
                <div className="mt-3 grid gap-2 border-t border-brand-dark/10 pt-3 sm:grid-cols-2">
                  <Link href="/entrar" onClick={() => setAberto(false)} className="flex min-h-12 items-center justify-center rounded-full bg-brand-dark px-5 text-sm font-semibold text-white transition-colors duration-500 hover:bg-(--nova-acento) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--nova-acento)">
                    Área do cliente
                  </Link>
                  <a href={linkWhatsApp(undefined, configuracoes.whatsapp)} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-(--nova-whatsapp) px-5 text-sm font-semibold text-white transition-colors duration-500 hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--nova-acento)">
                    <IconeWhatsApp className="size-5" />
                    Fale pelo WhatsApp<span className="sr-only"> (abre em nova aba)</span>
                  </a>
                </div>
              </motion.nav>
            )}
          </AnimatePresence>
        </div>
      </motion.header>
    </>
  );
}
