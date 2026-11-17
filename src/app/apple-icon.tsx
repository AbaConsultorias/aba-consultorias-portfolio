import { ImageResponse } from "next/og";
import { iconeDaMarca } from "@/lib/marca-imagem";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  return new ImageResponse(await iconeDaMarca(size.width), size);
}
