import os
def setup():
    with open('../classes.txt', 'r') as f:
        classes = [line.split('|')[0].strip() for line in f if line.strip() and not line.startswith('#')]
    for cls in classes:
        os.makedirs(f'../data/raw/{cls}', exist_ok=True)
        os.makedirs(f'../data/clean/{cls}', exist_ok=True)
        os.makedirs(f'../data/dataset/train/{cls}', exist_ok=True)
        os.makedirs(f'../data/dataset/val/{cls}', exist_ok=True)
        os.makedirs(f'../data/dataset/test/{cls}', exist_ok=True)
    print("✅ Folders created.")
if __name__ == '__main__':
    setup()
