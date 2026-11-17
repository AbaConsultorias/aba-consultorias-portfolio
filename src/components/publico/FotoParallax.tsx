"use client";

import { useRef, type ReactNode } from "react";
import Image from "next/image";
import { motion, useScroll, useTransform } from "motion/react";
import { useMovimentoReduzido } from "./ganchos";
import { cn } from "@/lib/utils";

export function FotoParallax({
  src,
  alt,
  sizes,
  intensidade = 8,
  className,
  children,
}: {
  src: string;
  alt: string;
  sizes: string;
  intensidade?: number;
  className?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduzir = useMovimentoReduzido();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const deslocamento = reduzir ? 0 : intensidade;
  const y = useTransform(scrollYProgress, [0, 1], [`-${deslocamento}%`, `${deslocamento}%`]);

  return (
    <div ref={ref} className={cn("group relative isolate overflow-hidden bg-brand-dark/10", className)}>
      <motion.div style={{ y }} className="absolute inset-x-0 -top-[12%] -bottom-[12%]">
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          className="object-cover transition-[scale] duration-[1400ms] group-hover:scale-[1.06] motion-reduce:group-hover:scale-100"
        />
      </motion.div>
      {children}
    </div>
  );
}
