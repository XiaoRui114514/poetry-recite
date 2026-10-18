"""生成 PWA 图标（纸色底 + 朱砂印 + 楷体“诗”）。

运行：python tools/make-icons.py
依赖：Pillow（项目打包环境已自带）；字体优先用 Windows 自带的楷体 / 宋体。
图标是可再生的构建素材，不需要手工编辑。
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "icons"
PAPER = (247, 243, 235, 255)
SEAL = (163, 58, 42, 255)
FONT_CANDIDATES = [
    Path("C:/Windows/Fonts/simkai.ttf"),
    Path("C:/Windows/Fonts/simsun.ttc"),
    Path("C:/Windows/Fonts/msyh.ttc"),
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def draw_icon(size: int, seal_ratio: float) -> Image.Image:
    image = Image.new("RGBA", (size, size), PAPER)
    draw = ImageDraw.Draw(image)
    seal = int(size * seal_ratio)
    left = (size - seal) // 2
    top = (size - seal) // 2
    radius = max(8, int(seal * 0.08))
    draw.rounded_rectangle((left, top, left + seal, top + seal), radius=radius, fill=SEAL)
    font = load_font(int(seal * 0.68))
    draw.text((size // 2, size // 2 + int(seal * 0.02)), "诗", font=font, fill=PAPER, anchor="mm")
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw_icon(192, 0.72).save(OUT / "icon-192.png", optimize=True)
    draw_icon(512, 0.72).save(OUT / "icon-512.png", optimize=True)
    draw_icon(512, 0.58).save(OUT / "icon-maskable-512.png", optimize=True)
    print("icons written:", ", ".join(p.name for p in sorted(OUT.glob("*.png"))))


if __name__ == "__main__":
    main()
