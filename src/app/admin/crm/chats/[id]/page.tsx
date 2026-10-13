"use client";

import { useParams, useRouter } from "next/navigation";
import { C } from "../../ui";
import ChatThread from "../ChatThread";

/** A Chator chat, full screen (13.10.2026, Yair: not a card, "שזה יכניס הכל לצ'אט"). Back returns to the same tab of the list. */
export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const back = () => { if (window.history.length > 1) router.back(); else router.push("/admin/crm/chats"); };
  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <button type="button" onClick={back} className="self-start text-sm font-semibold" style={{ color: C.petrol }}>→ חזרה לצ׳אטים</button>
      <ChatThread id={id} />
    </div>
  );
}
