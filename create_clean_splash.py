from PIL import Image

# Create pure dark 2732x2732 splash screen for Capacitor
bg_color = (9, 10, 12)
splash = Image.new("RGB", (2732, 2732), bg_color)

# Load the isolated logo we just made
logo = Image.open('public/isolated-logo.webp').convert("RGBA")

# Shrink logo a bit so it's elegantly sized
target_size = 600
logo = logo.resize((target_size, target_size), Image.Resampling.LANCZOS)

# Paste logo in center
offset = (2732 - target_size) // 2
splash.paste(logo, (offset, offset), logo)

splash.save("assets/splash.png")
print("Clean splash.png generated!")
