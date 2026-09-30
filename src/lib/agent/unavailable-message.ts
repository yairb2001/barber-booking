/** The message a customer gets while the business's token package is used up
 *  (stage 1). Client-safe: the wizard shows it as the editable default;
 *  token-budget.ts applies it. Supports {{name}} and {{link}}. */
export const DEFAULT_UNAVAILABLE_MESSAGE =
  "היי {{name}}! הכי מהיר לקבוע תור דרך הקישור האישי שלך:\n{{link}}\n\nלכל דבר אחר נחזור אליך בהקדם.";
