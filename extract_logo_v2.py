from PIL import Image

def extract_logo():
    img = Image.open('public/icons/icon-1024.png').convert("RGBA")
    data = img.load()
    width, height = img.size
    
    # Let's find the max intensity of the background (the edges)
    bg_intensities = []
    for x in range(width):
        bg_intensities.append(sum(data[x, 0][:3])/3)
        bg_intensities.append(sum(data[x, height-1][:3])/3)
    for y in range(height):
        bg_intensities.append(sum(data[0, y][:3])/3)
        bg_intensities.append(sum(data[width-1, y][:3])/3)
        
    max_bg = max(bg_intensities)
    print("Max background intensity at edges:", max_bg)
    
    # We'll set the threshold a bit higher than the max edge intensity
    # The D logo is brightly lit.
    threshold = max(max_bg + 20, 80)
    
    for y in range(height):
        for x in range(width):
            r, g, b, a = data[x, y]
            intensity = (r + g + b) / 3
            if intensity < threshold:
                data[x, y] = (r, g, b, 0)
            elif intensity < threshold + 40:
                # anti-alias edge
                alpha = int(((intensity - threshold) / 40) * 255)
                data[x, y] = (r, g, b, alpha)
                
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
        
    img.save('public/isolated-logo.webp', 'WEBP')
    print("Saved isolated-logo.webp. Size:", img.size)

extract_logo()
