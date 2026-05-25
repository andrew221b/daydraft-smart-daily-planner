from PIL import Image
import os
import json

# Create directory
img_dir = "ios/App/App/Assets.xcassets/LaunchLogo.imageset"
os.makedirs(img_dir, exist_ok=True)

# Load webp and save as png
try:
    img = Image.open("public/isolated-logo.webp")
    img.save(f"{img_dir}/launch-logo.png", "PNG")
except Exception as e:
    print(f"Error converting image: {e}")
    exit(1)

# Create Contents.json
contents = {
  "images": [
    {
      "filename": "launch-logo.png",
      "idiom": "universal"
    }
  ],
  "info": {
    "author": "xcode",
    "version": 1
  }
}

with open(f"{img_dir}/Contents.json", "w") as f:
    json.dump(contents, f, indent=2)

print("LaunchLogo created successfully!")
