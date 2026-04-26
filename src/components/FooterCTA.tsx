export default function FooterCTA() {
  return (
    <div className="py-6 text-center bg-neutral-50 border-t border-neutral-100">
      <p className="text-[12px] text-neutral-400 leading-relaxed">
        רוצה מערכת מתקדמת כזו לעסק שלך?{" "}
        <a
          href="/for-business"
          className="font-semibold underline underline-offset-2"
          style={{ color: "var(--brand, #D4AF37)" }}
        >
          לחץ כאן
        </a>
      </p>
    </div>
  );
}
