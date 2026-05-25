from PIL import Image, ImageEnhance

input_path = 'public/icons/icon-1024.png'
icon = Image.open(input_path).convert("RGBA")

# Make it lighter (brightness enhancement)
enhancer = ImageEnhance.Brightness(icon)
icon = enhancer.enhance(1.2) # 20% brighter

# Scale it down to 600x600 for safe zone
icon.thumbnail((600, 600), Image.Resampling.LANCZOS)

# Create a new white background image
bg = Image.new("RGBA", (1024, 1024), (255, 255, 255, 255))
bg.paste(icon, (212, 212), icon)
bg.save("assets/icon.png")

# Also create splash (2732x2732)
splash_bg = Image.new("RGBA", (2732, 2732), (9, 9, 11, 255))
# For splash, let's keep it 600x600 centered
splash_bg.paste(icon, (1066, 1066), icon)
splash_bg.save("assets/splash.png")
