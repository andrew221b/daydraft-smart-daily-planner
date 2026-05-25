from PIL import Image

def extract_logo():
    # Load original icon
    img = Image.open('public/icons/icon-1024.png').convert("RGBA")
    data = img.load()
    
    width, height = img.size
    
    # We know the background is roughly (9,10,12)
    # Let's make any pixel that is very dark transparent
    # The logo itself is bright white/silver/blue
    
    for y in range(height):
        for x in range(width):
            r, g, b, a = data[x, y]
            # If the pixel is dark (r<50, g<50, b<50), make it transparent
            # We use a soft threshold for anti-aliasing
            intensity = (r + g + b) / 3
            if intensity < 35:
                data[x, y] = (r, g, b, 0)
            elif intensity < 80:
                # partial transparency for soft edge
                alpha = int(((intensity - 35) / 45) * 255)
                data[x, y] = (r, g, b, alpha)
                
    # Now find bounding box of non-transparent pixels
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
        
    img.save('public/isolated-logo.webp', 'WEBP')
    print("Saved isolated-logo.webp. Size:", img.size)

extract_logo()
