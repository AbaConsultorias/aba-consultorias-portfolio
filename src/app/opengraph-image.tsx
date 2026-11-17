import { ImageResponse } from "next/og";
import { cartaoDaMarca } from "@/lib/marca-imagem";

export const alt = "ABA Consultoria — projetos e regularização de loteamentos";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return new ImageResponse(await cartaoDaMarca(), size);
}
