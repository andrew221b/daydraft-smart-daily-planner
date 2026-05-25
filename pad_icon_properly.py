from PIL import Image, ImageEnhance

icon = Image.open('public/icons/icon-1024.png').convert("RGB")
# Make it brighter
icon = ImageEnhance.Brightness(icon).enhance(1.2)

# Crop away 180px from all sides to guarantee we avoid the baked-in black rounded corners
CROP_MARGIN = 180
icon_cropped = icon.crop((CROP_MARGIN, CROP_MARGIN, 1024 - CROP_MARGIN, 1024 - CROP_MARGIN))

# Scale it up to 900x900 to make the logo larger!
INNER_SIZE = 900
icon_shrunk = icon_cropped.resize((INNER_SIZE, INNER_SIZE), Image.Resampling.LANCZOS)

canvas = Image.new("RGB", (1024, 1024))
offset = (1024 - INNER_SIZE) // 2
canvas.paste(icon_shrunk, (offset, offset))

# Stretch edges
top_edge = icon_shrunk.crop((0, 0, INNER_SIZE, 1))
canvas.paste(top_edge.resize((INNER_SIZE, offset)), (offset, 0))

bottom_edge = icon_shrunk.crop((0, INNER_SIZE-1, INNER_SIZE, INNER_SIZE))
canvas.paste(bottom_edge.resize((INNER_SIZE, offset)), (offset, offset + INNER_SIZE))

left_edge = icon_shrunk.crop((0, 0, 1, INNER_SIZE))
canvas.paste(left_edge.resize((offset, INNER_SIZE)), (0, offset))

right_edge = icon_shrunk.crop((INNER_SIZE-1, 0, INNER_SIZE, INNER_SIZE))
canvas.paste(right_edge.resize((offset, INNER_SIZE)), (offset + INNER_SIZE, offset))

# Stretch corners
top_left = icon_shrunk.crop((0, 0, 1, 1))
canvas.paste(top_left.resize((offset, offset)), (0, 0))

top_right = icon_shrunk.crop((INNER_SIZE-1, 0, INNER_SIZE, 1))
canvas.paste(top_right.resize((offset, offset)), (offset + INNER_SIZE, 0))

bottom_left = icon_shrunk.crop((0, INNER_SIZE-1, 1, INNER_SIZE))
canvas.paste(bottom_left.resize((offset, offset)), (0, offset + INNER_SIZE))

bottom_right = icon_shrunk.crop((INNER_SIZE-1, INNER_SIZE-1, INNER_SIZE, INNER_SIZE))
canvas.paste(bottom_right.resize((offset, offset)), (offset + INNER_SIZE, offset + INNER_SIZE))

canvas.save("assets/icon.png")

avg_color = top_left.getpixel((0,0))
splash = Image.new("RGB", (2732, 2732), avg_color)
splash.paste(canvas, ((2732 - 1024) // 2, (2732 - 1024) // 2))
splash.save("assets/splash.png")

print("Generated assets/icon.png and assets/splash.png")
