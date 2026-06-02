# App Icon & Splash Screen — Replacement Guide

Capacitor placed placeholder images in `ios/App/App/Assets.xcassets/`.
Before submitting to the App Store you should replace them with branded artwork.

---

## Files to replace

### App Icon
- **Path:** `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`
- **Size:** 1024×1024, PNG, no transparency, no rounded corners (Apple rounds them automatically)
- **Subject:** DOMINANT logo on teal `#0d9488` background, or whatever the business owner prefers
- The single 1024 PNG is all you need for modern Xcode — Apple auto-generates the smaller sizes.

### Splash Screen
- **Path:** `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png` (+ `@2x`, `@3x` variants)
- **Size:** 2732×2732 (covers all iPad sizes — Capacitor crops it down for phones)
- **Subject:** logo centered on solid teal background
- All three files (`splash-2732x2732.png`, `splash-2732x2732-1.png`, `splash-2732x2732-2.png`) should be identical for now.

---

## How to generate quickly

If you have a square logo PNG (call it `logo.png`):

```bash
# Install Pillow if needed
python3 -m pip install Pillow

# App icon
python3 - <<'EOF'
from PIL import Image
bg = Image.new("RGB", (1024, 1024), "#0d9488")
logo = Image.open("logo.png").convert("RGBA")
logo.thumbnail((700, 700))
x = (1024 - logo.width) // 2
y = (1024 - logo.height) // 2
bg.paste(logo, (x, y), logo)
bg.save("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", "PNG")
EOF

# Splash (2732x2732)
python3 - <<'EOF'
from PIL import Image
bg = Image.new("RGB", (2732, 2732), "#0d9488")
logo = Image.open("logo.png").convert("RGBA")
logo.thumbnail((1400, 1400))
x = (2732 - logo.width) // 2
y = (2732 - logo.height) // 2
bg.paste(logo, (x, y), logo)
for n in ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]:
    bg.save(f"ios/App/App/Assets.xcassets/Splash.imageset/{n}", "PNG")
EOF
```

After replacing, run `npx cap sync ios` to refresh.
