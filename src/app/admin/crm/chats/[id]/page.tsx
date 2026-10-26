"use client";

import { useParams, useRouter } from "next/navigation";
import ChatThread from "../ChatThread";

/**
 * A Chator chat, full screen (13.10.2026, Yair: not a card, "שזה יכניס הכל
 * לצ'אט"). It fills the space under the CRM bar (the shell's padding is
 * cancelled here), so only the messages scroll. Back returns to the same tab.
 */
export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const back = () => { if (window.history.length > 1) router.back(); else router.push("/admin/crm/chats"); };
  return (
    <div className="-mx-4 -my-5 md:-mx-8 md:-my-7 h-[calc(100dvh-68px)] md:h-[100dvh] overflow-hidden">
      <div className="h-full md:max-w-3xl md:mx-auto md:border-x" style={{ borderColor: "#DCE6E4" }}>
        <ChatThread id={id} onBack={back} />
      </div>
    </div>
  );
}
