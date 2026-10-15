import os
import math
from PIL import Image, ImageDraw, ImageFilter

def create_timbre_bw_icon(size=512, is_foreground_only=False, is_round=False):
    # Render at 4x supersampling for razor-sharp vector clarity
    scale = 4
    canvas_size = size * scale
    img = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    center = canvas_size / 2
    r_outer = canvas_size * 0.44

    if not is_foreground_only:
        # Background: Solid Pitch Pure Black (#000000)
        if is_round:
            draw.ellipse(
                [center - r_outer, center - r_outer, center + r_outer, center + r_outer],
                fill=(0, 0, 0, 255)
            )
        else:
            corner_r = int(canvas_size * 0.22)
            draw.rounded_rectangle(
                [center - r_outer, center - r_outer, center + r_outer, center + r_outer],
                radius=corner_r,
                fill=(0, 0, 0, 255)
            )

    # ----------------- MONOCHROME SIGNATURE EMBLEM (PURE WHITE) -----------------
    # Scale emblem to sit safely inside Android Adaptive Icon safe zone (66% of canvas)
    emblem_scale = 0.64 if is_foreground_only else 0.78
    
    # Soundwave resonance equalizer bars (Pure Solid White)
    wave_bars = [
        # (x_offset_pct, height_pct)
        (-0.25, 0.20),
        (-0.18, 0.35),
        (-0.10, 0.52),
        (-0.03, 0.65),
        (0.03, 0.65),
        (0.10, 0.52),
        (0.18, 0.35),
        (0.25, 0.20),
    ]

    bar_width = int(canvas_size * 0.040 * emblem_scale)
    corner = int(bar_width / 2)

    # Draw pure white soundwave bars
    for x_pct, h_pct in wave_bars:
        x = center + (x_pct * canvas_size * emblem_scale)
        half_h = (h_pct * canvas_size * 0.42 * emblem_scale)
        top = center - half_h + (canvas_size * 0.04 * emblem_scale)
        bottom = center + half_h + (canvas_size * 0.04 * emblem_scale)

        draw.rounded_rectangle(
            [x - bar_width / 2, top, x + bar_width / 2, bottom],
            radius=corner,
            fill=(255, 255, 255, 255)
        )

    # Bold Architectural "T" Crossbar (Pure White)
    t_width = canvas_size * 0.46 * emblem_scale
    t_height = canvas_size * 0.082 * emblem_scale
    t_top = center - (canvas_size * 0.28 * emblem_scale)

    draw.rounded_rectangle(
        [center - t_width / 2, t_top, center + t_width / 2, t_top + t_height],
        radius=int(t_height / 2),
        fill=(255, 255, 255, 255)
    )

    # Center stem of "T" (Pure White)
    t_stem_w = canvas_size * 0.082 * emblem_scale
    t_stem_h = canvas_size * 0.30 * emblem_scale
    draw.rounded_rectangle(
        [center - t_stem_w / 2, t_top, center + t_stem_w / 2, t_top + t_stem_h],
        radius=int(t_stem_w / 2),
        fill=(255, 255, 255, 255)
    )

    # Downsample with Lanczos filter for ultra-crisp edges
    final_img = img.resize((size, size), Image.Resampling.LANCZOS)
    return final_img

def main():
    base_res = r"C:\Users\Archangel\.gemini\antigravity\scratch\neumorphic-music-player\android\app\src\main\res"
    
    mipmaps = {
        'mipmap-mdpi': 48,
        'mipmap-hdpi': 72,
        'mipmap-xhdpi': 96,
        'mipmap-xxhdpi': 144,
        'mipmap-xxxhdpi': 192
    }

    print("Generating premium Black & White TimBre app icons...")
    for folder, size in mipmaps.items():
        dir_path = os.path.join(base_res, folder)
        os.makedirs(dir_path, exist_ok=True)
        
        # Standard icon
        icon = create_timbre_bw_icon(size=size, is_foreground_only=False, is_round=False)
        icon.save(os.path.join(dir_path, 'ic_launcher.png'), 'PNG')
        
        # Round icon (Samsung One UI / Galaxy S21 & Pixel)
        icon_round = create_timbre_bw_icon(size=size, is_foreground_only=False, is_round=True)
        icon_round.save(os.path.join(dir_path, 'ic_launcher_round.png'), 'PNG')
        
        # Adaptive foreground
        fg = create_timbre_bw_icon(size=size * 2, is_foreground_only=True, is_round=False)
        fg.save(os.path.join(dir_path, 'ic_launcher_foreground.png'), 'PNG')
        print(f"Saved {folder} ({size}x{size})")

    # High-Res Web and Play Store Icon (512x512)
    icon_512 = create_timbre_bw_icon(size=512, is_foreground_only=False, is_round=False)
    icon_512.save(os.path.join(base_res, 'ic_launcher-playstore.png'), 'PNG')
    
    www_assets = r"C:\Users\Archangel\.gemini\antigravity\scratch\neumorphic-music-player\www\assets"
    os.makedirs(www_assets, exist_ok=True)
    icon_512.save(os.path.join(www_assets, 'icon-512.png'), 'PNG')
    
    icon_192 = create_timbre_bw_icon(size=192, is_foreground_only=False, is_round=False)
    icon_192.save(os.path.join(www_assets, 'icon-192.png'), 'PNG')
    
    # Root assets
    root_assets = r"C:\Users\Archangel\.gemini\antigravity\scratch\neumorphic-music-player\assets"
    os.makedirs(root_assets, exist_ok=True)
    icon_512.save(os.path.join(root_assets, 'icon-512.png'), 'PNG')
    icon_192.save(os.path.join(root_assets, 'icon-192.png'), 'PNG')

    print("All premium Black & White TimBre app icons successfully generated!")

if __name__ == '__main__':
    main()
