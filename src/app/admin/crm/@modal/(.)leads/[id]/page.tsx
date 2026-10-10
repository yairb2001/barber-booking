import { CardModal } from "../../../CardModal";
import LeadCard from "../../../leads/[id]/page";

/** A lead card opened from inside the CRM: a sheet over the current screen. */
export default function LeadCardModal() {
  return <CardModal><LeadCard /></CardModal>;
}
