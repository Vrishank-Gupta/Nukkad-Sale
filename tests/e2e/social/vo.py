# Batch voiceover with Kokoro (open-source neural TTS, runs locally – no API, no cost).
# usage: <kokoro-venv>/bin/python -I vo.py <models-dir> <jobs.json>
#   jobs.json: [{"text": "...", "out": "/abs/path.wav", "voice": "af_heart", "speed": 1.0, "lang": "en-us"}, ...]
# Prints {"out": seconds} per job. Existing files with the same text are reused (cache key = .txt next to the wav).
import json, os, sys
import soundfile as sf
from kokoro_onnx import Kokoro
models, jobs = sys.argv[1], json.load(open(sys.argv[2]))
k = Kokoro(os.path.join(models, 'kokoro-v1.0.onnx'), os.path.join(models, 'voices-v1.0.bin'))
done = {}
for j in jobs:
    key = f"{j.get('voice','af_heart')}|{j.get('speed',1.0)}|{j['text']}"
    txt = j['out'] + '.txt'
    if not (os.path.exists(j['out']) and os.path.exists(txt) and open(txt).read() == key):
        s, sr = k.create(j['text'], voice=j.get('voice', 'af_heart'), speed=j.get('speed', 1.0), lang=j.get('lang', 'en-us'))
        sf.write(j['out'], s, sr); open(txt, 'w').write(key)
    info = sf.info(j['out']); done[j['out']] = round(info.frames / info.samplerate, 3)
print(json.dumps(done))
