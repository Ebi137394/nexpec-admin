import os, subprocess
def run():
    subprocess.run(['python3', '00_setup.py'])
    if os.path.exists('../data/raw') and any(os.scandir('../data/raw')):
        subprocess.run(['python3', '02_clean.py'])
        subprocess.run(['python3', '03_split.py'])
if __name__ == '__main__':
    run()
