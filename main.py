from pathlib import Path
from shutil import copyfile

source = Path(__file__).resolve().with_name("entry.png")
output = Path("/output/entry.png")
output.parent.mkdir(parents=True, exist_ok=True)
copyfile(source, output)
