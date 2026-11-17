import { notFound } from "next/navigation";
import { AdminLoginForm } from "@/components/auth/AdminLoginForm";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { METADATA_INTERNA } from "@/lib/auth/metadata-interna";

export const metadata = METADATA_INTERNA;

export default function AdminEntrarPage() {
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <AdminLoginForm adminPath={adminPath} />
    </main>
  );
}
