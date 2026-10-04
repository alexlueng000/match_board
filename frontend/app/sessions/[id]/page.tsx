import { notFound } from "next/navigation";
import AdminWorkspace from "../../AdminWorkspace";
export default async function SessionPage({ params }: { params: Promise<{id: string}> }) {
  const {id} = await params;
  const sessionId = Number(id);
  if(!Number.isSafeInteger(sessionId) || sessionId < 1) notFound();
  return <AdminWorkspace sessionId={sessionId} />;
}
