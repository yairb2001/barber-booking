import { CardModal } from "../../../CardModal";
import CustomerCard from "../../../customers/[id]/page";

/** A customer card opened from inside the CRM: a sheet over the current screen. */
export default function CustomerCardModal() {
  return <CardModal><CustomerCard /></CardModal>;
}
