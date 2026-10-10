"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { C } from "../../ui";
import ChatThread from "../ChatThread";

/** A Chator chat as a full page (a direct link); from inside the CRM it opens as a sheet. */
export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <Link href="/admin/crm/chats" className="text-sm" style={{ color: C.petrol }}>→ חזרה לצ׳אטים</Link>
      <ChatThread id={id} />
    </div>
  );
}
