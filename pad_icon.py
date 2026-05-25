import sys
try:
    from PIL import Image, ImageEnhance
except ImportError:
    print("Pillow not installed. Please install it with 'pip install Pillow'")
    sys.exit(1)

input_path = '/Users/andrew/.gemini/antigravity/brain/2a98c3c8-9dd2-4520-9eb6-ea5e4c0a8da7/daydraft_app_icon_1779610168223.png'
icon = Image.open(input_path).convert("RGBA")

# Make it lighter (brightness enhancement)
enhancer = ImageEnhance.Brightness(icon)
icon = enhancer.enhance(1.2) # 20% brighter

# The original icon is probably 1024x1024. Let's scale it down to 600x600 and put it on a 1024x1024 white background
icon.thumbnail((600, 600), Image.Resampling.LANCZOS)

# Create a new white background image
bg = Image.new("RGBA", (1024, 1024), (255, 255, 255, 255))
# Paste the centered icon, using its alpha channel as a mask
bg.paste(icon, (212, 212), icon)

bg.save("assets/icon.png")

# Also create splash (2732x2732)
splash_bg = Image.new("RGBA", (2732, 2732), (9, 9, 11, 255)) # Dark background for splash
# Scale icon up slightly for splash, or keep it 600x600? Let's keep it 600x600 for elegance
splash_bg.paste(icon, (1066, 1066), icon)
splash_bg.save("assets/splash.png")

print("Success")
