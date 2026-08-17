from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'assets' / 'logo.png'
out = root / 'build' / 'icon.ico'
out.parent.mkdir(parents=True, exist_ok=True)
image = Image.open(source).convert('RGBA')
image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
canvas = Image.new('RGBA', (1024, 1024), (4, 12, 20, 255))
left = (1024 - image.width) // 2
# Keep the original horizontal logo legible while filling the icon canvas.
canvas.alpha_composite(image, (left, (1024 - image.height) // 2))
canvas.save(out, format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print(out)
