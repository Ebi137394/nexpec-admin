import os, glob, imagehash, numpy as np
from PIL import Image
def clean_and_standardize():
    with open('../classes.txt', 'r') as f:
        classes = [line.split('|')[0].strip() for line in f if line.strip() and not line.startswith('#')]
    hashes = set()
    for cls in classes:
        files = glob.glob(f'../data/raw/{cls}/*')
        counter = 1
        for f in files:
            try:
                with Image.open(f) as img:
                    if img.size[0] < 128 or img.size[1] < 128: continue
                    h = imagehash.average_hash(img)
                    if h in hashes: continue
                    hashes.add(h)
                    img_rgb = img.convert('RGB')
                    clean_path = f'../data/clean/{cls}/{cls}_{counter:05d}.jpg'
                    img_rgb.save(clean_path, 'JPEG', quality=90)
                    counter += 1
            except Exception: continue
if __name__ == '__main__':
    clean_and_standardize()
