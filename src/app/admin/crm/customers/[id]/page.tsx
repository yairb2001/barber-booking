"use client";

import { useParams } from "next/navigation";
import CustomerCard from "./CustomerCard";

/** The customer card as a full page (a direct link or a push). From inside the CRM it opens as a sheet (CardHost). */
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <CustomerCard id={id} />;
}
