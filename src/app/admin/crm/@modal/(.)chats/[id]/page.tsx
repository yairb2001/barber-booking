"use client";

import { useParams } from "next/navigation";
import { CardModal } from "../../../CardModal";
import ChatThread from "../../../chats/ChatThread";

/** A chat opened from inside the CRM: a sheet over the current screen. */
export default function ChatModal() {
  const { id } = useParams<{ id: string }>();
  return <CardModal><ChatThread id={id} /></CardModal>;
}
