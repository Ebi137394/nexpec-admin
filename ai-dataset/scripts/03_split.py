import os, glob, shutil, random
def split_data():
    with open('../classes.txt', 'r') as f:
        classes = [line.split('|')[0].strip() for line in f if line.strip() and not line.startswith('#')]
    for cls in classes:
        files = glob.glob(f'../data/clean/{cls}/*.jpg')
        random.shuffle(files)
        n = len(files)
        train_idx, val_idx = int(n * 0.7), int(n * 0.9)
        for i, f in enumerate(files):
            name = os.path.basename(f)
            if i < train_idx: shutil.copy(f, f'../data/dataset/train/{cls}/{name}')
            elif i < val_idx: shutil.copy(f, f'../data/dataset/val/{cls}/{name}')
            else: shutil.copy(f, f'../data/dataset/test/{cls}/{name}')
if __name__ == '__main__':
    split_data()
